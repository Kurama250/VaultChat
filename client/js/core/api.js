import { sha256Hex, signObject, stableStringify } from "./crypto.js";

async function signedHeaders(ctx, method, path, body) {
  const ts = Date.now();
  const payload = { method, path, ts, body };
  const sig = await signObject(ctx.identity.privateKey, payload);
  return {
    "X-Shard-Ts": String(ts),
    "X-Shard-Sig": sig,
    "X-Shard-Id": ctx.publicId,
  };
}

async function parseError(res) {
  try {
    const data = await res.json();
    throw new Error(data.error || `HTTP ${res.status}`);
  } catch (err) {
    if (err instanceof Error && err.message !== `HTTP ${res.status}`) throw err;
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function apiRegister(publicId, locator, vault) {
  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicId, locator, vault }),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiGetVault(locator) {
  const res = await fetch(`/api/vault/${locator}`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiPutVault(ctx, locator, vault) {
  const path = `/api/vault/${locator}`;
  const body = { publicId: ctx.publicId, vault };
  const headers = await signedHeaders(ctx, "PUT", path, body);
  const res = await fetch(path, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiLookupUser(publicId) {
  const res = await fetch(`/api/users/${encodeURIComponent(publicId)}`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiSendEnvelope(ctx, recipientId, seal) {
  const path = "/api/envelopes";
  const body = { senderId: ctx.publicId, recipientId, seal };
  const headers = await signedHeaders(ctx, "POST", path, body);
  const res = await fetch(path, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiInbox(ctx, since) {
  const path = `/api/inbox/${ctx.publicId}`;
  const body = { since };
  const headers = await signedHeaders(ctx, "POST", path, body);
  const res = await fetch(path, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiPutFile(ctx, fileId, cipherBytes) {
  const path = `/api/files/${fileId}`;
  const sha256 = await sha256Hex(cipherBytes);
  const headers = await signedHeaders(ctx, "PUT", path, { sha256 });
  const res = await fetch(path, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: cipherBytes,
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiGetFile(ctx, fileId) {
  const path = `/api/files/${fileId}`;
  const headers = await signedHeaders(ctx, "GET", path, null);
  const res = await fetch(path, { headers });
  if (!res.ok) await parseError(res);
  return new Uint8Array(await res.arrayBuffer());
}

export async function apiPurge(ctx, locator) {
  const path = "/api/purge";
  const body = { publicId: ctx.publicId, locator };
  const headers = await signedHeaders(ctx, "POST", path, body);
  const res = await fetch(path, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiSearchGifs(query, page = 1) {
  const params = new URLSearchParams({
    q: String(query || ""),
    page: String(page || 1),
  });
  const res = await fetch(`/api/gifs/search?${params}`);
  if (!res.ok) await parseError(res);
  return res.json();
}

export async function apiFetchGifBytes(url) {
  const params = new URLSearchParams({ url: String(url || "") });
  const res = await fetch(`/api/gifs/fetch?${params}`);
  if (!res.ok) await parseError(res);
  return new Uint8Array(await res.arrayBuffer());
}

export function connectInboxSocket(ctx, onEnvelope) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  let timer = null;

  async function bind() {
    const ts = Date.now();
    const body = { publicId: ctx.publicId };
    const sig = await signObject(ctx.identity.privateKey, {
      method: "WS",
      path: "/ws/bind",
      ts,
      body,
    });
    ws.send(JSON.stringify({ type: "bind", publicId: ctx.publicId, ts, sig }));
  }

  ws.addEventListener("open", () => {
    bind();
    timer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) bind();
    }, 60_000);
  });
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "envelope") onEnvelope(msg);
    } catch {
    }
  });
  ws.addEventListener("close", () => {
    if (timer) clearInterval(timer);
  });
  return ws;
}

export { stableStringify };
