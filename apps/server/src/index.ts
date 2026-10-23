import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, productionProblems } from "./config.js";
import { buildApp } from "./app.js";
import { MemoryPersistence, PgPersistence, type Persistence } from "./persistence.js";
import { MemoryPresence, RedisPresence, type Presence } from "./presence.js";
import { MemoryAdStore, PgAdStore, type AdStore } from "./ads.js";

const cfg = loadConfig();
const problems = productionProblems(cfg);
if (problems.length) {
  console.error(`Refusing to start in production:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
cfg.webDist ??= join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

const db: Persistence = cfg.databaseUrl ? new PgPersistence(cfg.databaseUrl) : new MemoryPersistence();
const presence: Presence = cfg.redisUrl ? new RedisPresence(cfg.redisUrl) : new MemoryPresence();
await db.init(); // also applies the ad tables migration
const ads: AdStore = cfg.databaseUrl ? new PgAdStore(cfg.databaseUrl) : new MemoryAdStore();

const app = await buildApp(cfg, db, presence, { logger: true, ads });
await app.http.listen({ port: cfg.port, host: "0.0.0.0" });
app.http.log.info({ db: db.kind, presence: presence.kind, publicUrl: cfg.publicUrl }, "Play With TV hub ready");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    await app.close();
    await db.close();
    await ads.close();
    await presence.close();
    process.exit(0);
  });
}
