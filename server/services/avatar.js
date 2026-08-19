const ALLOWED_EXT = new Set(["png", "jpg", "webp", "gif"]);
const ALLOWED_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function sanitizeAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return null;
  const fileId = String(avatar.fileId || "");
  const keyB64 = String(avatar.keyB64 || "");
  const ext = String(avatar.ext || "").toLowerCase();
  const mime = String(avatar.mime || "");
  if (!/^fil_[a-zA-Z0-9]+$/.test(fileId)) return null;
  if (!ALLOWED_EXT.has(ext) || ALLOWED_MIME[ext] !== mime) return null;
  if (keyB64.length < 16 || keyB64.length > 128) return null;
  return { fileId, keyB64, ext, mime };
}
