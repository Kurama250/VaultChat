import { decryptFile } from "../core/crypto.js";
import { apiGetFile } from "../core/api.js";
import { t } from "../core/i18n.js";
import { isGifFav } from "./gif-favs.js";
import { DEFAULT_AVATAR, ctx, hooks, state, ui } from "../core/state.js";
import {
  convAvatarUrl,
  convTimestamp,
  convTitle,
  escapeHtml,
  formatConvTime,
  isMobileLayout,
  otherMembers,
  personAvatarUrl,
  senderName,
  statusLabel,
} from "../core/util.js";
import { markRead, unreadCount, updateDocTitle } from "../core/vault.js";
import { avatarUrlFromMeta, lookupAndStore, paintLiveAvatars, paintOwnAvatar } from "../chat/contacts.js";

const MESSAGE_RENDER_LIMIT = 120;
let renderQueued = false;
let prefetchBusy = false;

export function ensureActiveConversation() {
  const convs = Object.values(state.conversations)
    .filter((conv) => conv.status !== "declined")
    .sort((a, b) => convTimestamp(b) - convTimestamp(a));
  if (!convs.length) {
    state.activeId = null;
    return;
  }
  const current = state.conversations[state.activeId];
  if (!current || current.status === "declined") state.activeId = convs[0].id;
}

export function openThreadView() {
  if (!isMobileLayout()) return;
  if (!ui.app.classList.contains("show-thread")) history.pushState({ kuramaThread: true }, "");
  ui.app.classList.add("show-thread");
}

export function closeThreadView() {
  ui.app.classList.remove("show-thread");
}

function paintListAvatars() {
  paintLiveAvatars();
}

function renderList() {
  const convs = Object.values(state.conversations)
    .filter((conv) => conv.status !== "declined")
    .sort((a, b) => convTimestamp(b) - convTimestamp(a));
  ui.convList.innerHTML = convs
    .map((conv) => {
      const pic = `<img class="conv-avatar" alt="" loading="lazy" decoding="async" data-conv="${escapeHtml(conv.id)}" src="${escapeHtml(convAvatarUrl(conv))}" onerror="this.onerror=null;this.src='/img/kurama.png'" />`;
      const kindClass = conv.type === "group" ? "conv-group" : "conv-dm";
      const kindLabel = conv.type === "group" ? t("groupTag") : t("dmTag");
      const unread = unreadCount(conv.id);
      const when = formatConvTime(conv.lastAt || conv.createdAt);
      return `
      <li data-id="${conv.id}" class="${kindClass}${conv.id === state.activeId ? " active" : ""}${unread ? " unread" : ""}">
        ${pic}
        <div class="conv-body">
          <div class="conv-row">
            <span class="name">${escapeHtml(convTitle(conv))}</span>
            <span class="conv-time">${escapeHtml(when)}</span>
          </div>
          <div class="conv-row">
            <span class="preview">${escapeHtml(conv.lastText || statusLabel(conv.status))}</span>
            <span class="conv-kind">${kindLabel}</span>
            ${unread ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : ""}
          </div>
          ${conv.status !== "active" ? `<span class="badge">${statusLabel(conv.status)}</span>` : ""}
        </div>
      </li>`;
    })
    .join("");
  updateDocTitle();
}

async function hydrateMessageGifs() {
  const nodes = ui.messages.querySelectorAll(".msg-gif[data-file]");
  for (const img of nodes) {
    const fileId = img.dataset.file;
    if (!fileId || state.mediaCache[fileId]) {
      if (state.mediaCache[fileId]) img.src = state.mediaCache[fileId];
      continue;
    }
    try {
      const cipher = await apiGetFile(ctx(), fileId);
      const plain = await decryptFile(cipher, img.dataset.key);
      const url = URL.createObjectURL(new Blob([plain], { type: img.dataset.mime || "image/gif" }));
      state.mediaCache[fileId] = url;
      img.src = url;
    } catch {
      img.alt = "GIF";
    }
  }
}

function renderThread() {
  ensureActiveConversation();
  const conv = state.conversations[state.activeId];
  if (!conv) {
    ui.threadTitle.textContent = t("noConversation");
    ui.threadSub.textContent = t("inviteHint");
    ui.inviteBar.classList.add("hidden");
    ui.composer.classList.add("hidden");
    ui.threadMore?.classList.add("hidden");
    ui.threadMenu?.classList.add("hidden");
    if (ui.threadAvatar) ui.threadAvatar.src = DEFAULT_AVATAR;
    ui.messages.innerHTML = "";
    return;
  }
  ui.threadTitle.textContent = convTitle(conv);
  const typeLabel = conv.type === "group" ? t("group").toLowerCase() : t("private");
  ui.threadSub.textContent = `${conv.members.length} · ${typeLabel}`;
  markRead(conv.id);
  if (ui.threadAvatar) {
    ui.threadAvatar.dataset.conv = conv.id;
    ui.threadAvatar.src = convAvatarUrl(conv);
  }
  ui.composer.classList.toggle("hidden", conv.status !== "active");
  ui.threadMore?.classList.toggle("hidden", conv.type !== "group" || conv.status !== "active");
  ui.threadMenu?.classList.toggle("hidden", conv.status !== "active");

  if (conv.status === "pending_in") {
    ui.inviteBar.classList.remove("hidden");
    ui.inviteBar.innerHTML = `
      <span>${t("joinQuestion")}</span>
      <button type="button" class="btn brass tiny" id="accept-invite" style="width:auto">${t("yes")}</button>
      <button type="button" class="btn ghost tiny" id="decline-invite" style="width:auto">${t("no")}</button>
    `;
  } else if (conv.status === "pending_out") {
    ui.inviteBar.classList.remove("hidden");
    ui.inviteBar.innerHTML = `<span>${t("waiting")}</span>
      <button type="button" class="btn danger tiny" id="delete-conv" style="width:auto">${t("cancelInvite")}</button>`;
  } else {
    ui.inviteBar.classList.add("hidden");
    ui.inviteBar.innerHTML = "";
  }

  const full = (state.messages[conv.id] || []).filter((msg) => conv.status === "active" || msg.kind === "system");
  const list = full.length > MESSAGE_RENDER_LIMIT ? full.slice(-MESSAGE_RENDER_LIMIT) : full;
  ui.messages.innerHTML = list
    .map((msg) => {
      if (msg.kind === "system") {
        return `<div class="bubble system">
          <span>${escapeHtml(msg.text)}</span>
          <button type="button" class="msg-delete" data-msg="${escapeHtml(msg.id)}" title="${t("deleteMsg")}">×</button>
        </div>`;
      }
      const hasText = Boolean(msg.text);
      const gifUrl = msg.gif?.url || "";
      const favOn = gifUrl && isGifFav(gifUrl);
      const gif = gifUrl
        ? `<div class="msg-gif-wrap">
            <img class="msg-gif" loading="lazy" decoding="async" src="/api/gifs/fetch?url=${encodeURIComponent(gifUrl)}" alt="${escapeHtml(msg.gif.title || "GIF")}" />
          </div>`
        : "";
      const file = !gif && msg.file
        ? (String(msg.file.mime || "").includes("gif")
            ? `<div class="msg-gif-wrap"><img class="msg-gif" loading="lazy" decoding="async" data-file="${escapeHtml(msg.file.id)}" data-key="${escapeHtml(msg.file.keyB64)}" data-mime="${escapeHtml(msg.file.mime)}" alt="${escapeHtml(msg.file.name || "GIF")}" /></div>`
            : `<button type="button" class="file-link" data-file="${escapeHtml(msg.file.id)}" data-name="${escapeHtml(msg.file.name)}" data-key="${escapeHtml(msg.file.keyB64)}" data-mime="${escapeHtml(msg.file.mime)}">${escapeHtml(msg.file.name)}</button>`)
        : "";
      const favBtn = gifUrl
        ? `<button type="button" class="meta-fav${favOn ? " on" : ""}" data-fav-url="${escapeHtml(gifUrl)}" data-fav-title="${escapeHtml(msg.gif.title || "GIF")}" aria-pressed="${favOn}" title="${favOn ? t("gifFavRemove") : t("gifFavAdd")}">★</button>`
        : "";
      return `<div class="msg ${msg.mine ? "mine" : ""}">
        <img class="msg-avatar" alt="" loading="lazy" decoding="async" data-user="${escapeHtml(msg.from)}" src="${escapeHtml(personAvatarUrl(msg.from))}" onerror="this.onerror=null;this.src='/img/kurama.png'" />
        <div class="bubble ${msg.mine ? "mine" : ""}${gif && !hasText ? " gif-only" : ""}">
          <button type="button" class="msg-delete" data-msg="${escapeHtml(msg.id)}" title="${t("deleteMsg")}">×</button>
          <div class="meta" title="${escapeHtml(msg.from)}">
            <span class="meta-who">${escapeHtml(senderName(msg))} · ${escapeHtml(new Date(msg.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
            ${favBtn}
          </div>
          ${hasText ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ""}
          ${gif}${file}
        </div>
      </div>`;
    })
    .join("");
  ui.messages.scrollTop = ui.messages.scrollHeight;
  void hydrateMessageGifs();
}

async function prefetchAvatars() {
  if (prefetchBusy) return;
  prefetchBusy = true;
  try {
    if (state.avatar) {
      const url = await avatarUrlFromMeta(state.avatar);
      if (url) {
        state.avatarUrl = url;
        paintOwnAvatar();
      }
    }
    const jobs = [];
    for (const conv of Object.values(state.conversations)) {
      if (conv.status === "declined") continue;
      if (conv.type === "group" && conv.avatar?.fileId && !state.avatarCache[conv.avatar.fileId]) {
        jobs.push(avatarUrlFromMeta(conv.avatar));
        continue;
      }
      if (conv.type !== "dm") continue;
      const other = otherMembers(conv)[0];
      if (!other) continue;
      jobs.push((async () => {
        const contact = state.contacts[other];
        if (!contact?.avatar) {
          try { await lookupAndStore(other); } catch { return; }
        }
        await avatarUrlFromMeta(state.contacts[other]?.avatar);
      })());
    }
    if (jobs.length) await Promise.all(jobs);
    paintLiveAvatars();
  } finally {
    prefetchBusy = false;
  }
}

function renderAppNow() {
  ensureActiveConversation();
  ui.copyId.textContent = state.publicId;
  const pseudoBtn = document.getElementById("my-display-name");
  if (pseudoBtn) pseudoBtn.textContent = state.displayName || t("setPseudo");
  paintOwnAvatar();
  renderList();
  renderThread();
  void prefetchAvatars();
}

export function renderApp() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAppNow();
  });
}

hooks.renderApp = renderApp;
hooks.openThreadView = openThreadView;
hooks.closeThreadView = closeThreadView;
