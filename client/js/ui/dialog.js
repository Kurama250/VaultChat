import { t } from "../core/i18n.js";
import { escapeHtml } from "../core/util.js";

let active = null;

function ensureDialog() {
  let root = document.getElementById("app-dialog");
  if (root) return root;
  root = document.createElement("div");
  root.id = "app-dialog";
  root.className = "modal hidden";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <div class="modal-card dialog-card" id="app-dialog-card">
      <p class="dialog-text" id="app-dialog-text"></p>
      <div class="actions" id="app-dialog-actions"></div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function closeDialog(result) {
  const root = document.getElementById("app-dialog");
  if (root) root.classList.add("hidden");
  const resolve = active?.resolve;
  active = null;
  resolve?.(result);
}

export function showDialog({ message, buttons }) {
  if (active) closeDialog(null);
  const root = ensureDialog();
  const text = root.querySelector("#app-dialog-text");
  const actions = root.querySelector("#app-dialog-actions");
  text.textContent = String(message || "");
  actions.innerHTML = (buttons || [])
    .map((btn) => {
      const cls = btn.danger ? "btn danger" : btn.primary ? "btn brass" : "btn ghost";
      return `<button type="button" class="${cls}" data-dialog="${escapeHtml(btn.id)}">${escapeHtml(btn.label)}</button>`;
    })
    .join("");
  root.classList.remove("hidden");

  return new Promise((resolve) => {
    active = { resolve };
    const onClick = (ev) => {
      const btn = ev.target.closest("[data-dialog]");
      if (!btn) {
        if (ev.target === root) {
          root.removeEventListener("click", onClick);
          closeDialog(null);
        }
        return;
      }
      root.removeEventListener("click", onClick);
      closeDialog(btn.dataset.dialog);
    };
    root.addEventListener("click", onClick);
    queueMicrotask(() => {
      const primary = actions.querySelector(".btn.brass, .btn.danger") || actions.querySelector("button");
      primary?.focus();
    });
  });
}

export function showAlert(message) {
  return showDialog({
    message,
    buttons: [{ id: "ok", label: t("ok"), primary: true }],
  }).then(() => undefined);
}

export function showConfirm(message, { danger = false } = {}) {
  return showDialog({
    message,
    buttons: [
      { id: "cancel", label: t("cancel") },
      { id: "ok", label: t("confirmAction"), primary: true, danger },
    ],
  }).then((id) => id === "ok");
}
