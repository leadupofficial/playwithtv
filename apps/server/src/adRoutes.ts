import type { FastifyInstance, onRequestHookHandler } from "fastify";
import { z } from "zod";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_TYPES, AdInput } from "@scp/protocol";
import { type AdStore, daysAgo, imageMatches, todayIST } from "./ads.js";

const Id = z.uuid();

/**
 * Public sponsor feed for TVs and the admin's sponsor management. Impressions arrive over the TVs'
 * authenticated room connections (Hub.onImpressions), never through an open endpoint.
 */
export async function registerAdRoutes(http: FastifyInstance, ads: AdStore, adminGuard: onRequestHookHandler) {
  http.get("/api/ads", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return { ads: await ads.active(todayIST()) };
  });

  http.get<{ Params: { id: string } }>("/api/ads/:id/image", async (req, reply) => {
    const img = Id.safeParse(req.params.id).success ? await ads.image(req.params.id) : null;
    if (!img) return reply.status(404).send({ error: "not_found", message: "No such image." });
    // the URL carries ?v=<version>, so a replaced image gets a new URL and this copy can be cached
    return reply.header("cache-control", "public, max-age=86400").type(img.type).send(img.bytes);
  });

  await http.register(async (admin) => {
    admin.addHook("onRequest", adminGuard);
    admin.addContentTypeParser([...AD_IMAGE_TYPES], { parseAs: "buffer", bodyLimit: AD_IMAGE_MAX_BYTES }, (_req, body, done) => done(null, body));

    admin.get("/api/admin/ads", async () => {
      const today = todayIST();
      return { today, ads: await ads.list(), stats: await ads.stats(daysAgo(today, 29)) };
    });

    admin.post("/api/admin/ads", async (req, reply) => {
      const body = AdInput.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: "bad_request", message: body.error.issues[0]?.message ?? "invalid" });
      return reply.status(201).send(await ads.create(body.data));
    });

    admin.put<{ Params: { id: string } }>("/api/admin/ads/:id", async (req, reply) => {
      const body = AdInput.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: "bad_request", message: body.error.issues[0]?.message ?? "invalid" });
      const a = Id.safeParse(req.params.id).success ? await ads.update(req.params.id, body.data) : null;
      return a ?? reply.status(404).send({ error: "not_found", message: "No such sponsor." });
    });

    admin.delete<{ Params: { id: string } }>("/api/admin/ads/:id", async (req, reply) => {
      const ok = Id.safeParse(req.params.id).success && (await ads.remove(req.params.id));
      return ok ? { ok } : reply.status(404).send({ error: "not_found", message: "No such sponsor." });
    });

    admin.put<{ Params: { id: string } }>("/api/admin/ads/:id/image", { bodyLimit: AD_IMAGE_MAX_BYTES }, async (req, reply) => {
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || !imageMatches(type, bytes)) {
        return reply.status(400).send({ error: "bad_request", message: "Upload a PNG, JPEG or WebP image (max 300 KB)." });
      }
      const ok = Id.safeParse(req.params.id).success && (await ads.setImage(req.params.id, type, bytes));
      return ok ? { ok } : reply.status(404).send({ error: "not_found", message: "No such sponsor." });
    });
  });
}
