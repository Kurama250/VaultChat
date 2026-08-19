const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToB64(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2 !== 0) throw new Error("Clé hexadécimale invalide");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function formatLoginKey(bytes) {
  const hex = bytesToHex(bytes);
  return hex.match(/.{1,8}/g).join("-").toUpperCase();
}

export function parseLoginKey(text) {
  const bytes = hexToBytes(text);
  if (bytes.length !== 32) throw new Error("La clé doit faire 256 bits (64 hex)");
  return bytes;
}

export function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function publicJwk(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function digestSha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function sha256Hex(bytes) {
  return bytesToHex(await digestSha256(bytes));
}

async function hkdfAes(ikm, salt, info) {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: te.encode(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapKeyFromLogin(loginBytes) {
  return hkdfAes(loginBytes, te.encode("shard-v1-salt"), "aes-256-gcm-wrap");
}

export async function locatorFromLogin(loginBytes) {
  return bytesToHex(await digestSha256(concatBytes(te.encode("shard-locator-v1"), loginBytes)));
}

export async function generateLoginKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { bytes, formatted: formatLoginKey(bytes) };
}

export async function generateIdentity() {
  const identity = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exchange = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { identity, exchange };
}

export async function exportPrivateJwk(key) {
  return crypto.subtle.exportKey("jwk", key);
}

export async function importIdentity(jwk, usages) {
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    usages
  );
}

export async function importExchange(jwk, usages) {
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    true,
    usages
  );
}

export async function publicIdFromIdentityJwk(jwk) {
  const key = await importIdentity(publicJwk(jwk), ["verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const digest = await digestSha256(raw);
  return `shd_${bytesToHex(digest).slice(0, 20)}`;
}

export async function aesEncrypt(key, plaintextBytes, additionalData) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv };
  if (additionalData) params.additionalData = additionalData;
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, plaintextBytes));
  return { iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

export async function aesDecrypt(key, ivB64, ctB64, additionalData) {
  const iv = b64ToBytes(ivB64);
  const ct = b64ToBytes(ctB64);
  const params = { name: "AES-GCM", iv };
  if (additionalData) params.additionalData = additionalData;
  const pt = await crypto.subtle.decrypt(params, key, ct);
  return new Uint8Array(pt);
}

export async function derivePairwiseKeyBytes(myPrivateKey, theirPubJwk, conversationId) {
  const theirPub = await importExchange(publicJwk(theirPubJwk), []);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: theirPub }, myPrivateKey, 256)
  );
  const salt = await digestSha256(te.encode(`shard-pair-v2:${conversationId}`));
  const base = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: te.encode("aes-256-gcm-dm") },
      base,
      256
    )
  );
}

export async function encryptJson(key, obj) {
  return aesEncrypt(key, te.encode(stableStringify(obj)));
}

export async function decryptJson(key, enc) {
  const bytes = await aesDecrypt(key, enc.iv, enc.ct);
  return JSON.parse(td.decode(bytes));
}

export async function importAesRaw(rawBytes) {
  return crypto.subtle.importKey("raw", rawBytes, "AES-GCM", true, ["encrypt", "decrypt"]);
}

export async function randomAesKeyBytes() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function sealTo(recipientExchangeJwk, plaintextBytes) {
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const theirPub = await importExchange(publicJwk(recipientExchangeJwk), []);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirPub }, eph.privateKey, 256));
  const ephPub = await crypto.subtle.exportKey("jwk", eph.publicKey);
  const salt = await digestSha256(te.encode(stableStringify(publicJwk(ephPub))));
  const aes = await hkdfAes(bits, salt, "shard-seal-v1");
  const enc = await aesEncrypt(aes, plaintextBytes);
  return { ephPub: publicJwk(ephPub), iv: enc.iv, ct: enc.ct };
}

export async function openSeal(seal, myExchangePrivateKey) {
  const ephPub = await importExchange(publicJwk(seal.ephPub), []);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: ephPub }, myExchangePrivateKey, 256)
  );
  const salt = await digestSha256(te.encode(stableStringify(publicJwk(seal.ephPub))));
  const aes = await hkdfAes(bits, salt, "shard-seal-v1");
  return aesDecrypt(aes, seal.iv, seal.ct);
}

export async function signBytes(identityPrivateKey, bytes) {
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identityPrivateKey, bytes)
  );
  return bytesToB64(sig);
}

export async function verifyBytes(identityPublicJwk, bytes, signatureB64) {
  const key = await importIdentity(publicJwk(identityPublicJwk), ["verify"]);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64ToBytes(signatureB64),
    bytes
  );
}

export async function signObject(identityPrivateKey, obj) {
  return signBytes(identityPrivateKey, te.encode(stableStringify(obj)));
}

export async function verifyObject(identityPublicJwk, obj, signatureB64) {
  return verifyBytes(identityPublicJwk, te.encode(stableStringify(obj)), signatureB64);
}

export async function buildPublicVault({ publicId, identityJwk, exchangeJwk, wrapKey, privateVault, revision }) {
  const enc = await encryptJson(wrapKey, privateVault);
  return {
    version: 1,
    revision,
    publicId,
    identityPublicKey: publicJwk(identityJwk),
    exchangePublicKey: publicJwk(exchangeJwk),
    avatar: privateVault.avatar || null,
    displayName: privateVault.displayName || null,
    enc,
  };
}

export async function emptyPrivateVault(publicId) {
  return {
    version: 1,
    publicId,
    contacts: {},
    conversations: {},
    avatar: null,
    displayName: null,
  };
}

export async function encryptFile(file) {
  const keyBytes = await randomAesKeyBytes();
  const key = await importAesRaw(keyBytes);
  const data = new Uint8Array(await file.arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return {
    keyB64: bytesToB64(keyBytes),
    cipherBytes: concatBytes(iv, ct),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function decryptFile(cipherBytes, keyB64) {
  const key = await importAesRaw(b64ToBytes(keyB64));
  const iv = cipherBytes.slice(0, 12);
  const ct = cipherBytes.slice(12);
  return aesDecrypt(key, bytesToB64(iv), bytesToB64(ct));
}
