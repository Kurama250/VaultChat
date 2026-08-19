const buckets = new Map();

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function prune(bucket, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (bucket.length && bucket[0] < cutoff) bucket.shift();
}

export function rateLimit({ windowMs, max, keyFn } = {}) {
  const win = windowMs || 60_000;
  const limit = max || 60;
  return (req, res, next) => {
    const id = `${req.method}:${req.path}:${(keyFn || clientKey)(req)}`;
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = [];
      buckets.set(id, bucket);
    }
    prune(bucket, win);
    if (bucket.length >= limit) {
      res.status(429).json({ error: "Trop de requêtes" });
      return;
    }
    bucket.push(Date.now());
    next();
  };
}

export function assertFileId(fileId) {
  if (!/^fil_[a-zA-Z0-9]{8,64}$/.test(String(fileId || ""))) {
    const err = new Error("Identifiant fichier invalide");
    err.status = 400;
    throw err;
  }
}

export function assertPublicId(publicId) {
  if (!/^shd_[a-f0-9]{20}$/i.test(String(publicId || ""))) {
    const err = new Error("Identifiant public invalide");
    err.status = 400;
    throw err;
  }
}

export function assertLocator(locator) {
  if (!/^[a-f0-9]{32,128}$/i.test(String(locator || ""))) {
    const err = new Error("Localisateur invalide");
    err.status = 400;
    throw err;
  }
}
