import { idbGet, idbSet } from "../core/idb.js";

const FAV_KEY = "gif-favs";
let cache = [];
let loaded = false;

export async function loadGifFavs() {
  const rows = (await idbGet(FAV_KEY)) || [];
  cache = Array.isArray(rows) ? rows.filter((row) => row?.url) : [];
  loaded = true;
  return cache;
}

export function listGifFavs() {
  return cache;
}

export function isGifFav(url) {
  return cache.some((row) => row.url === String(url || ""));
}

export async function toggleGifFav(item) {
  if (!loaded) await loadGifFavs();
  const url = String(item?.url || "").trim();
  if (!url) return cache;
  const exists = cache.some((row) => row.url === url);
  cache = exists
    ? cache.filter((row) => row.url !== url)
    : [{ url, title: item.title || "GIF" }, ...cache].slice(0, 80);
  await idbSet(FAV_KEY, cache);
  return cache;
}
