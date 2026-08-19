import { applyStatic, getLang, t } from "./core/i18n.js";
import { closePicker, openPicker } from "./ui/picker.js";
import { isGifFav, toggleGifFav } from "./ui/gif-favs.js";
import { state, ui, siteConfig, loadSiteConfig } from "./core/state.js";
import { showError, showScreen } from "./core/util.js";
import { markRead, requestNotifyPermission } from "./core/vault.js";
import { createIdentity, loginWithKey } from "./chat/session.js";
import { removeConversation, respondInvite } from "./chat/conversations.js";
import { lookupAndStore, refreshActivePeerProfiles } from "./chat/contacts.js";
import { otherMembers } from "./core/util.js";
import {
  deleteMessage,
  downloadFile,
  sendEncryptedFile,
  sendGifFromUrl,
  sendMessage,
} from "./chat/messages.js";
import { closeThreadView, openThreadView, renderApp } from "./ui/render.js";
import {
  bindModalEvents,
  convOptionsModalHtml,
  groupCreateModalHtml,
  groupModalHtml,
  inviteModalHtml,
  openModal,
  settingsModalHtml,
} from "./ui/modals.js";
import { bindLangButtons, tickRole, updateLangButtons } from "./ui/lang.js";
import { showAlert, showConfirm } from "./ui/dialog.js";

bindModalEvents();

const LOGIN_USER = "chat.kurama.info";

async function offerStoreLoginKey(password) {
  const key = String(password || "").trim();
  if (!key) return;
  try {
    if (window.PasswordCredential && navigator.credentials?.store) {
      const cred = new PasswordCredential({
        id: LOGIN_USER,
        name: LOGIN_USER,
        password: key,
      });
      await navigator.credentials.store(cred);
    }
  } catch {
  }
}

document.getElementById("create-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  ui.gateError.hidden = true;
  const btn = ev.target.querySelector("button[type='submit']");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("creatingKey");
  }
  try {
    await createIdentity();
  } catch (err) {
    showError(ui.gateError, err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("createVault");
    }
  }
});

document.getElementById("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  ui.gateError.hidden = true;
  const key = document.getElementById("login-key").value;
  try {
    await loginWithKey(key);
    void offerStoreLoginKey(key);
  } catch (err) {
    showError(ui.gateError, err);
  }
});

document.getElementById("copy-key").addEventListener("click", async () => {
  await navigator.clipboard.writeText(ui.revealKey.textContent.trim());
});

document.getElementById("store-key-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const key = document.getElementById("store-key-input")?.value || ui.revealKey.textContent.trim();
  await offerStoreLoginKey(key);
  showScreen("app");
  requestNotifyPermission();
  renderApp();
  void refreshActivePeerProfiles();
});

ui.copyId.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.publicId);
});

ui.convList.addEventListener("click", (ev) => {
  const item = ev.target.closest("li[data-id]");
  if (!item) return;
  state.activeId = item.dataset.id;
  markRead(item.dataset.id);
  requestNotifyPermission();
  openThreadView();
  renderApp();
  const conv = state.conversations[item.dataset.id];
  if (conv) {
    for (const id of otherMembers(conv)) {
      void lookupAndStore(id, { force: true })
        .then(() => renderApp())
        .catch(() => {});
    }
  }
});

ui.threadBack?.addEventListener("click", () => {
  if (history.state?.kuramaThread) history.back();
  else closeThreadView();
});

window.addEventListener("popstate", () => {
  closeThreadView();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.activeId) markRead(state.activeId);
});

ui.inviteBar.addEventListener("click", async (ev) => {
  try {
    if (ev.target.id === "accept-invite") await respondInvite(true);
    if (ev.target.id === "decline-invite") await respondInvite(false);
    if (ev.target.id === "delete-conv") {
      if (await showConfirm(t("confirmDeleteConvVault"), { danger: true })) {
        await removeConversation(false);
      }
    }
    if (ev.target.id === "leave-conv") {
      if (await showConfirm(t("confirmLeaveGroup"), { danger: true })) {
        await removeConversation(true);
      }
    }
  } catch (err) {
    await showAlert(err.message);
  }
});

ui.messages.addEventListener("click", async (ev) => {
  const favBtn = ev.target.closest("[data-fav-url]");
  if (favBtn) {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await toggleGifFav({ url: favBtn.dataset.favUrl, title: favBtn.dataset.favTitle || "GIF" });
      const on = isGifFav(favBtn.dataset.favUrl);
      favBtn.classList.toggle("on", on);
      favBtn.setAttribute("aria-pressed", String(on));
      favBtn.title = on ? t("gifFavRemove") : t("gifFavAdd");
    } catch (err) {
      await showAlert(err.message);
    }
    return;
  }
  const delBtn = ev.target.closest("[data-msg]");
  if (delBtn) {
    const msgId = delBtn.dataset.msg;
    if (await showConfirm(t("confirmDeleteMsg"), { danger: true })) {
      try {
        await deleteMessage(msgId);
      } catch (err) {
        await showAlert(err.message);
      }
    }
    return;
  }
  const btn = ev.target.closest("[data-file]");
  if (!btn) return;
  try {
    await downloadFile(btn);
  } catch (err) {
    await showAlert(err.message);
  }
});

ui.composer.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (document.activeElement?.id === "gif-search-input") return;
  const text = ui.msgInput.value.trim();
  if (!text) return;
  ui.msgInput.value = "";
  try {
    await sendMessage(text, null);
  } catch (err) {
    await showAlert(err.message);
  }
});

ui.fileInput.addEventListener("change", async () => {
  const file = ui.fileInput.files[0];
  ui.fileInput.value = "";
  if (!file) return;
  try {
    await sendEncryptedFile(file, file.name);
  } catch (err) {
    await showAlert(err.message);
  }
});

document.getElementById("open-picker")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (!state.activeId || state.conversations[state.activeId]?.status !== "active") return;
  const panel = ui.mediaPicker;
  if (!panel.classList.contains("hidden")) {
    closePicker(panel);
    return;
  }
  openPicker(panel, {
    input: ui.msgInput,
    onClose: () => closePicker(panel),
    onGifPick: async (gif) => {
      await sendGifFromUrl(gif);
      closePicker(panel);
    },
  });
});

document.addEventListener("pointerdown", (ev) => {
  if (!ui.mediaPicker || ui.mediaPicker.classList.contains("hidden")) return;
  const target = ev.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#open-picker") || target.closest("#media-picker")) return;
  closePicker(ui.mediaPicker);
});

document.getElementById("open-find").addEventListener("click", () => {
  openModal(inviteModalHtml());
});

document.getElementById("open-group").addEventListener("click", () => {
  openModal(groupCreateModalHtml());
});

document.getElementById("my-display-name")?.addEventListener("click", () => {
  openModal(settingsModalHtml());
});

document.getElementById("open-settings").addEventListener("click", () => {
  openModal(settingsModalHtml());
});

document.getElementById("me-avatar-btn")?.addEventListener("click", () => {
  openModal(settingsModalHtml());
});

document.getElementById("thread-more")?.addEventListener("click", () => {
  const conv = state.conversations[state.activeId];
  if (!conv || conv.type !== "group") return;
  openModal(groupModalHtml(conv));
});

document.getElementById("thread-menu")?.addEventListener("click", () => {
  const conv = state.conversations[state.activeId];
  if (!conv || conv.status !== "active") return;
  openModal(convOptionsModalHtml(conv));
});

function applyBranding() {
  const name = siteConfig.name;
  const logo = siteConfig.logo;
  document.title = name;
  document.querySelectorAll(".logo-text").forEach((el) => {
    el.textContent = name.split(".")[0];
  });
  document.querySelectorAll(".logo-dot").forEach((el) => {
    const parts = name.split(".");
    el.textContent = parts.length > 1 ? `.${parts.slice(1).join(".")}` : "";
  });
  document.querySelectorAll(".hero-title .name").forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll("#boot-splash span").forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll(".rail-logo span").forEach((el) => {
    const parts = name.split(".");
    el.innerHTML = `${parts[0]}<span class="accent">.${parts.slice(1).join(".")}</span>`;
  });
  document.querySelectorAll(".nav-kurama, .rail-logo img, #boot-splash img").forEach((img) => {
    img.src = logo;
  });
  const credit = document.getElementById("site-credits");
  if (credit) {
    credit.href = siteConfig.credits.github;
    credit.textContent = `by ${siteConfig.credits.author}`;
  }
}

async function boot() {
  await loadSiteConfig();
  applyBranding();
  const saved = sessionStorage.getItem("shard-key");
  if (!saved) {
    document.documentElement.classList.remove("session-resume");
    return;
  }
  try {
    await loginWithKey(saved);
  } catch {
    sessionStorage.removeItem("shard-key");
    document.documentElement.classList.remove("session-resume");
    showScreen("gate");
  }
}

document.documentElement.lang = getLang();
applyStatic(document);
bindLangButtons(document);
updateLangButtons();

boot();
tickRole();
