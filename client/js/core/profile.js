const DISPLAY_NAME_RE = /^[a-zA-Z0-9À-ÖØ-öø-ÿ .'_-]{2,24}$/;

export function sanitizeDisplayName(value) {
  if (value == null || value === "") return null;
  const trimmed = String(value)
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 24) return null;
  if (!DISPLAY_NAME_RE.test(trimmed)) return null;
  return trimmed;
}

export function assertDisplayName(value) {
  const name = sanitizeDisplayName(value);
  if (!name) throw new Error("DISPLAY_NAME");
  return name;
}
