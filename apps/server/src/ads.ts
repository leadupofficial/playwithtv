import { randomUUID } from "node:crypto";
import pg from "pg";
import type { AdInput, AdPlacement, AdRecord, AdServed, AdStats, ImpressionBatch } from "@playwithtv/protocol";

/** Sponsor storage. Images live beside the record so a sponsor is one row to back up or delete. */
export interface AdStore {
  list(): Promise<AdRecord[]>;
  create(input: AdInput): Promise<AdRecord>;
  update(id: string, input: AdInput): Promise<AdRecord | null>;
  remove(id: string): Promise<boolean>;
  setImage(id: string, type: string, bytes: Buffer): Promise<boolean>;
  image(id: string): Promise<{ type: string; bytes: Buffer } | null>;
  /** Enabled sponsors whose date range includes `today` (YYYY-MM-DD, India time). */
  active(today: string): Promise<AdServed[]>;
  /** Adds impressions to today's counters; only sponsors live today and booked for that placement count. */
  count(batch: ImpressionBatch, today: string): Promise<void>;
  stats(sinceDay: string): Promise<AdStats[]>;
  close(): Promise<void>;
}

/** Today's date in India, where the TVs are; sponsors book whole calendar days. */
export function todayIST(now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function daysAgo(day: string, n: number): string {
  return new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Checks the file really is the image type it claims (by its first bytes), not just its header. */
export function imageMatches(type: string, b: Buffer): boolean {
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

const served = (a: AdRecord): AdServed => ({
  id: a.id, advertiser: a.advertiser, title: a.title, line: a.line, placements: a.placements,
  imageUrl: a.imageType ? `/api/ads/${a.id}/image?v=${a.imageVersion}` : null,
});

export class MemoryAdStore implements AdStore {
  private ads = new Map<string, AdRecord & { bytes?: Buffer }>();
  private counts = new Map<string, number>(); // `${id}|${placement}|${day}`
  async list() {
    return [...this.ads.values()].map(({ bytes: _b, ...a }) => a);
  }
  async create(input: AdInput) {
    const a = { ...input, id: randomUUID(), imageType: null, imageVersion: 0 };
    this.ads.set(a.id, a);
    return a;
  }
  async update(id: string, input: AdInput) {
    const a = this.ads.get(id);
    if (!a) return null;
    Object.assign(a, input);
    const { bytes: _b, ...rest } = a;
    return rest;
  }
  async remove(id: string) {
    return this.ads.delete(id);
  }
  async setImage(id: string, type: string, bytes: Buffer) {
    const a = this.ads.get(id);
    if (!a) return false;
    Object.assign(a, { imageType: type, bytes, imageVersion: a.imageVersion + 1 });
    return true;
  }
  async image(id: string) {
    const a = this.ads.get(id);
    return a?.bytes && a.imageType ? { type: a.imageType, bytes: a.bytes } : null;
  }
  async active(today: string) {
    return (await this.list()).filter((a) => a.enabled && a.startsOn <= today && today <= a.endsOn).map(served);
  }
  async count(batch: ImpressionBatch, today: string) {
    for (const it of batch.items) {
      const a = this.ads.get(it.id);
      if (!a || !a.enabled || a.startsOn > today || today > a.endsOn || !a.placements.includes(it.placement)) continue;
      const k = `${it.id}|${it.placement}|${today}`;
      this.counts.set(k, (this.counts.get(k) ?? 0) + it.n);
    }
  }
  async stats(sinceDay: string) {
    const sum = new Map<string, number>();
    for (const [k, n] of this.counts) {
      const [id, placement, day] = k.split("|") as [string, string, string];
      if (day >= sinceDay) sum.set(`${id}|${placement}`, (sum.get(`${id}|${placement}`) ?? 0) + n);
    }
    return [...sum].map(([k, impressions]) => {
      const [id, placement] = k.split("|") as [string, AdPlacement];
      return { id, placement, impressions };
    });
  }
  async close() {}
}

const COLS = "id, advertiser, title, line, placements, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, enabled, image_type, image_version";
const row = (r: Record<string, unknown>): AdRecord => ({
  id: r.id as string, advertiser: r.advertiser as string, title: r.title as string, line: r.line as string,
  placements: r.placements as AdPlacement[], startsOn: r.starts_on as string, endsOn: r.ends_on as string,
  enabled: r.enabled as boolean, imageType: (r.image_type as string | null) ?? null, imageVersion: r.image_version as number,
});

/** Postgres store. The tables come from migrations/002_ads.sql, applied by PgPersistence.init(). */
export class PgAdStore implements AdStore {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  async list() {
    return (await this.pool.query(`SELECT ${COLS} FROM ad_creatives ORDER BY created_at DESC`)).rows.map(row);
  }
  async create(a: AdInput) {
    const r = await this.pool.query(
      `INSERT INTO ad_creatives (id, advertiser, title, line, placements, starts_on, ends_on, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
      [randomUUID(), a.advertiser, a.title, a.line, a.placements, a.startsOn, a.endsOn, a.enabled],
    );
    return row(r.rows[0]);
  }
  async update(id: string, a: AdInput) {
    const r = await this.pool.query(
      `UPDATE ad_creatives SET advertiser = $2, title = $3, line = $4, placements = $5, starts_on = $6, ends_on = $7,
       enabled = $8, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [id, a.advertiser, a.title, a.line, a.placements, a.startsOn, a.endsOn, a.enabled],
    );
    return r.rows[0] ? row(r.rows[0]) : null;
  }
  async remove(id: string) {
    return ((await this.pool.query("DELETE FROM ad_creatives WHERE id = $1", [id])).rowCount ?? 0) > 0;
  }
  async setImage(id: string, type: string, bytes: Buffer) {
    const r = await this.pool.query(
      "UPDATE ad_creatives SET image = $2, image_type = $3, image_version = image_version + 1, updated_at = now() WHERE id = $1",
      [id, bytes, type],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async image(id: string) {
    const r = await this.pool.query("SELECT image, image_type FROM ad_creatives WHERE id = $1 AND image IS NOT NULL", [id]);
    return r.rows[0] ? { type: r.rows[0].image_type as string, bytes: r.rows[0].image as Buffer } : null;
  }
  async active(today: string) {
    const r = await this.pool.query(`SELECT ${COLS} FROM ad_creatives WHERE enabled AND starts_on <= $1 AND ends_on >= $1`, [today]);
    return r.rows.map(row).map(served);
  }
  async count(batch: ImpressionBatch, today: string) {
    for (const it of batch.items) {
      await this.pool.query(
        `INSERT INTO ad_impressions (creative_id, placement, day, count)
         SELECT id, $2, $3, $4 FROM ad_creatives
         WHERE id = $1 AND enabled AND $2 = ANY(placements) AND starts_on <= $3 AND ends_on >= $3
         ON CONFLICT (creative_id, placement, day) DO UPDATE SET count = ad_impressions.count + EXCLUDED.count`,
        [it.id, it.placement, today, it.n],
      );
    }
  }
  async stats(sinceDay: string) {
    const r = await this.pool.query(
      "SELECT creative_id, placement, sum(count)::int AS n FROM ad_impressions WHERE day >= $1 GROUP BY creative_id, placement",
      [sinceDay],
    );
    return r.rows.map((x) => ({ id: x.creative_id as string, placement: x.placement as AdPlacement, impressions: x.n as number }));
  }
  async close() {
    await this.pool.end();
  }
}
