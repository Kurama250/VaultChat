const ALLOWED_HOSTS = new Set([
  "cdn.gifukai.com",
  "live.staticflickr.com",
  "upload.wikimedia.org",
  "images.unsplash.com",
  "cdn.openverse.org",
  "i.imgur.com",
  "media.giphy.com",
  "media.tenor.com",
  "c.tenor.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
]);

const DEFAULT_ACTIONS = ["hug", "dance", "laugh", "wave", "cry", "kiss", "happy", "sleep", "think", "clap", "bye", "angry"];
const PAIRINGS = ["ff", "fm", "mf", "mm"];

const EXTRA_ALIASES = {
  angry: ["colere", "colère", "fache", "fâché", "rage"],
  bite: ["morsure", "mord"],
  blush: ["rouge", "timide"],
  bye: ["ciao", "a+", "à plus"],
  clap: ["applaudir", "bravo"],
  cry: ["pleure", "pleurer", "triste", "sob"],
  cuddle: ["calin", "câlin", "câlins", "snuggle"],
  dance: ["danse", "danser", "fun"],
  eat: ["manger", "miam"],
  happy: ["heureux", "heureuse", "joie", "content", "fun"],
  hi: ["coucou", "bonjour", "hello", "salut"],
  hug: ["calin", "câlin", "câlins", "embrace"],
  kiss: ["bisou", "bisous", "embrasse", "embrasser"],
  laugh: ["rire", "marrant", "drole", "drôle", "lol", "mdr", "ptdr", "fun"],
  nod: ["oui", "ok", "daccord", "d'accord"],
  nope: ["non", "nan"],
  nya: ["chat", "chaton", "neko", "cat"],
  pat: ["patpat", "caresse"],
  sleep: ["dodo", "dormir", "sieste"],
  smile: ["sourire"],
  sorry: ["desole", "désolé", "pardon"],
  think: ["reflexion", "réflexion"],
  thumbsup: ["like", "ok", "super"],
  wave: ["salut", "coucou", "hello"],
  wink: ["clin"],
  yay: ["youpi", "yes", "fun"],
  teehee: ["fun", "mdr", "hehe"],
  yawn: ["baille", "bâille"],
  tired: ["fatigue", "fatigué"],
};

let actionsCache = null;
let actionsCacheAt = 0;

function normalizeGif(item) {
  const url = item?.url || "";
  const lower = url.toLowerCase();
  if (!/\.gif(?:$|\?)/i.test(lower) && !lower.includes("gifukai")) return null;
  return {
    id: String(item.id || url),
    url,
    preview: item.preview || url,
    title: item.title || "GIF",
    width: item.width || null,
    height: item.height || null,
  };
}

async function loadGifukaiActions() {
  if (actionsCache && Date.now() - actionsCacheAt < 60 * 60 * 1000) return actionsCache;
  const res = await fetch("https://api.gifukai.com/v1/actions", {
    headers: { Accept: "application/json", "User-Agent": "chat.kurama.info/1.0" },
  });
  if (!res.ok) throw new Error("Catalogue GIF indisponible");
  const data = await res.json();
  const entries = [];
  for (const [action, meta] of Object.entries(data.actions || {})) {
    const terms = new Set([
      action,
      ...(meta.aliases || []).map((row) => String(row.alias || "").toLowerCase()),
      ...(EXTRA_ALIASES[action] || []),
    ]);
    entries.push({ action, terms: [...terms].filter(Boolean) });
  }
  actionsCache = entries.length ? entries : DEFAULT_ACTIONS.map((action) => ({
    action,
    terms: [action, ...(EXTRA_ALIASES[action] || [])],
  }));
  actionsCacheAt = Date.now();
  return actionsCache;
}

async function fetchGifukaiAction(action, pairing) {
  const url = new URL(`https://api.gifukai.com/v1/${encodeURIComponent(action)}`);
  if (pairing) url.searchParams.set("pairing", pairing);
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "chat.kurama.info/1.0" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.url) return null;
  return normalizeGif({
    id: data.filename || data.url,
    url: data.url,
    preview: data.url,
    title: `${data.action || action}${data.anime ? ` · ${data.anime}` : ""}`,
  });
}

function matchActions(actions, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    const preferred = DEFAULT_ACTIONS.map((name) => actions.find((row) => row.action === name)).filter(Boolean);
    return (preferred.length ? preferred : actions).slice(0, 10);
  }
  const scored = [];
  for (const row of actions) {
    if (row.action === q || row.terms.includes(q)) {
      scored.push({ row, score: 4 });
      continue;
    }
    if (q.length >= 2 && row.terms.some((term) => term.length >= 3 && (term.includes(q) || q.includes(term)))) {
      scored.push({ row, score: 2 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.row).slice(0, 10);
}

async function searchOpenverse(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q: `${q} gif`,
    format: "json",
    page: "1",
    page_size: "12",
    license_type: "all",
  });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || [])
    .map((item) =>
      normalizeGif({
        id: item.id,
        url: item.url,
        preview: item.thumbnail && !String(item.thumbnail).includes("/thumb/?") ? item.thumbnail : item.url,
        title: item.title,
      })
    )
    .filter(Boolean);
}

export async function searchGifs(query, page = 1) {
  if (page > 1) return { items: [], page, pageCount: page };
  const actions = await loadGifukaiActions();
  const picked = matchActions(actions, query);
  const items = [];
  const seen = new Set();
  const jobs = [];
  for (const row of picked) {
    for (const pairing of PAIRINGS) jobs.push(fetchGifukaiAction(row.action, pairing));
  }
  const results = await Promise.all(jobs);
  for (const gif of results) {
    if (!gif || seen.has(gif.url)) continue;
    seen.add(gif.url);
    items.push(gif);
  }
  if (items.length < 8) {
    for (const gif of await searchOpenverse(query)) {
      if (seen.has(gif.url)) continue;
      seen.add(gif.url);
      items.push(gif);
      if (items.length >= 40) break;
    }
  }
  return { items: items.slice(0, 40), page: 1, pageCount: 1 };
}

export function assertGifUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || ""));
  } catch {
    const err = new Error("URL GIF invalide");
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== "https:") {
    const err = new Error("URL GIF invalide");
    err.status = 400;
    throw err;
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    const err = new Error("Source GIF non autorisée");
    err.status = 403;
    throw err;
  }
  return parsed.toString();
}

export async function fetchGifBytes(url) {
  const safe = assertGifUrl(url);
  const res = await fetch(safe, {
    headers: { Accept: "image/gif,image/png,image/jpeg,image/webp", "User-Agent": "chat.kurama.info/1.0" },
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) {
      const err = new Error("GIF introuvable");
      err.status = 404;
      throw err;
    }
    const next = assertGifUrl(new URL(loc, safe).toString());
    const again = await fetch(next, {
      headers: { Accept: "image/gif,image/png,image/jpeg,image/webp", "User-Agent": "chat.kurama.info/1.0" },
      redirect: "error",
    });
    if (!again.ok) {
      const err = new Error("GIF introuvable");
      err.status = 404;
      throw err;
    }
    const type = (again.headers.get("content-type") || "image/gif").split(";")[0];
    const buffer = Buffer.from(await again.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
      const err = new Error("GIF trop volumineux");
      err.status = 413;
      throw err;
    }
    return { buffer, mime: type || "image/gif" };
  }
  if (!res.ok) {
    const err = new Error("GIF introuvable");
    err.status = 404;
    throw err;
  }
  const type = (res.headers.get("content-type") || "image/gif").split(";")[0];
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    const err = new Error("GIF trop volumineux");
    err.status = 413;
    throw err;
  }
  return { buffer, mime: type || "image/gif" };
}
