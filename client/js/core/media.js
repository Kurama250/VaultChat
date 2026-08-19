const ALLOWED = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const EXTRA_EXT = [
  "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico", "tif", "tiff",
  "exe", "js", "mjs", "html", "htm", "php", "sh", "bat", "cmd", "com", "dll",
  "scr", "zip", "rar", "7z", "tar", "gz", "pdf", "mp4", "mp3", "txt", "json",
  "css", "xml", "apk", "dmg", "iso", "bin",
];

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export function assertSingleImageName(filename) {
  const base = String(filename || "").replace(/^.*[/\\]/, "").trim();
  if (!base) throw new Error("Nom de fichier manquant");
  if (base.length > 80) throw new Error("Nom de fichier trop long");
  if (base.startsWith(".")) throw new Error("Fichier caché refusé");

  const parts = base.split(".");
  if (parts.length !== 2) {
    throw new Error("Une seule extension autorisée (ex. avatar.png), pas avatar.png.jpg");
  }

  const [stem, rawExt] = parts;
  if (!stem || /[^a-zA-Z0-9 _-]/u.test(stem)) {
    throw new Error("Nom de fichier invalide");
  }

  const ext = rawExt.toLowerCase();
  if (EXTRA_EXT.filter((e) => e === ext).length === 0 && !ALLOWED[ext]) {
    throw new Error("Extension image invalide (png, jpg, jpeg, webp, gif)");
  }
  if (!ALLOWED[ext]) {
    throw new Error("Extension image invalide (png, jpg, jpeg, webp, gif)");
  }
  return { name: `${stem}.${ext === "jpeg" ? "jpg" : ext}`, ext: ext === "jpeg" ? "jpg" : ext, mime: ALLOWED[ext] };
}

function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  const ascii = String.fromCharCode(...bytes.subarray(0, 6));
  if (ascii === "GIF87a" || ascii === "GIF89a") return "gif";
  return null;
}

export async function assertProfileImage(file) {
  if (!file) throw new Error("Aucune image sélectionnée");
  if (file.size <= 0) throw new Error("Fichier vide");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Image trop lourde (2 Mo max)");

  const parsed = assertSingleImageName(file.name);
  if (file.type && file.type !== parsed.mime) {
    throw new Error("Le type MIME ne correspond pas à l’extension");
  }

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new Error("Le contenu n’est pas une image valide");
  if (sniffed !== parsed.ext) {
    throw new Error("L’extension ne correspond pas au contenu du fichier");
  }
  return parsed;
}

export function sanitizeAvatarMeta(avatar) {
  if (!avatar || typeof avatar !== "object") return null;
  const fileId = String(avatar.fileId || "");
  const keyB64 = String(avatar.keyB64 || "");
  const ext = String(avatar.ext || "").toLowerCase();
  const mime = String(avatar.mime || "");
  if (!/^fil_[a-zA-Z0-9]+$/.test(fileId)) return null;
  if (!ALLOWED[ext] || ALLOWED[ext] !== mime) return null;
  if (keyB64.length < 16 || keyB64.length > 128) return null;
  return { fileId, keyB64, ext, mime };
}
