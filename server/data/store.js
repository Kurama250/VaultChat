import fs from "node:fs/promises";
import { prisma } from "../core/db.js";
import {
  envelopeDir,
  envelopePath,
  filePath,
  vaultPath,
} from "../core/paths.js";

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

export async function createUser({ publicId, locator, vault }) {
  const existingLocator = await prisma.userIndex.findUnique({ where: { locator } });
  if (existingLocator) {
    const err = new Error("Compte déjà existant pour cette clé");
    err.status = 409;
    throw err;
  }
  const existingId = await prisma.userIndex.findUnique({ where: { publicId } });
  if (existingId) {
    const err = new Error("Identifiant public déjà pris");
    err.status = 409;
    throw err;
  }
  await writeJson(vaultPath(locator), vault);
  await prisma.userIndex.create({ data: { publicId, locator } });
}

export async function readVaultByLocator(locator) {
  const row = await prisma.userIndex.findUnique({ where: { locator } });
  if (!row) return null;
  try {
    const vault = await readJson(vaultPath(locator));
    return { ...row, vault };
  } catch {
    return null;
  }
}

export async function readPublicUser(publicId) {
  const row = await prisma.userIndex.findUnique({ where: { publicId } });
  if (!row) return null;
  try {
    const vault = await readJson(vaultPath(row.locator));
    return {
      publicId: row.publicId,
      identityPublicKey: vault.identityPublicKey,
      exchangePublicKey: vault.exchangePublicKey,
      avatar: vault.avatar || null,
      displayName: vault.displayName || null,
    };
  } catch {
    return null;
  }
}

export async function updateVault(locator, vault, publicId) {
  const row = await prisma.userIndex.findUnique({ where: { locator } });
  if (!row || row.publicId !== publicId) {
    const err = new Error("Coffre introuvable");
    err.status = 404;
    throw err;
  }
  const current = await readJson(vaultPath(locator));
  if ((vault.revision | 0) < (current.revision | 0)) {
    const err = new Error("Révision du coffre obsolète");
    err.status = 409;
    throw err;
  }
  await writeJson(vaultPath(locator), vault);
}

export async function dropEnvelope({ id, recipientId, seal, createdAt }) {
  const user = await prisma.userIndex.findUnique({ where: { publicId: recipientId } });
  if (!user) {
    const err = new Error("Destinataire inconnu");
    err.status = 404;
    throw err;
  }
  await fs.mkdir(envelopeDir(recipientId), { recursive: true });
  const payload = { id, recipientId, createdAt, seal };
  await writeJson(envelopePath(recipientId, id), payload);
  await prisma.envelopeIndex.create({ data: { id, recipientId, createdAt: new Date(createdAt) } });
  return payload;
}

export async function listEnvelopes(recipientId, sinceIso) {
  const since = sinceIso ? new Date(sinceIso) : new Date(0);
  const rows = await prisma.envelopeIndex.findMany({
    where: { recipientId, createdAt: { gt: since } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const out = [];
  for (const row of rows) {
    try {
      out.push(await readJson(envelopePath(recipientId, row.id)));
    } catch {
    }
  }
  return out;
}

export async function saveFile(fileId, buffer) {
  await fs.writeFile(filePath(fileId), buffer);
  await prisma.fileIndex.create({
    data: { id: fileId, size: buffer.length },
  });
}

export async function loadFile(fileId) {
  const row = await prisma.fileIndex.findUnique({ where: { id: fileId } });
  if (!row) return null;
  try {
    const buffer = await fs.readFile(filePath(fileId));
    return { buffer, size: row.size };
  } catch {
    return null;
  }
}

export async function purgeUser(publicId, locator) {
  const row = await prisma.userIndex.findUnique({ where: { publicId } });
  if (!row || row.locator !== locator) {
    const err = new Error("Compte introuvable");
    err.status = 404;
    throw err;
  }
  const envelopes = await prisma.envelopeIndex.findMany({ where: { recipientId: publicId } });
  for (const env of envelopes) {
    await fs.rm(envelopePath(publicId, env.id), { force: true });
  }
  await prisma.envelopeIndex.deleteMany({ where: { recipientId: publicId } });
  await fs.rm(vaultPath(locator), { force: true });
  await fs.rm(envelopeDir(publicId), { recursive: true, force: true });
  await prisma.userIndex.delete({ where: { publicId } });
}
