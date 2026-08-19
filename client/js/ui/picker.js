import { EMOJI_CATEGORIES } from "./emoji-data.js";
import { apiSearchGifs } from "../core/api.js";
import { listGifFavs, loadGifFavs, toggleGifFav } from "./gif-favs.js";
import { t } from "../core/i18n.js";

function insertAtCursor(input, text) {
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function gifTileHtml(item, favSet) {
  const fav = favSet.has(item.url);
  return `<div class="gif-tile">
    <button type="button" class="gif-btn" data-gif-url="${escapeAttr(item.url)}" data-gif-title="${escapeAttr(item.title || "GIF")}">
      <img src="/api/gifs/fetch?url=${encodeURIComponent(item.url)}" alt="" loading="lazy" />
    </button>
    <button type="button" class="gif-fav${fav ? " on" : ""}" data-fav-url="${escapeAttr(item.url)}" data-fav-title="${escapeAttr(item.title || "GIF")}" aria-pressed="${fav}" title="${fav ? t("gifFavRemove") : t("gifFavAdd")}">★</button>
  </div>`;
}

function emojiBodyHtml(categoryId = EMOJI_CATEGORIES[0].id) {
  const tabs = EMOJI_CATEGORIES.map(
    (cat) =>
      `<button type="button" class="picker-tab${cat.id === categoryId ? " active" : ""}" data-emoji-cat="${cat.id}">${cat.icon}</button>`
  ).join("");
  const cat = EMOJI_CATEGORIES.find((c) => c.id === categoryId) || EMOJI_CATEGORIES[0];
  const grid = cat.emojis.map((emoji) => `<button type="button" class="emoji-btn" data-emoji="${emoji}">${emoji}</button>`).join("");
  return `<div class="emoji-scroll"><div class="picker-tabs">${tabs}</div><div class="emoji-grid">${grid}</div></div>`;
}

export function mountPicker(root, handlers) {
  const state = {
    tab: "emoji",
    emojiCat: EMOJI_CATEGORIES[0].id,
    gifQuery: "",
    gifItems: [],
    gifLoading: false,
    gifScope: "all",
  };

  function favSet() {
    return new Set(listGifFavs().map((row) => row.url));
  }

  async function loadGifs() {
    state.gifLoading = true;
    paintGifGrid();
    try {
      const data = await apiSearchGifs(state.gifQuery, 1);
      state.gifItems = data.items || [];
    } catch {
      state.gifItems = [];
    } finally {
      state.gifLoading = false;
      paintGifGrid();
    }
  }

  function paintHead() {
    root.querySelectorAll("[data-picker-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pickerTab === state.tab);
    });
  }

  function visibleGifs() {
    if (state.gifScope === "favs") {
      const q = state.gifQuery.trim().toLowerCase();
      const favs = listGifFavs();
      if (!q) return favs;
      return favs.filter((item) => `${item.title || ""} ${item.url}`.toLowerCase().includes(q));
    }
    return state.gifItems;
  }

  function paintGifGrid() {
    const scroll = root.querySelector("#gif-scroll");
    if (!scroll) return;
    const items = visibleGifs();
    const stars = favSet();
    if (state.gifLoading && state.gifScope === "all") {
      scroll.innerHTML = `<p class="picker-empty">${t("gifLoading")}</p>`;
      return;
    }
    if (!items.length) {
      scroll.innerHTML = `<p class="picker-empty">${state.gifScope === "favs" ? t("gifFavEmpty") : t("gifEmpty")}</p>`;
      return;
    }
    const heading = state.gifScope === "favs" ? t("gifFavs") : t("gifResults");
    scroll.innerHTML = `<p class="gif-section">${heading}</p><div class="gif-grid">${items.map((item) => gifTileHtml(item, stars)).join("")}</div>`;
    bindGifTiles(scroll);
  }

  function bindGifTiles(scope) {
    scope.querySelectorAll(".gif-btn img").forEach((img) => {
      img.addEventListener("error", () => img.closest(".gif-tile")?.remove());
    });
    scope.querySelectorAll("[data-gif-url]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void handlers.onGifPick({
          url: btn.dataset.gifUrl,
          title: btn.dataset.gifTitle || "GIF",
        });
      });
    });
    scope.querySelectorAll("[data-fav-url]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void onToggleFav({ url: btn.dataset.favUrl, title: btn.dataset.favTitle || "GIF" });
      });
    });
  }

  async function onToggleFav(item) {
    await toggleGifFav(item);
    paintGifGrid();
    paintGifToolbar();
  }

  function paintGifToolbar() {
    root.querySelectorAll("[data-gif-scope]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.gifScope === state.gifScope);
    });
  }

  function runGifSearch() {
    const input = root.querySelector("#gif-search-input");
    state.gifQuery = input?.value?.trim() || "";
    if (state.gifScope === "favs") {
      paintGifGrid();
      return;
    }
    void loadGifs();
  }

  function bindGifChrome() {
    const input = root.querySelector("#gif-search-input");
    root.querySelector("#gif-search-btn")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      runGifSearch();
    });
    input?.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      ev.stopPropagation();
      runGifSearch();
    });
    root.querySelectorAll("[data-gif-scope]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.gifScope = btn.dataset.gifScope;
        paintGifToolbar();
        paintGifGrid();
      });
    });
  }

  function bindEmojiBody(body) {
    body.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () => insertAtCursor(handlers.input, btn.dataset.emoji));
    });
    body.querySelectorAll("[data-emoji-cat]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.emojiCat = btn.dataset.emojiCat;
        bindBody();
      });
    });
  }

  function bindBody() {
    const body = root.querySelector("#picker-body");
    if (!body) return;
    if (state.tab === "emoji") {
      body.innerHTML = emojiBodyHtml(state.emojiCat);
      bindEmojiBody(body);
      return;
    }
    body.innerHTML = `
      <div class="gif-search">
        <input id="gif-search-input" type="text" placeholder="${t("gifSearchPh")}" value="${escapeAttr(state.gifQuery)}" autocomplete="off" />
        <button type="button" id="gif-search-btn" class="btn brass tiny">${t("gifSearch")}</button>
      </div>
      <div class="gif-toolbar">
        <button type="button" class="picker-chip" data-gif-scope="favs">★ ${t("gifFavs")}</button>
        <button type="button" class="picker-chip" data-gif-scope="all">${t("gifTab")}</button>
      </div>
      <div class="gif-scroll" id="gif-scroll"></div>
    `;
    bindGifChrome();
    paintGifToolbar();
    paintGifGrid();
    queueMicrotask(() => root.querySelector("#gif-search-input")?.focus());
  }

  root.innerHTML = `
    <div class="picker-head">
      <button type="button" class="picker-mode active" data-picker-tab="emoji">${t("emojiTab")}</button>
      <button type="button" class="picker-mode" data-picker-tab="gif">${t("gifTab")}</button>
      <button type="button" class="picker-close" data-picker-close>×</button>
    </div>
    <div class="picker-body" id="picker-body"></div>
  `;

  root.addEventListener("click", (ev) => ev.stopPropagation());
  root.addEventListener("pointerdown", (ev) => ev.stopPropagation());

  root.querySelectorAll("[data-picker-tab]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      state.tab = btn.dataset.pickerTab;
      paintHead();
      bindBody();
      if (state.tab === "gif" && !state.gifItems.length && !state.gifLoading) void loadGifs();
    });
  });
  root.querySelector("[data-picker-close]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handlers.onClose();
  });

  void loadGifFavs().then(() => {
    if (state.tab === "gif") paintGifGrid();
  });

  bindBody();
}

export function openPicker(root, handlers) {
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  mountPicker(root, handlers);
}

export function closePicker(root) {
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = "";
}
