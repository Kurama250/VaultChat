import { decryptFile, encryptFile } from "../core/crypto.js";
import { apiGetFile, apiPutFile, apiPurge } from "../core/api.js";
import { wipeLocalDb } from "../core/idb.js";
import { t } from "../core/i18n.js";
import { ctx, hooks, state } from "../core/state.js";
import { otherMembers } from "../core/util.js";
import { rememberMessage, saveLocalMessages, syncConvPreview } from "../core/vault.js";
import { encryptContentForRecipient, fanout } from "./protocol.js";

export async function sendMessage(text, fileMeta, gifMeta) {
  const conv = state.conversations[state.activeId];
  if (!conv || conv.status !== "active") return;
  const content = { text, file: fileMeta || null, gif: gifMeta || null };
  const others = conv.members.filter((id) => id !== state.publicId);
  let sentAt = new Date().toISOString();
  for (const memberId of others) {
    const packed = await encryptContentForRecipient(content, conv.id);
    const signed = await fanout([memberId], {
      kind: "message",
      conversationId: conv.id,
      cryptoVersion: 2,
      contentEnc: packed.contentEnc,
      msgKeyB64: packed.msgKeyB64,
    });
    sentAt = signed.sentAt;
  }
  rememberMessage(conv.id, {
    id: crypto.randomUUID(),
    kind: "message",
    from: state.publicId,
    fromDisplayName: state.displayName || t("me"),
    sentAt,
    text,
    file: fileMeta || null,
    gif: gifMeta || null,
    mine: true,
  });
  await saveLocalMessages();
  hooks.renderApp();
}

export async function sendEncryptedFile(file, caption = "") {
  if (file.size > 20 * 1024 * 1024) throw new Error(t("fileTooBig"));
  const enc = await encryptFile(file);
  const fileId = `fil_${crypto.randomUUID().replaceAll("-", "")}`;
  await apiPutFile(ctx(), fileId, enc.cipherBytes);
  await sendMessage(caption || file.name, {
    id: fileId,
    name: enc.name,
    mime: enc.mime,
    size: enc.size,
    keyB64: enc.keyB64,
  });
}

export async function sendGifFromUrl(gif) {
  const url = String(gif?.url || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error(t("gifSendFail"));
  await sendMessage("", null, { url, title: gif.title || "GIF" });
}

export async function downloadFile(btn) {
  const cipher = await apiGetFile(ctx(), btn.dataset.file);
  const plain = await decryptFile(cipher, btn.dataset.key);
  const blob = new Blob([plain], { type: btn.dataset.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = btn.dataset.name || "fichier";
  a.click();
  URL.revokeObjectURL(url);
}

export async function clearConversationMessages() {
  const conv = state.conversations[state.activeId];
  if (!conv) return;
  state.messages[conv.id] = [];
  syncConvPreview(conv.id);
  try {
    await fanout(otherMembers(conv), {
      kind: "conv-sync",
      conversationId: conv.id,
      action: "clear",
    });
  } catch (err) {
    console.warn("Clear non synchronisé", err);
  }
  rememberMessage(conv.id, {
    id: crypto.randomUUID(),
    kind: "system",
    from: state.publicId,
    sentAt: new Date().toISOString(),
    text: t("sysConvCleared", { who: t("me") }),
  });
  await saveLocalMessages();
  hooks.renderApp();
}

export async function clearMyMessages() {
  const conv = state.conversations[state.activeId];
  if (!conv) return;
  state.messages[conv.id] = (state.messages[conv.id] || []).filter(
    (msg) => msg.kind === "system" || msg.from !== state.publicId
  );
  syncConvPreview(conv.id);
  try {
    await fanout(otherMembers(conv), {
      kind: "conv-sync",
      conversationId: conv.id,
      action: "clear-mine",
    });
  } catch (err) {
    console.warn("Clear mine non synchronisé", err);
  }
  await saveLocalMessages();
  hooks.renderApp();
}

export async function deleteMessage(messageId) {
  const conv = state.conversations[state.activeId];
  if (!conv || !messageId) return;
  state.messages[conv.id] = (state.messages[conv.id] || []).filter((msg) => msg.id !== messageId);
  syncConvPreview(conv.id);
  await saveLocalMessages();
  hooks.renderApp();
}

export async function clearLocal() {
  state.socket?.close();
  if (state.poller) clearInterval(state.poller);
  await wipeLocalDb();
  location.reload();
}

export async function purgeAll() {
  await apiPurge(ctx(), state.locator);
  await clearLocal();
}
