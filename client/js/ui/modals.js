import { t } from "../core/i18n.js";
import { DEFAULT_AVATAR, draft, hooks, state, ui } from "../core/state.js";
import { convAvatarUrl, convTitle, escapeHtml, labelFor } from "../core/util.js";
import {
  createGroup,
  inviteUser,
  removeConversation,
  renameGroup,
  setDisplayName,
  setGroupImage,
  setProfileImage,
} from "../chat/conversations.js";
import { clearConversationMessages, clearLocal, clearMyMessages, purgeAll } from "../chat/messages.js";
import { bindLangButtons, langSwitchHtml } from "./lang.js";
import { showAlert, showConfirm } from "./dialog.js";

export function closeModal() {
  ui.modal.classList.add("hidden");
  ui.modalCard.innerHTML = "";
}

function fieldValue(id) {
  const el = ui.modalCard.querySelector(`#${id}`);
  return el ? String(el.value ?? "").trim() : "";
}

function showModalError(id, message) {
  const node = ui.modalCard.querySelector(`#${id}`);
  if (node) node.textContent = message || "";
}

function readFormField(form, name, draftKey) {
  const el = form?.elements?.[name];
  const live = el ? String(el.value ?? "") : "";
  const fallback = draftKey ? String(draft[draftKey] || "") : "";
  return (live || fallback).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

export function settingsModalHtml() {
  const pic = `<img id="settings-avatar" alt="" src="${escapeHtml(state.avatarUrl || DEFAULT_AVATAR)}" />`;
  return `
    <h2>${t("profile")}</h2>
    ${langSwitchHtml("settings-lang")}
    <div class="avatar-row">
      <div class="avatar avatar-lg">${pic}</div>
      <label class="btn ghost tiny" style="width:auto">
        ${t("photo")}
        <input id="avatar-input" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" hidden />
      </label>
    </div>
    <form id="settings-name-form">
      <div class="field-row">
        <input id="display-name-input" name="displayName" type="text" maxlength="24" value="${escapeHtml(state.displayName || "")}" placeholder="${t("displayNamePh")}" autocomplete="nickname" />
        <button type="submit" class="btn brass" id="save-display-name">OK</button>
      </div>
      <p id="pseudo-error" class="form-error"></p>
    </form>
    <p class="id-line">ID · ${escapeHtml(state.publicId)}</p>
    <div class="account-actions">
      <button type="button" class="btn ghost" id="do-logout">${t("logout")}</button>
      <button type="button" class="btn ghost" id="do-clear">${t("clearLocal")}</button>
      <button type="button" class="btn danger" id="do-purge">${t("purgeAccount")}</button>
    </div>
  `;
}

export function groupModalHtml(conv) {
  const pic = convAvatarUrl(conv);
  return `
    <h2>${t("groupSettings")}</h2>
    <div class="avatar-row">
      <div class="avatar avatar-lg"><img alt="" src="${escapeHtml(pic)}" /></div>
      <label class="btn ghost tiny" style="width:auto">
        ${t("photo")}
        <input id="group-avatar-input" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" hidden />
      </label>
    </div>
    <div class="field-row">
      <input id="group-rename-input" type="text" maxlength="40" value="${escapeHtml(conv.title || "")}" placeholder="${t("groupRenamePh")}" />
      <button type="button" class="btn brass" id="save-group-name">OK</button>
    </div>
    <form id="group-invite-form" class="field-row">
      <input id="group-invite-id" name="id" type="text" inputmode="text" placeholder="${t("groupInvitePh")}" aria-label="${t("groupInviteLabel")}" />
      <button type="submit" class="btn brass" id="do-group-invite">+</button>
    </form>
    <p id="group-invite-error" class="form-error"></p>
    <p class="id-line">${escapeHtml((conv.members || []).map((id) => labelFor(id)).join(" · "))}</p>
    <div class="account-actions">
      <button type="button" class="btn ghost" id="leave-conv">${t("leaveGroup")}</button>
      <button type="button" class="btn danger" id="delete-conv">${t("delete")}</button>
    </div>
  `;
}

export function convOptionsModalHtml(conv) {
  const isGroup = conv.type === "group";
  return `
    <h2>${t("conversation")}</h2>
    <p class="id-line">${escapeHtml(convTitle(conv))}</p>
    <div class="conv-actions">
      ${isGroup ? `<button type="button" class="btn ghost" id="open-group-edit">${t("editGroup")}</button>` : ""}
      <button type="button" class="btn ghost" id="clear-all-msgs">${t("clearAll")}</button>
      <button type="button" class="btn ghost" id="clear-my-msgs">${t("clearMine")}</button>
      ${isGroup ? `<button type="button" class="btn ghost" id="leave-conv">${t("leaveGroup")}</button>` : ""}
      <button type="button" class="btn danger" id="delete-conv">${t("deleteConv")}</button>
    </div>
  `;
}

export function inviteModalHtml() {
  return `
    <form id="invite-form">
      <h2>${t("inviteTitle")}</h2>
      <label class="field-label" for="find-id">${t("inviteIdLabel")}</label>
      <input id="find-id" name="id" type="text" inputmode="text" placeholder="${t("inviteIdPh")}" />
      <p id="invite-error" class="form-error"></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>${t("cancel")}</button>
        <button type="submit" class="btn brass" id="do-find">${t("inviteSubmit")}</button>
      </div>
    </form>
  `;
}

export function groupCreateModalHtml() {
  return `
    <form id="group-create-form">
      <h2>${t("groupNewTitle")}</h2>
      <label class="field-label" for="group-title">${t("groupNameLabel")}</label>
      <input id="group-title" name="title" type="text" inputmode="text" maxlength="40" placeholder="${t("groupNamePh")}" />
      <p id="group-error" class="form-error"></p>
      <div class="actions">
        <button type="button" class="btn ghost" data-close>${t("cancel")}</button>
        <button type="submit" class="btn brass" id="do-group">${t("create")}</button>
      </div>
    </form>
  `;
}

async function submitCreateGroupFromForm(form) {
  const title = readFormField(form, "title", "groupTitle");
  const btn = form.querySelector("#do-group");
  if (btn) btn.disabled = true;
  try {
    const convId = await createGroup(title);
    state.activeId = convId;
    closeModal();
    hooks.openThreadView();
    hooks.renderApp();
  } catch (err) {
    showModalError("group-error", err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitInviteFromForm(form) {
  const id = readFormField(form, "id", "inviteId");
  const btn = form.querySelector("#do-find");
  if (btn) btn.disabled = true;
  try {
    const convId = await inviteUser(id);
    state.activeId = convId;
    closeModal();
    hooks.openThreadView();
    hooks.renderApp();
  } catch (err) {
    showModalError("invite-error", err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitGroupInviteFromForm(form) {
  const id = readFormField(form, "id", "groupInviteId");
  try {
    await inviteUser(id, state.activeId);
    draft.groupInviteId = "";
    const conv = state.conversations[state.activeId];
    if (conv) openModal(groupModalHtml(conv));
  } catch (err) {
    showModalError("group-invite-error", err.message);
  }
}

async function submitDisplayNameFromForm(form) {
  const raw = readFormField(form, "displayName", "displayName")
    || String(form.querySelector("#display-name-input")?.value || "").trim();
  const btn = form.querySelector("#save-display-name");
  if (btn) btn.disabled = true;
  try {
    await setDisplayName(raw);
    openModal(settingsModalHtml());
  } catch (err) {
    showModalError("pseudo-error", err.message === "DISPLAY_NAME" ? t("errPseudo") : err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function bindModalForms() {
  const groupForm = ui.modalCard.querySelector("#group-create-form");
  if (groupForm) {
    const input = groupForm.elements.title;
    draft.groupTitle = input?.value || "";
    input?.addEventListener("input", () => {
      draft.groupTitle = input.value;
      showModalError("group-error", "");
    });
    groupForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void submitCreateGroupFromForm(groupForm);
    });
    queueMicrotask(() => input?.focus());
  }

  const inviteForm = ui.modalCard.querySelector("#invite-form");
  if (inviteForm) {
    const input = inviteForm.elements.id;
    draft.inviteId = input?.value || "";
    input?.addEventListener("input", () => {
      draft.inviteId = input.value;
      showModalError("invite-error", "");
    });
    inviteForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void submitInviteFromForm(inviteForm);
    });
    queueMicrotask(() => input?.focus());
  }

  const groupInviteForm = ui.modalCard.querySelector("#group-invite-form");
  if (groupInviteForm) {
    const input = groupInviteForm.elements.id;
    draft.groupInviteId = input?.value || "";
    input?.addEventListener("input", () => {
      draft.groupInviteId = input.value;
      showModalError("group-invite-error", "");
    });
    groupInviteForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void submitGroupInviteFromForm(groupInviteForm);
    });
  }

  const nameForm = ui.modalCard.querySelector("#settings-name-form");
  if (nameForm) {
    const input = nameForm.querySelector("#display-name-input");
    draft.displayName = input?.value || state.displayName || "";
    const capture = () => {
      draft.displayName = String(input?.value || draft.displayName || "");
      showModalError("pseudo-error", "");
    };
    input?.addEventListener("input", capture);
    input?.addEventListener("change", capture);
    input?.addEventListener("blur", capture);
    nameForm.querySelector("#save-display-name")?.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      capture();
    });
    nameForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      capture();
      void submitDisplayNameFromForm(nameForm);
    });
    queueMicrotask(() => input?.focus());
  }
}

export function openModal(html) {
  ui.modalCard.innerHTML = html;
  ui.modal.classList.remove("hidden");
  ui.modalCard.querySelectorAll("input, textarea").forEach((el) => {
    el.setAttribute("spellcheck", "false");
    el.setAttribute("autocomplete", "off");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
  });
  bindModalForms();
  bindLangButtons(ui.modalCard);
}

function reopenTranslatedModal() {
  const modalOpen = !ui.modal.classList.contains("hidden");
  const wasSettings = modalOpen && ui.modalCard.querySelector("#settings-lang");
  const wasConvOpts = modalOpen && ui.modalCard.querySelector("#clear-all-msgs");
  const wasGroup = modalOpen && ui.modalCard.querySelector("#group-rename-input");
  if (wasSettings) openModal(settingsModalHtml());
  else if (wasConvOpts && state.conversations[state.activeId]) {
    openModal(convOptionsModalHtml(state.conversations[state.activeId]));
  } else if (wasGroup && state.conversations[state.activeId]) {
    openModal(groupModalHtml(state.conversations[state.activeId]));
  }
}

let modalPointerFrom = null;

export function bindModalEvents() {
  ui.modal.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      if (ev.target.id === "avatar-input") {
        await setProfileImage(file);
        openModal(settingsModalHtml());
      }
      if (ev.target.id === "group-avatar-input") {
        await setGroupImage(file);
        const conv = state.conversations[state.activeId];
        if (conv) openModal(groupModalHtml(conv));
      }
    } catch (err) {
      await showAlert(err.message);
    }
  });

  ui.modal.addEventListener("pointerdown", (ev) => {
    modalPointerFrom = ev.target;
  });

  ui.modal.addEventListener("click", async (ev) => {
    const startedInCard = modalPointerFrom && ui.modalCard.contains(modalPointerFrom);
    modalPointerFrom = null;
    const el = ev.target.nodeType === 1 ? ev.target : ev.target.parentElement;
    if (!el) return;
    if (el.closest("[data-close]") || (el === ui.modal && !startedInCard)) {
      closeModal();
      return;
    }
    const btn = el.closest("button");
    const id = btn?.id;
    if (!id || btn?.type === "submit" || id === "do-group" || id === "do-find" || id === "do-group-invite") return;
    try {
      if (id === "save-group-name") {
        await renameGroup(fieldValue("group-rename-input"));
        const conv = state.conversations[state.activeId];
        if (conv) openModal(groupModalHtml(conv));
        return;
      }
      if (id === "leave-conv") {
        if (await showConfirm(t("confirmLeaveGroup"), { danger: true })) {
          closeModal();
          await removeConversation(true);
        }
        return;
      }
      if (id === "clear-all-msgs") {
        if (await showConfirm(t("confirmClearAll"), { danger: true })) {
          closeModal();
          await clearConversationMessages();
        }
        return;
      }
      if (id === "clear-my-msgs") {
        if (await showConfirm(t("confirmClearMine"), { danger: true })) {
          closeModal();
          await clearMyMessages();
        }
        return;
      }
      if (id === "open-group-edit") {
        const conv = state.conversations[state.activeId];
        if (conv) openModal(groupModalHtml(conv));
        return;
      }
      if (id === "delete-conv") {
        const conv = state.conversations[state.activeId];
        const label = conv?.type === "group" ? t("confirmDeleteGroup") : t("confirmDeleteConv");
        if (await showConfirm(label, { danger: true })) {
          closeModal();
          await removeConversation(false);
        }
        return;
      }
      if (id === "save-display-name") return;
      if (id === "do-logout") {
        sessionStorage.removeItem("shard-key");
        state.socket?.close();
        location.reload();
      }
      if (id === "do-clear") await clearLocal();
      if (id === "do-purge") {
        if (await showConfirm(t("confirmPurge"), { danger: true })) await purgeAll();
      }
    } catch (err) {
      await showAlert(err.message);
    }
  });
}

hooks.openModal = openModal;
hooks.closeModal = closeModal;
hooks.reopenTranslatedModal = reopenTranslatedModal;
