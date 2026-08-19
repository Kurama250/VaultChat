import { sanitizeDisplayName } from "./profile.js";
import { t } from "./i18n.js";
import { DEFAULT_AVATAR, state, ui } from "./state.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function showError(node, err) {
  node.hidden = false;
  node.textContent = err.message || String(err);
}

export function showScreen(name) {
  document.documentElement.classList.remove("session-resume");
  const splash = document.getElementById("boot-splash");
  if (splash) {
    splash.hidden = true;
    splash.setAttribute("aria-hidden", "true");
  }
  ui.gate.classList.toggle("hidden", name !== "gate");
  ui.reveal.classList.toggle("hidden", name !== "reveal");
  ui.app.classList.toggle("hidden", name !== "app");
  document.getElementById("gate-lang")?.classList.toggle("hidden", name !== "gate");
}

export function normalizePublicId(raw) {
  const text = String(raw || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!text) return "";
  const exact = text.match(/shd_[a-f0-9]{20}/i);
  if (exact) return exact[0].toLowerCase();
  if (/shd_/i.test(text) && /…|\.{2,}|…/.test(text)) {
    throw new Error(t("errIdIncomplete"));
  }
  return text;
}

export function otherMembers(conv) {
  return (conv.members || []).filter((id) => id !== state.publicId);
}

export function shortId(publicId) {
  if (!publicId) return "?";
  return publicId.length > 14 ? `${publicId.slice(0, 14)}…` : publicId;
}

export function looksLikeId(value) {
  return typeof value === "string" && /^shd_/i.test(value);
}

export function labelFor(publicId, fallbackName) {
  if (!publicId) return sanitizeDisplayName(fallbackName) || "?";
  const cleanFallback = looksLikeId(fallbackName) ? null : sanitizeDisplayName(fallbackName);
  if (publicId === state.publicId) return state.displayName || cleanFallback || t("me");
  return cleanFallback || state.contacts[publicId]?.displayName || shortId(publicId);
}

export function convTitle(conv) {
  if (conv.type === "group") return conv.title || t("group");
  const other = otherMembers(conv)[0];
  return labelFor(other) || conv.title || t("discussion");
}

export function senderName(msg) {
  return labelFor(msg.from, msg.fromDisplayName);
}

export function convAvatarUrl(conv) {
  if (!conv) return DEFAULT_AVATAR;
  if (conv.type === "group") {
    const fileId = conv.avatar?.fileId;
    return (fileId && state.avatarCache[fileId]) || DEFAULT_AVATAR;
  }
  const other = otherMembers(conv)[0];
  const fileId = state.contacts[other]?.avatar?.fileId;
  return (fileId && state.avatarCache[fileId]) || DEFAULT_AVATAR;
}

export function personAvatarUrl(publicId) {
  if (publicId === state.publicId) return state.avatarUrl || DEFAULT_AVATAR;
  const fileId = state.contacts[publicId]?.avatar?.fileId;
  return (fileId && state.avatarCache[fileId]) || DEFAULT_AVATAR;
}

export function statusLabel(status) {
  if (status === "pending_out") return t("inviteSent");
  if (status === "pending_in") return t("inviteReceived");
  if (status === "declined") return t("declined");
  return t("active");
}

export function convTimestamp(conv) {
  const raw = conv?.lastAt || conv?.createdAt || 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function formatConvTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t("yesterday");
  return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

export function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

export function formatStoredKey(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase().match(/.{1,8}/g).join("-");
}
