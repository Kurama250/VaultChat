import { bytesToB64, derivePairwiseKeyBytes, encryptFile, decryptFile, randomAesKeyBytes } from "../core/crypto.js";
import { apiPutFile } from "../core/api.js";
import { assertProfileImage } from "../core/media.js";
import { sanitizeDisplayName } from "../core/profile.js";
import { t } from "../core/i18n.js";
import { ctx, hooks, state } from "../core/state.js";
import { normalizePublicId, otherMembers } from "../core/util.js";
import { persistVault, rememberMessage, saveLocalMessages } from "../core/vault.js";
import { lookupAndStore } from "./contacts.js";
import { fanout } from "./protocol.js";

function peerIdsFromConversations() {
  const ids = new Set();
  for (const conv of Object.values(state.conversations)) {
    if (!conv || conv.status === "declined") continue;
    for (const id of conv.members || []) {
      if (id && id !== state.publicId) ids.add(id);
    }
  }
  return [...ids];
}

async function broadcastProfileUpdate() {
  const peers = peerIdsFromConversations();
  if (!peers.length) return;
  try {
    await fanout(peers, {
      kind: "profile-update",
      displayName: state.displayName || null,
      avatar: state.avatar || null,
    });
  } catch (err) {
    console.warn("Profil non diffusé", err);
  }
}

export async function inviteUser(publicId, groupConvId) {
  const target = normalizePublicId(publicId);
  if (!target) throw new Error(t("errPasteId"));
  if (!/^shd_[a-f0-9]{20}$/i.test(target)) throw new Error(t("errInvalidId"));
  if (target === String(state.publicId || "").toLowerCase()) throw new Error(t("errOwnId"));
  try {
    await lookupAndStore(target);
  } catch (err) {
    const msg = String(err.message || "");
    if (/introuvable|404|not found/i.test(msg)) throw new Error(t("errNotFound"));
    throw err;
  }
  if (groupConvId) {
    const conv = state.conversations[groupConvId];
    if (!conv || conv.type !== "group" || conv.status !== "active") throw new Error(t("errGroupInactive"));
    if (conv.adminId !== state.publicId) throw new Error(t("errAdminOnly"));
    if (conv.members.some((id) => String(id).toLowerCase() === target)) {
      throw new Error(t("errAlreadyMember"));
    }
    conv.members.push(target);
    await fanout([target], {
      kind: "invite",
      conversationId: conv.id,
      convType: "group",
      title: conv.title,
      members: conv.members,
      convKeyB64: conv.convKeyB64,
      adminId: conv.adminId,
    });
    try { await persistVault(); } catch (err) { console.warn("Coffre non synchronisé", err); }
    rememberMessage(conv.id, {
      id: crypto.randomUUID(),
      kind: "system",
      from: state.publicId,
      sentAt: new Date().toISOString(),
      text: t("sysInviteSent", { id: target }),
    });
    await saveLocalMessages();
    return conv.id;
  }
  const ids = [state.publicId, target].sort();
  const conversationId = `dm_${ids.join("_")}`;
  const existing = state.conversations[conversationId];
  if (existing?.status === "active") return existing.id;

  const contact = state.contacts[target];
  const convKeyB64 = bytesToB64(
    await derivePairwiseKeyBytes(state.exchange.privateKey, contact.exchangePublicKey, conversationId)
  );
  state.messages[conversationId] = [];
  state.conversations[conversationId] = {
    id: conversationId,
    type: "dm",
    title: target,
    members: ids,
    convKeyB64,
    cryptoVersion: 2,
    adminId: state.publicId,
    status: "pending_out",
    createdAt: new Date().toISOString(),
    invitedBy: state.publicId,
  };
  await fanout([target], {
    kind: "invite",
    conversationId,
    convType: "dm",
    cryptoVersion: 2,
    title: target,
    members: ids,
    adminId: state.publicId,
    reset: true,
  });
  rememberMessage(conversationId, {
    id: crypto.randomUUID(),
    kind: "system",
    from: state.publicId,
    sentAt: new Date().toISOString(),
    text: t("sysDmInviteSent", { id: target }),
  });
  try { await persistVault(); } catch (err) { console.warn("Coffre non synchronisé", err); }
  await saveLocalMessages();
  return conversationId;
}

export async function createGroup(title, memberIds = []) {
  if (state.busy) throw new Error(t("errBusy"));
  const name = String(title || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error(t("errNoName"));
  if (name.length > 40) throw new Error(t("errNameLong"));
  const uniqueIds = [...new Set((memberIds || []).map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.includes(state.publicId)) throw new Error(t("errSelfInvite"));
  const dup = Object.values(state.conversations).find(
    (conv) =>
      conv.type === "group" &&
      conv.status !== "declined" &&
      String(conv.title || "").trim().toLowerCase() === name.toLowerCase()
  );
  if (dup) {
    state.activeId = dup.id;
    return dup.id;
  }
  const now = Date.now();
  if (now - state.lastGroupAt < 400) throw new Error(t("errWait"));

  state.busy = true;
  state.lastGroupAt = now;
  try {
    const conversationId = `grp_${crypto.randomUUID().replaceAll("-", "")}`;
    const convKeyB64 = bytesToB64(await randomAesKeyBytes());
    state.conversations[conversationId] = {
      id: conversationId,
      type: "group",
      title: name,
      members: [state.publicId],
      convKeyB64,
      adminId: state.publicId,
      status: "active",
      createdAt: new Date().toISOString(),
      invitedBy: state.publicId,
      avatar: null,
    };
    rememberMessage(conversationId, {
      id: crypto.randomUUID(),
      kind: "system",
      from: state.publicId,
      sentAt: new Date().toISOString(),
      text: t("sysGroupCreated"),
    });
    for (const id of uniqueIds) await inviteUser(id, conversationId);
    try { await persistVault(); } catch (err) { console.warn("Coffre non synchronisé", err); }
    await saveLocalMessages();
    return conversationId;
  } finally {
    state.busy = false;
  }
}

export async function removeConversation(leave) {
  const conv = state.conversations[state.activeId];
  if (!conv) return;
  const peers = otherMembers(conv);
  try {
    if (conv.type === "group") {
      await fanout(peers, {
        kind: "group-update",
        conversationId: conv.id,
        action: "leave",
      });
    } else {
      await fanout(peers, {
        kind: "conv-sync",
        conversationId: conv.id,
        action: "remove",
      });
    }
  } catch (err) {
    console.warn("Suppression non synchronisée", err);
  }
  delete state.conversations[conv.id];
  delete state.messages[conv.id];
  delete state.unread[conv.id];
  state.activeId = null;
  hooks.closeThreadView();
  await persistVault();
  await saveLocalMessages();
  hooks.renderApp();
}

export async function respondInvite(accepted) {
  const conv = state.conversations[state.activeId];
  if (!conv) return;
  conv.status = accepted ? "active" : "declined";
  await fanout(otherMembers(conv), {
    kind: "invite-response",
    conversationId: conv.id,
    accepted,
  });
  rememberMessage(conv.id, {
    id: crypto.randomUUID(),
    kind: "system",
    from: state.publicId,
    sentAt: new Date().toISOString(),
    text: accepted ? t("sysYouAccepted") : t("sysYouDeclined"),
  });
  await persistVault();
  await saveLocalMessages();
  if (accepted) {
    state.activeId = conv.id;
    hooks.openThreadView();
  } else {
    state.activeId = null;
    hooks.closeThreadView();
  }
  hooks.renderApp();
}

export async function renameGroup(title) {
  const conv = state.conversations[state.activeId];
  if (!conv || conv.type !== "group") throw new Error(t("errNotGroup"));
  const name = String(title || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) throw new Error(t("errNameInvalid"));
  conv.title = name;
  await fanout(conv.members, {
    kind: "group-update",
    conversationId: conv.id,
    action: "rename",
    title: name,
  });
  rememberMessage(conv.id, {
    id: crypto.randomUUID(),
    kind: "system",
    from: state.publicId,
    sentAt: new Date().toISOString(),
    text: t("sysGroupRenamed", { title: name }),
  });
  await persistVault();
  await saveLocalMessages();
  hooks.renderApp();
}

export async function setGroupImage(file) {
  const conv = state.conversations[state.activeId];
  if (!conv || conv.type !== "group") throw new Error(t("errNotGroup"));
  const parsed = await assertProfileImage(file);
  const enc = await encryptFile(new File([file], parsed.name, { type: parsed.mime }));
  const fileId = `fil_${crypto.randomUUID().replaceAll("-", "")}`;
  await apiPutFile(ctx(), fileId, enc.cipherBytes);
  conv.avatar = { fileId, keyB64: enc.keyB64, ext: parsed.ext, mime: parsed.mime };
  const plain = await decryptFile(enc.cipherBytes, enc.keyB64);
  state.avatarCache[fileId] = URL.createObjectURL(new Blob([plain], { type: parsed.mime }));
  await fanout(conv.members, {
    kind: "group-update",
    conversationId: conv.id,
    action: "avatar",
    avatar: conv.avatar,
  });
  await persistVault();
  hooks.renderApp();
}

export async function setDisplayName(raw) {
  const name = sanitizeDisplayName(raw);
  if (!name) throw new Error("DISPLAY_NAME");
  state.displayName = name;
  for (const list of Object.values(state.messages)) {
    for (const msg of list) {
      if (msg.from === state.publicId) msg.fromDisplayName = state.displayName;
    }
  }
  await persistVault();
  await saveLocalMessages();
  await broadcastProfileUpdate();
  hooks.renderApp();
}

export async function setProfileImage(file) {
  const parsed = await assertProfileImage(file);
  const safeFile = new File([file], parsed.name, { type: parsed.mime });
  const enc = await encryptFile(safeFile);
  const fileId = `fil_${crypto.randomUUID().replaceAll("-", "")}`;
  await apiPutFile(ctx(), fileId, enc.cipherBytes);
  state.avatar = { fileId, keyB64: enc.keyB64, ext: parsed.ext, mime: parsed.mime };
  if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
  const plain = await decryptFile(enc.cipherBytes, enc.keyB64);
  state.avatarUrl = URL.createObjectURL(new Blob([plain], { type: parsed.mime }));
  state.avatarCache[fileId] = state.avatarUrl;
  await persistVault();
  hooks.renderApp();
  await broadcastProfileUpdate();
  hooks.renderApp();
}
