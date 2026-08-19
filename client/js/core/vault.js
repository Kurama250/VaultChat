import { buildPublicVault } from "./crypto.js";
import { idbGet, idbSet } from "./idb.js";
import { apiPutVault } from "./api.js";
import { t } from "./i18n.js";
import { ctx, hooks, siteConfig, state } from "./state.js";
import { convTitle } from "./util.js";

export async function persistVault() {
  const privateVault = {
    version: 1,
    publicId: state.publicId,
    identityJwk: state.identityJwk,
    exchangeJwk: state.exchangeJwk,
    contacts: state.contacts,
    conversations: Object.fromEntries(
      Object.entries(state.conversations).map(([id, conv]) => {
        const { lastText, ...rest } = conv;
        return [id, rest];
      })
    ),
    avatar: state.avatar,
    displayName: state.displayName,
  };
  const nextRevision = (state.revision | 0) + 1;
  const vault = await buildPublicVault({
    publicId: state.publicId,
    identityJwk: state.identityJwk,
    exchangeJwk: state.exchangeJwk,
    wrapKey: state.wrapKey,
    privateVault,
    revision: nextRevision,
  });
  await apiPutVault(ctx(), state.locator, vault);
  state.revision = nextRevision;
}

export async function loadLocalMessages() {
  const stored = (await idbGet("messages")) || {};
  const seen = (await idbGet("seen")) || [];
  const unread = (await idbGet("unread")) || {};
  state.messages = stored;
  state.seen = new Set(seen);
  state.unread = unread && typeof unread === "object" ? unread : {};
  for (const [id, list] of Object.entries(stored)) {
    const last = list[list.length - 1];
    if (state.conversations[id] && last) {
      state.conversations[id].lastText = last.gif?.title || last.text || last.file?.name || "";
      state.conversations[id].lastAt = last.sentAt;
    }
  }
}

export async function saveLocalMessages() {
  await idbSet("messages", state.messages);
  await idbSet("seen", [...state.seen]);
  await idbSet("unread", state.unread);
}

export function unreadCount(convId) {
  return Math.max(0, state.unread[convId] | 0);
}

export function totalUnread() {
  return Object.values(state.unread).reduce((sum, n) => sum + Math.max(0, n | 0), 0);
}

export function updateDocTitle() {
  const n = totalUnread();
  const name = siteConfig.name;
  document.title = n ? `(${n}) ${name}` : name;
}

export function markRead(convId) {
  if (!convId || !state.unread[convId]) {
    updateDocTitle();
    return;
  }
  state.unread[convId] = 0;
  updateDocTitle();
  void saveLocalMessages();
}

export function requestNotifyPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") void Notification.requestPermission();
}

export function notifyIncoming(conversationId, message) {
  if (!message || message.mine || message.from === state.publicId) return;
  if (message.kind !== "message") return;
  const viewing = conversationId === state.activeId && !document.hidden;
  if (!viewing) {
    state.unread[conversationId] = unreadCount(conversationId) + 1;
    updateDocTitle();
  }
  if (!("Notification" in window) || Notification.permission !== "granted" || viewing) return;
  const conv = state.conversations[conversationId];
  const title = conv ? convTitle(conv) : t("newMessage");
  const body = message.text || message.gif?.title || message.file?.name || t("newMessage");
  try {
    const note = new Notification(title, { body, icon: "/img/kurama.png", tag: conversationId });
    note.onclick = () => {
      window.focus();
      state.activeId = conversationId;
      markRead(conversationId);
      hooks.renderApp();
      note.close();
    };
  } catch {
  }
}

export function rememberMessage(conversationId, message) {
  if (!state.messages[conversationId]) state.messages[conversationId] = [];
  state.messages[conversationId].push(message);
  if (state.conversations[conversationId]) {
    state.conversations[conversationId].lastText = message.gif?.title || message.text || message.file?.name || message.kind;
    state.conversations[conversationId].lastAt = message.sentAt || new Date().toISOString();
  }
  notifyIncoming(conversationId, message);
}

export function syncConvPreview(convId) {
  const conv = state.conversations[convId];
  if (!conv) return;
  const list = state.messages[convId] || [];
  const last = list[list.length - 1];
  conv.lastText = last ? last.gif?.title || last.text || last.file?.name || (last.kind === "system" ? last.text : "") : "";
  conv.lastAt = last?.sentAt || conv.createdAt;
}
