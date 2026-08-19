import { applyStatic, getLang, roleWords, setLang, t } from "../core/i18n.js";
import { hooks, ui } from "../core/state.js";

const roleNode = document.getElementById("role-text");
let roleIndex = 0;
let roleChar = 0;
let roleDeleting = false;

export function langSwitchHtml(id = "modal-lang") {
  const current = getLang();
  return `
    <div class="lang-switch" id="${id}">
      <span class="field-label">${t("language")}</span>
      <button type="button" class="lang-btn${current === "fr" ? " active" : ""}" data-lang="fr">FR</button>
      <button type="button" class="lang-btn${current === "en" ? " active" : ""}" data-lang="en">EN</button>
    </div>
  `;
}

export function bindLangButtons(root = document) {
  root.querySelectorAll(".lang-btn[data-lang]").forEach((btn) => {
    if (btn.dataset.langBound) return;
    btn.dataset.langBound = "1";
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang);
      refreshUiLang();
    });
  });
}

export function updateLangButtons() {
  document.querySelectorAll(".lang-btn[data-lang]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === getLang());
  });
}

function resetRole() {
  roleIndex = 0;
  roleChar = 0;
  roleDeleting = false;
}

export function refreshUiLang() {
  document.documentElement.lang = getLang();
  applyStatic(document);
  updateLangButtons();
  resetRole();
  hooks.renderApp();
  hooks.reopenTranslatedModal();
}

export function tickRole() {
  if (!roleNode || ui.gate.classList.contains("hidden")) return;
  const words = roleWords();
  const word = words[roleIndex % words.length];
  roleNode.textContent = word.slice(0, roleChar);
  if (!roleDeleting && roleChar < word.length) {
    roleChar += 1;
    setTimeout(tickRole, 70);
    return;
  }
  if (!roleDeleting && roleChar === word.length) {
    roleDeleting = true;
    setTimeout(tickRole, 1400);
    return;
  }
  if (roleDeleting && roleChar > 0) {
    roleChar -= 1;
    setTimeout(tickRole, 38);
    return;
  }
  roleDeleting = false;
  roleIndex = (roleIndex + 1) % roleWords().length;
  setTimeout(tickRole, 220);
}
