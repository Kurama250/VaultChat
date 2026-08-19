import { WebSocketServer } from "ws";
import { readPublicUser } from "../data/store.js";
import { canonicalBytes, verifyIdentitySignature } from "../core/verify.js";

const MAX_WS_PAYLOAD = 8 * 1024;
const BIND_COOLDOWN_MS = 5_000;

export function attachWebSocket(server, sockets) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_WS_PAYLOAD });
  wss.on("connection", (ws) => {
    let boundId = null;
    let lastBind = 0;
    ws.on("message", async (raw) => {
      try {
        if (String(raw).length > MAX_WS_PAYLOAD) {
          ws.close();
          return;
        }
        const msg = JSON.parse(String(raw));
        if (msg.type !== "bind") return;
        const now = Date.now();
        if (now - lastBind < BIND_COOLDOWN_MS) return;
        lastBind = now;
        const { publicId, ts, sig } = msg;
        if (!publicId || !ts || !sig) return;
        if (!/^shd_[a-f0-9]{20}$/i.test(publicId)) return;
        if (Math.abs(Date.now() - ts) > 2 * 60 * 1000) return;
        const user = await readPublicUser(publicId);
        if (!user) return;
        const payload = canonicalBytes({ method: "WS", path: "/ws/bind", ts, body: { publicId } });
        if (!verifyIdentitySignature(user.identityPublicKey, payload, sig)) return;
        if (boundId && boundId !== publicId) {
          const prev = sockets.get(boundId);
          if (prev) {
            prev.delete(ws);
            if (prev.size === 0) sockets.delete(boundId);
          }
        }
        boundId = publicId;
        if (!sockets.has(boundId)) sockets.set(boundId, new Set());
        sockets.get(boundId).add(ws);
        ws.send(JSON.stringify({ type: "bound", publicId }));
      } catch {
      }
    });
    ws.on("close", () => {
      if (!boundId) return;
      const set = sockets.get(boundId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) sockets.delete(boundId);
    });
  });
  return wss;
}
