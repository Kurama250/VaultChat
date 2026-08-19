import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const CLIENT_DIR = path.join(ROOT, "client");
export const VAULTS_DIR = path.join(DATA_DIR, "vaults");
export const ENVELOPES_DIR = path.join(DATA_DIR, "envelopes");
export const FILES_DIR = path.join(DATA_DIR, "files");

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, VAULTS_DIR, ENVELOPES_DIR, FILES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const ID_RE = /^[a-zA-Z0-9_-]+$/;

export function assertSafeId(id, label = "id") {
  if (typeof id !== "string" || id.length < 8 || id.length > 128 || !ID_RE.test(id)) {
    const err = new Error(`Identifiant ${label} invalide`);
    err.status = 400;
    throw err;
  }
  return id;
}

export function vaultPath(locator) {
  return path.join(VAULTS_DIR, `${assertSafeId(locator, "locator")}.json`);
}

export function envelopeDir(recipientId) {
  return path.join(ENVELOPES_DIR, assertSafeId(recipientId, "recipient"));
}

export function envelopePath(recipientId, envelopeId) {
  return path.join(envelopeDir(recipientId), `${assertSafeId(envelopeId, "envelope")}.json`);
}

export function filePath(fileId) {
  return path.join(FILES_DIR, assertSafeId(fileId, "file"));
}
