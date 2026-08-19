import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import { CLIENT_DIR } from "../core/paths.js";
import { config } from "../core/config.js";
import {
  createUser,
  dropEnvelope,
  listEnvelopes,
  loadFile,
  purgeUser,
  readPublicUser,
  readVaultByLocator,
  saveFile,
  updateVault,
} from "../data/store.js";
import { publicJwk } from "../core/verify.js";
import { sanitizeAvatar } from "../services/avatar.js";
import { sanitizeDisplayName } from "../services/profile.js";
import { fetchGifBytes, searchGifs } from "../services/gifs.js";
import { MAX_FILE, MAX_JSON, assertSeal, handle, requireSigned, send } from "../middleware/auth.js";
import {
  assertFileId,
  assertLocator,
  assertPublicId,
  rateLimit,
} from "../middleware/security.js";

export function createHttpApp(sockets) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          mediaSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "no-referrer" },
      hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
    })
  );

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/ws") {
      res.setHeader("Cache-Control", "no-store");
    }
    if (/\.(?:jpg|jpeg|png|gif|webp|ico)$/i.test(req.path)) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use(express.json({ limit: MAX_JSON }));
  app.use(express.raw({ type: "application/octet-stream", limit: MAX_FILE }));

  app.use(express.static(CLIENT_DIR, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.(?:js|css|html)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  }));

  app.post("/", (_req, res) => {
    res.redirect(303, "/");
  });

  app.get("/api/config", (_req, res) => {
    send(res, 200, config);
  });

  app.get("/api/health", (_req, res) => {
    send(res, 200, { ok: true, store: "opaque-json", crypto: "none-on-server" });
  });

  app.get(
    "/api/gifs/search",
    rateLimit({ windowMs: 60_000, max: 40 }),
    handle(async (req, res) => {
      const q = String(req.query.q || "").trim().slice(0, 64);
      const data = await searchGifs(q, Number(req.query.page || 1));
      send(res, 200, data);
    })
  );

  app.get(
    "/api/gifs/fetch",
    rateLimit({ windowMs: 60_000, max: 80 }),
    handle(async (req, res) => {
      const { buffer, mime } = await fetchGifBytes(req.query.url);
      if (!/^image\/(gif|png|jpeg|webp)$/i.test(mime)) {
        throw Object.assign(new Error("Type média refusé"), { status: 415 });
      }
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(buffer);
    })
  );

  app.post(
    "/api/register",
    rateLimit({ windowMs: 60 * 60_000, max: 8 }),
    handle(async (req, res) => {
      const { publicId, locator, vault } = req.body || {};
      assertPublicId(publicId);
      assertLocator(locator);
      if (!vault) throw Object.assign(new Error("Inscription incomplète"), { status: 400 });
      if (!vault.identityPublicKey || !vault.exchangePublicKey || !vault.enc) {
        throw Object.assign(new Error("Coffre public incomplet"), { status: 400 });
      }
      vault.identityPublicKey = publicJwk(vault.identityPublicKey);
      vault.exchangePublicKey = publicJwk(vault.exchangePublicKey);
      vault.avatar = sanitizeAvatar(vault.avatar);
      vault.displayName = sanitizeDisplayName(vault.displayName);
      if (typeof vault.revision !== "number" || vault.revision < 1) vault.revision = 1;
      await createUser({ publicId, locator, vault });
      send(res, 201, { ok: true, publicId });
    })
  );

  app.get(
    "/api/vault/:locator",
    rateLimit({ windowMs: 60_000, max: 30 }),
    handle(async (req, res) => {
      assertLocator(req.params.locator);
      const found = await readVaultByLocator(req.params.locator);
      if (!found) throw Object.assign(new Error("Coffre introuvable"), { status: 404 });
      send(res, 200, { publicId: found.publicId, vault: found.vault });
    })
  );

  app.put(
    "/api/vault/:locator",
    rateLimit({ windowMs: 60_000, max: 40 }),
    handle(async (req, res) => {
      assertLocator(req.params.locator);
      const { publicId, vault } = req.body || {};
      assertPublicId(publicId);
      if (!vault) throw Object.assign(new Error("Mise à jour incomplète"), { status: 400 });
      await requireSigned(req, publicId);
      vault.identityPublicKey = publicJwk(vault.identityPublicKey);
      vault.exchangePublicKey = publicJwk(vault.exchangePublicKey);
      vault.avatar = sanitizeAvatar(vault.avatar);
      vault.displayName = sanitizeDisplayName(vault.displayName);
      await updateVault(req.params.locator, vault, publicId);
      send(res, 200, { ok: true });
    })
  );

  app.get(
    "/api/users/:publicId",
    rateLimit({ windowMs: 60_000, max: 120 }),
    handle(async (req, res) => {
      const publicId = decodeURIComponent(String(req.params.publicId || "")).trim();
      assertPublicId(publicId);
      const user = await readPublicUser(publicId);
      if (!user) throw Object.assign(new Error("Personne introuvable"), { status: 404 });
      send(res, 200, user);
    })
  );

  app.post(
    "/api/envelopes",
    rateLimit({ windowMs: 60_000, max: 180 }),
    handle(async (req, res) => {
      const { recipientId, seal, senderId } = req.body || {};
      assertPublicId(senderId);
      assertPublicId(recipientId);
      if (String(senderId).toLowerCase() === String(recipientId).toLowerCase()) {
        throw Object.assign(new Error("Destinataire invalide"), { status: 400 });
      }
      const headerId = req.headers["x-shard-id"];
      if (headerId !== senderId) {
        throw Object.assign(new Error("Identité incohérente"), { status: 401 });
      }
      await requireSigned(req, senderId);
      assertSeal(seal);
      const payload = await dropEnvelope({
        id: crypto.randomUUID(),
        recipientId,
        seal,
        createdAt: new Date().toISOString(),
      });
      const peers = sockets.get(recipientId);
      if (peers) {
        const notice = JSON.stringify({ type: "envelope", id: payload.id, createdAt: payload.createdAt });
        for (const ws of peers) {
          if (ws.readyState === 1) ws.send(notice);
        }
      }
      send(res, 201, { id: payload.id, createdAt: payload.createdAt });
    })
  );

  app.post(
    "/api/inbox/:publicId",
    rateLimit({ windowMs: 60_000, max: 120 }),
    handle(async (req, res) => {
      assertPublicId(req.params.publicId);
      await requireSigned(req, req.params.publicId);
      const items = await listEnvelopes(req.params.publicId, req.body?.since || null);
      send(res, 200, { items });
    })
  );

  app.put(
    "/api/files/:fileId",
    rateLimit({ windowMs: 60_000, max: 40 }),
    handle(async (req, res) => {
      assertFileId(req.params.fileId);
      const publicId = req.headers["x-shard-id"];
      assertPublicId(publicId);
      await requireSigned(req, publicId);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw Object.assign(new Error("Fichier vide"), { status: 400 });
      }
      if (req.body.length > MAX_FILE) {
        throw Object.assign(new Error("Fichier trop volumineux"), { status: 413 });
      }
      await saveFile(req.params.fileId, req.body);
      send(res, 201, { id: req.params.fileId, size: req.body.length });
    })
  );

  app.get(
    "/api/files/:fileId",
    rateLimit({ windowMs: 60_000, max: 120 }),
    handle(async (req, res) => {
      assertFileId(req.params.fileId);
      const publicId = req.headers["x-shard-id"];
      assertPublicId(publicId);
      await requireSigned(req, publicId);
      const file = await loadFile(req.params.fileId);
      if (!file) throw Object.assign(new Error("Fichier introuvable"), { status: 404 });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Shard-Size", String(file.size));
      res.end(file.buffer);
    })
  );

  app.post(
    "/api/purge",
    rateLimit({ windowMs: 60 * 60_000, max: 10 }),
    handle(async (req, res) => {
      const { publicId, locator } = req.body || {};
      assertPublicId(publicId);
      assertLocator(locator);
      await requireSigned(req, publicId);
      await purgeUser(publicId, locator);
      const peers = sockets.get(publicId);
      if (peers) {
        for (const ws of peers) ws.close();
        sockets.delete(publicId);
      }
      send(res, 200, { ok: true });
    })
  );

  return app;
}
