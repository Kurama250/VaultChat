import crypto from "node:crypto";

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function canonicalBytes(obj) {
  return Buffer.from(stableStringify(obj), "utf8");
}

export function publicJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw Object.assign(new Error("Clé publique invalide"), { status: 400 });
  }
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export function verifyIdentitySignature(identityPublicKey, payloadBytes, signatureB64) {
  const key = crypto.createPublicKey({
    key: publicJwk(identityPublicKey),
    format: "jwk",
  });
  return crypto.verify(
    "sha256",
    payloadBytes,
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signatureB64, "base64")
  );
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
