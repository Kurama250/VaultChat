import {
  aesDecrypt,
  aesEncrypt,
  bytesToB64,
  b64ToBytes,
  derivePairwiseKeyBytes,
  importAesRaw,
  openSeal,
  publicIdFromIdentityJwk,
  publicJwk,
  randomAesKeyBytes,
  sealTo,
  signObject,
  stableStringify,
  verifyObject,
} from "../core/crypto.js";
import { apiInbox, apiSendEnvelope } from "../core/api.js";
import { idbGet, idbSet } from "../core/idb.js";
import { sanitizeAvatarMeta } from "../core/media.js";
import { t } from "../core/i18n.js";
import { ctx, hooks, state, td, te } from "../core/state.js";
import { labelFor } from "../core/util.js";
import { persistVault, rememberMessage, saveLocalMessages, syncConvPreview, unreadCount, updateDocTitle } from "../core/vault.js";
import { ensureContact, ingestPeerProfile, lookupAndStore } from "./contacts.js";

export async function attachSignature(inner) {
  const { sig, ...rest } = inner;
  rest.from = state.publicId;
  rest.fromIdentityPublicKey = publicJwk(state.identityJwk);
  rest.fromExchangePublicKey = publicJwk(state.exchangeJwk);
  rest.fromDisplayName = state.displayName || null;
  rest.fromAvatar = sanitizeAvatarMeta(state.avatar);
  rest.sentAt = rest.sentAt || new Date().toISOString();
  rest.sig = await signObject(state.identity.privateKey, rest);
  return rest;
}

export async function verifyInner(inner) {
  const { sig, ...rest } = inner;
  if (!sig) return false;
  const expectedId = await publicIdFromIdentityJwk(inner.fromIdentityPublicKey);
  if (expectedId !== inner.from) return false;
  return verifyObject(inner.fromIdentityPublicKey, rest, sig);
}

export async function fanout(memberIds, inner) {
  const signed = await attachSignature(inner);
  const bytes = te.encode(stableStringify(signed));
  for (const memberId of memberIds) {
    if (memberId === state.publicId) continue;
    const contact = await lookupAndStore(memberId);
    const seal = await sealTo(contact.exchangePublicKey, bytes);
    await apiSendEnvelope(ctx(), memberId, seal);
  }
  return signed;
}

async function decryptContent(conv, contentEnc) {
  const key = await importAesRaw(b64ToBytes(conv.convKeyB64));
  const bytes = await aesDecrypt(key, contentEnc.iv, contentEnc.ct);
  return JSON.parse(td.decode(bytes));
}

export async function decryptMessageContent(conv, inner) {
  if (inner.msgKeyB64) {
    const key = await importAesRaw(b64ToBytes(inner.msgKeyB64));
    const aad = te.encode(String(inner.conversationId || conv.id));
    const bytes = await aesDecrypt(key, inner.contentEnc.iv, inner.contentEnc.ct, aad);
    return JSON.parse(td.decode(bytes));
  }
  if (!conv?.convKeyB64) {
    const err = new Error("enveloppe hors ordre");
    err.retry = true;
    throw err;
  }
  return decryptContent(conv, inner.contentEnc);
}

export async function encryptContentForRecipient(content, conversationId) {
  const keyBytes = await randomAesKeyBytes();
  const key = await importAesRaw(keyBytes);
  const aad = te.encode(String(conversationId));
  const contentEnc = await aesEncrypt(key, te.encode(JSON.stringify(content)), aad);
  return { contentEnc, msgKeyB64: bytesToB64(keyBytes) };
}

export async function processInner(inner, envelopeId) {
  if (!(await verifyInner(inner))) throw new Error("Signature interne invalide");
  await ensureContact({
    publicId: inner.from,
    identityPublicKey: inner.fromIdentityPublicKey,
    exchangePublicKey: inner.fromExchangePublicKey,
    displayName: inner.fromDisplayName,
    avatar: inner.fromAvatar || inner.avatar || null,
  });
  if (inner.fromAvatar || inner.avatar || inner.fromDisplayName) {
    await ingestPeerProfile(inner.from, {
      displayName: inner.fromDisplayName,
      avatar: inner.fromAvatar || inner.avatar || null,
    });
  }
  const who = labelFor(inner.from, inner.fromDisplayName);

  if (inner.kind === "profile-update") {
    await ingestPeerProfile(inner.from, {
      displayName: inner.displayName || inner.fromDisplayName,
      avatar: inner.avatar || inner.fromAvatar,
    });
    await persistVault();
    hooks.renderApp();
    return;
  }

  if (inner.kind === "invite") {
    const existing = state.conversations[inner.conversationId];
    let convKeyB64 = inner.convKeyB64;
    if (inner.cryptoVersion === 2 && inner.convType === "dm" && !convKeyB64) {
      convKeyB64 = bytesToB64(
        await derivePairwiseKeyBytes(state.exchange.privateKey, inner.fromExchangePublicKey, inner.conversationId)
      );
    } else if (existing?.convKeyB64 && !convKeyB64) {
      convKeyB64 = existing.convKeyB64;
    }
    if (inner.reset || !existing || existing.status !== "active") {
      if (inner.reset) state.messages[inner.conversationId] = [];
      state.conversations[inner.conversationId] = {
        id: inner.conversationId,
        type: inner.convType,
        title: inner.title,
        members: inner.members,
        convKeyB64,
        cryptoVersion: inner.cryptoVersion || existing?.cryptoVersion || 1,
        adminId: inner.adminId,
        status: "pending_in",
        createdAt: inner.sentAt,
        invitedBy: inner.from,
        avatar: existing?.avatar || null,
      };
      rememberMessage(inner.conversationId, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: inner.convType === "group"
          ? t("sysInviteGroup", { who, title: inner.title })
          : t("sysInvitePrivate", { who }),
      });
      if (inner.from !== state.publicId) {
        state.unread[inner.conversationId] = unreadCount(inner.conversationId) + 1;
        updateDocTitle();
      }
      state.activeId = inner.conversationId;
      hooks.openThreadView();
      await persistVault();
      await saveLocalMessages();
      hooks.renderApp();
      return;
    }
    await fanout([inner.from], {
      kind: "invite-response",
      conversationId: inner.conversationId,
      accepted: true,
    });
    rememberMessage(inner.conversationId, {
      id: envelopeId,
      kind: "system",
      from: inner.from,
      sentAt: inner.sentAt,
      text: t("sysInvitePrivate", { who }),
    });
    await persistVault();
    await saveLocalMessages();
    hooks.renderApp();
    return;
  }

  if (inner.kind === "conv-sync") {
    const convId = inner.conversationId;
    if (inner.action === "remove") {
      delete state.conversations[convId];
      delete state.messages[convId];
      delete state.unread[convId];
      if (state.activeId === convId) {
        state.activeId = null;
        hooks.closeThreadView();
      }
      await persistVault();
      await saveLocalMessages();
      hooks.renderApp();
      return;
    }
    const conv = state.conversations[convId];
    if (!conv) return;
    if (inner.action === "clear") {
      state.messages[convId] = [];
      syncConvPreview(convId);
      rememberMessage(convId, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysConvCleared", { who }),
      });
      await saveLocalMessages();
      hooks.renderApp();
      return;
    }
    if (inner.action === "clear-mine") {
      state.messages[convId] = (state.messages[convId] || []).filter(
        (msg) => msg.kind === "system" || msg.from !== inner.from
      );
      syncConvPreview(convId);
      rememberMessage(convId, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysPeerClearedMine", { who }),
      });
      await saveLocalMessages();
      hooks.renderApp();
      return;
    }
    return;
  }

  if (inner.kind === "invite-response") {
    const conv = state.conversations[inner.conversationId];
    if (!conv) return;
    if (inner.accepted) {
      if (!conv.members.includes(inner.from)) conv.members.push(inner.from);
      conv.status = "active";
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysAccepted", { who }),
      });
      state.activeId = conv.id;
      hooks.openThreadView();
    } else {
      conv.status = "declined";
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysDeclined", { who }),
      });
    }
    await persistVault();
    return;
  }

  if (inner.kind === "group-update") {
    const conv = state.conversations[inner.conversationId];
    if (!conv) return;
    if (inner.action === "leave") {
      conv.members = conv.members.filter((id) => id !== inner.from);
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysLeftGroup", { who }),
      });
    }
    if (inner.action === "rename" && inner.title) {
      conv.title = inner.title;
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysRenamed", { who, title: inner.title }),
      });
    }
    if (inner.action === "avatar" && inner.avatar) {
      conv.avatar = sanitizeAvatarMeta(inner.avatar);
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysAvatarChanged", { who }),
      });
    }
    if (inner.action === "rotate" && inner.convKeyB64) {
      conv.convKeyB64 = inner.convKeyB64;
      conv.members = inner.members;
      rememberMessage(conv.id, {
        id: envelopeId,
        kind: "system",
        from: inner.from,
        sentAt: inner.sentAt,
        text: t("sysKeyRotated"),
      });
    }
    await persistVault();
    return;
  }

  if (inner.kind === "message") {
    const conv = state.conversations[inner.conversationId];
    if (!inner.msgKeyB64 && !conv?.convKeyB64) {
      const err = new Error("enveloppe hors ordre");
      err.retry = true;
      throw err;
    }
    const content = await decryptMessageContent(conv, inner);
    rememberMessage(conv.id, {
      id: envelopeId,
      kind: "message",
      from: inner.from,
      fromDisplayName: labelFor(inner.from, inner.fromDisplayName),
      sentAt: inner.sentAt,
      text: content.text || "",
      file: content.file || null,
      gif: content.gif || null,
      mine: inner.from === state.publicId,
    });
  }
}

export async function processEnvelope(envelope) {
  if (state.seen.has(envelope.id)) return;
  try {
    const bytes = await openSeal(envelope.seal, state.exchange.privateKey);
    const inner = JSON.parse(td.decode(bytes));
    await processInner(inner, envelope.id);
    state.seen.add(envelope.id);
  } catch (err) {
    const retry =
      err.retry ||
      /révision|Coffre|synchron|obsolète|network|Failed to fetch/i.test(String(err.message || ""));
    if (!retry) state.seen.add(envelope.id);
    console.warn("Enveloppe illisible", err);
  }
}

export async function drainInbox() {
  if (state.draining) return false;
  state.draining = true;
  let changed = false;
  try {
    let since = (await idbGet("since")) || new Date(0).toISOString();
    while (true) {
      const { items } = await apiInbox(ctx(), since);
      if (!items.length) break;
      changed = true;
      let blocked = false;
      let advanced = since;
      for (const item of items) {
        await processEnvelope(item);
        if (!state.seen.has(item.id)) blocked = true;
        else if (!blocked) advanced = item.createdAt;
      }
      await idbSet("since", advanced);
      since = advanced;
      if (blocked || items.length < 200) break;
    }
    if (changed) await saveLocalMessages();
  } finally {
    state.draining = false;
  }
  return changed;
}
