import { canonicalBytes, sha256Hex, verifyIdentitySignature } from "../core/verify.js";
import { readPublicUser } from "../data/store.js";

export const MAX_JSON = 512 * 1024;
export const MAX_FILE = 20 * 1024 * 1024;

export function send(res, status, body) {
  res.status(status).json(body);
}

export function handle(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status || 500;
      send(res, status, { error: err.message || "Erreur serveur" });
    });
  };
}

export function assertSeal(seal) {
  if (!seal || typeof seal !== "object") throw Object.assign(new Error("Sceau manquant"), { status: 400 });
  if (!seal.ephPub || !seal.iv || !seal.ct) {
    throw Object.assign(new Error("Sceau incomplet"), { status: 400 });
  }
}

function signedBody(req) {
  if (Buffer.isBuffer(req.body)) return { sha256: sha256Hex(req.body) };
  return req.body ?? null;
}

export async function requireSigned(req, publicId) {
  const ts = Number(req.headers["x-shard-ts"]);
  const sig = req.headers["x-shard-sig"];
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 2 * 60 * 1000) {
    throw Object.assign(new Error("Horodatage invalide"), { status: 401 });
  }
  if (typeof sig !== "string") {
    throw Object.assign(new Error("Signature manquante"), { status: 401 });
  }
  const user = await readPublicUser(publicId);
  if (!user) throw Object.assign(new Error("Compte inconnu"), { status: 404 });
  const payload = canonicalBytes({
    method: req.method,
    path: (req.originalUrl || req.url || req.path).split("?")[0],
    ts,
    body: signedBody(req),
  });
  const ok = verifyIdentitySignature(user.identityPublicKey, payload, sig);
  if (!ok) throw Object.assign(new Error("Signature refusée"), { status: 401 });
  return user;
}
