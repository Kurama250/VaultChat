import { decryptFile, publicJwk } from "../core/crypto.js";
import { apiGetFile, apiLookupUser } from "../core/api.js";
import { sanitizeAvatarMeta } from "../core/media.js";
import { sanitizeDisplayName } from "../core/profile.js";
import { DEFAULT_AVATAR, ctx, hooks, state } from "../core/state.js";
import { convAvatarUrl, personAvatarUrl } from "../core/util.js";
import { persistVault } from "../core/vault.js";

const CONTACT_TTL_MS = 45_000;

export async function ensureContact(user) {
  const prev = state.contacts[user.publicId] || {};
  const incomingAvatar = sanitizeAvatarMeta(user.avatar);
  const nextAvatar = incomingAvatar || prev.avatar || null;
  const nextName = sanitizeDisplayName(user.displayName) || prev.displayName || null;
  state.contacts[user.publicId] = {
    publicId: user.publicId,
    identityPublicKey: publicJwk(user.identityPublicKey),
    exchangePublicKey: publicJwk(user.exchangePublicKey),
    avatar: nextAvatar,
    displayName: nextName,
    fetchedAt: Date.now(),
  };
  return state.contacts[user.publicId];
}

export function applyPeerProfile(publicId, { displayName, avatar } = {}) {
  const contact = state.contacts[publicId];
  if (!contact) return false;
  let changed = false;
  const name = sanitizeDisplayName(displayName);
  if (name && contact.displayName !== name) {
    contact.displayName = name;
    changed = true;
  }
  const pic = sanitizeAvatarMeta(avatar);
  if (pic && (contact.avatar?.fileId !== pic.fileId || contact.avatar?.keyB64 !== pic.keyB64)) {
    contact.avatar = pic;
    changed = true;
  }
  if (changed) contact.fetchedAt = Date.now();
  return changed;
}

export async function lookupAndStore(publicId, { force = false } = {}) {
  const cached = state.contacts[publicId];
  const fresh = cached?.fetchedAt && Date.now() - cached.fetchedAt < CONTACT_TTL_MS;
  if (!force && cached?.identityPublicKey && fresh) return cached;
  const user = await apiLookupUser(publicId);
  const prevFile = cached?.avatar?.fileId || null;
  await ensureContact(user);
  const next = state.contacts[publicId];
  if (next?.avatar?.fileId && next.avatar.fileId !== prevFile) {
    await avatarUrlFromMeta(next.avatar);
  } else if (next?.avatar) {
    await avatarUrlFromMeta(next.avatar);
  }
  return next;
}

export async function refreshActivePeerProfiles() {
  const ids = [];
  for (const conv of Object.values(state.conversations)) {
    if (conv.status === "declined") continue;
    for (const id of conv.members || []) {
      if (id && id !== state.publicId && !ids.includes(id)) ids.push(id);
    }
  }
  for (let i = 0; i < ids.length; i += 3) {
    await Promise.all(ids.slice(i, i + 3).map((id) => lookupAndStore(id, { force: true }).catch(() => null)));
  }
  try {
    await persistVault();
  } catch {
  }
  paintLiveAvatars();
  hooks.renderApp();
}

export async function avatarUrlFromMeta(meta) {
  const avatar = sanitizeAvatarMeta(meta);
  if (!avatar) return null;
  if (state.avatarCache[avatar.fileId]) return state.avatarCache[avatar.fileId];
  try {
    const cipher = await apiGetFile(ctx(), avatar.fileId);
    if (!cipher?.length) return null;
    const plain = await decryptFile(cipher, avatar.keyB64);
    if (!plain?.length) return null;
    const url = URL.createObjectURL(new Blob([plain], { type: avatar.mime || "image/jpeg" }));
    state.avatarCache[avatar.fileId] = url;
    return url;
  } catch (err) {
    console.warn("Avatar illisible", avatar.fileId, err);
    return null;
  }
}

export async function ingestPeerProfile(publicId, profile = {}) {
  const changed = applyPeerProfile(publicId, profile);
  const avatar = sanitizeAvatarMeta(profile.avatar) || state.contacts[publicId]?.avatar;
  if (avatar) await avatarUrlFromMeta(avatar);
  return changed;
}

export function paintOwnAvatar() {
  const img = document.getElementById("me-avatar");
  if (!img) return;
  bindAvatarFallback(img);
  img.src = state.avatarUrl || DEFAULT_AVATAR;
  img.hidden = false;
}

export function bindAvatarFallback(img) {
  if (!img || img.dataset.fallbackBound) return;
  img.dataset.fallbackBound = "1";
  img.addEventListener("error", () => {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = "1";
    img.src = DEFAULT_AVATAR;
  });
}

export function paintLiveAvatars() {
  paintOwnAvatar();
  for (const img of document.querySelectorAll("img.conv-avatar[data-conv]")) {
    const conv = state.conversations[img.dataset.conv];
    if (!conv) continue;
    bindAvatarFallback(img);
    img.src = convAvatarUrl(conv);
  }
  const thread = document.getElementById("thread-avatar");
  if (thread && state.activeId) {
    const conv = state.conversations[state.activeId];
    if (conv) {
      thread.dataset.conv = conv.id;
      bindAvatarFallback(thread);
      thread.src = convAvatarUrl(conv);
    }
  }
  for (const img of document.querySelectorAll("img.msg-avatar[data-user]")) {
    bindAvatarFallback(img);
    img.src = personAvatarUrl(img.dataset.user);
  }
}
