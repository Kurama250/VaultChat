export let DEFAULT_AVATAR = "/img/kurama.png";
export const te = new TextEncoder();
export const td = new TextDecoder();

export const siteConfig = {
  name: "Chat.kurama.info",
  logo: "/img/kurama.png",
  url: "https://chat.kurama.info",
  credits: { author: "Kurama", github: "https://github.com/Kurama250/" },
};

export async function loadSiteConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) Object.assign(siteConfig, await res.json());
    DEFAULT_AVATAR = siteConfig.logo;
  } catch {
  }
}

export const draft = { groupTitle: "", inviteId: "", groupInviteId: "", displayName: "" };

export const ui = {
  gate: document.getElementById("gate"),
  reveal: document.getElementById("reveal"),
  app: document.getElementById("app"),
  gateError: document.getElementById("gate-error"),
  revealKey: document.getElementById("reveal-key"),
  revealId: document.getElementById("reveal-id"),
  copyId: document.getElementById("copy-id"),
  convList: document.getElementById("conv-list"),
  threadTitle: document.getElementById("thread-title"),
  threadSub: document.getElementById("thread-sub"),
  threadAvatar: document.getElementById("thread-avatar"),
  threadMore: document.getElementById("thread-more"),
  threadMenu: document.getElementById("thread-menu"),
  threadBack: document.getElementById("thread-back"),
  inviteBar: document.getElementById("invite-bar"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  msgInput: document.getElementById("msg-input"),
  fileInput: document.getElementById("file-input"),
  mediaPicker: document.getElementById("media-picker"),
  modal: document.getElementById("modal"),
  modalCard: document.getElementById("modal-card"),
};

export const state = {
  loginBytes: null,
  wrapKey: null,
  locator: null,
  publicId: null,
  identity: null,
  exchange: null,
  identityJwk: null,
  exchangeJwk: null,
  revision: 1,
  contacts: {},
  conversations: {},
  messages: {},
  seen: new Set(),
  activeId: null,
  socket: null,
  poller: null,
  draining: false,
  busy: false,
  lastGroupAt: 0,
  avatar: null,
  avatarUrl: null,
  avatarCache: {},
  mediaCache: {},
  unread: {},
  displayName: null,
};

export const hooks = {
  renderApp() {},
  openModal() {},
  closeModal() {},
  openThreadView() {},
  closeThreadView() {},
  reopenTranslatedModal() {},
};

export function ctx() {
  return { publicId: state.publicId, identity: state.identity };
}
