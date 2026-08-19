import {
  buildPublicVault,
  decryptJson,
  emptyPrivateVault,
  exportPrivateJwk,
  generateIdentity,
  generateLoginKey,
  importExchange,
  importIdentity,
  locatorFromLogin,
  parseLoginKey,
  publicIdFromIdentityJwk,
  publicJwk,
  wrapKeyFromLogin,
} from "../core/crypto.js";
import { apiGetVault, apiRegister, connectInboxSocket } from "../core/api.js";
import { loadGifFavs } from "../ui/gif-favs.js";
import { sanitizeAvatarMeta } from "../core/media.js";
import { sanitizeDisplayName } from "../core/profile.js";
import { t } from "../core/i18n.js";
import { ctx, hooks, state, ui } from "../core/state.js";
import { formatStoredKey, showScreen } from "../core/util.js";
import { loadLocalMessages, requestNotifyPermission } from "../core/vault.js";
import { avatarUrlFromMeta, refreshActivePeerProfiles } from "./contacts.js";
import { drainInbox } from "./protocol.js";

export async function hydrateFromPrivateVault(privateVault, loginBytes) {
  state.loginBytes = loginBytes;
  state.wrapKey = await wrapKeyFromLogin(loginBytes);
  state.locator = await locatorFromLogin(loginBytes);
  state.publicId = privateVault.publicId;
  state.identityJwk = privateVault.identityJwk;
  state.exchangeJwk = privateVault.exchangeJwk;
  state.contacts = privateVault.contacts || {};
  state.conversations = privateVault.conversations || {};
  state.avatar = sanitizeAvatarMeta(privateVault.avatar);
  state.displayName = sanitizeDisplayName(privateVault.displayName);
  state.identity = {
    privateKey: await importIdentity(privateVault.identityJwk, ["sign"]),
    publicKey: await importIdentity(publicJwk(privateVault.identityJwk), ["verify"]),
  };
  state.exchange = {
    privateKey: await importExchange(privateVault.exchangeJwk, ["deriveBits"]),
    publicKey: await importExchange(publicJwk(privateVault.exchangeJwk), []),
  };
  await loadGifFavs();
  if (state.avatar) {
    state.avatarUrl = await avatarUrlFromMeta(state.avatar);
  }
}

export async function enterSession({ revealKey } = {}) {
  sessionStorage.setItem("shard-key", formatStoredKey(state.loginBytes));
  await loadLocalMessages();
  state.socket?.close();
  if (state.poller) clearInterval(state.poller);

  const startInbox = async ({ forceRender = false } = {}) => {
    try {
      const changed = await drainInbox();
      if (changed || forceRender) hooks.renderApp();
    } catch {
    }
  };

  state.socket = connectInboxSocket(ctx(), async () => {
    const changed = await drainInbox();
    if (changed) hooks.renderApp();
  });
  state.poller = setInterval(() => {
    if (document.hidden) return;
    void startInbox();
  }, 12_000);

  if (revealKey) {
    ui.revealKey.textContent = revealKey;
    ui.revealId.textContent = state.publicId;
    const storeInput = document.getElementById("store-key-input");
    if (storeInput) storeInput.value = revealKey;
    showScreen("reveal");
    void startInbox({ forceRender: true });
  } else {
    showScreen("app");
    requestNotifyPermission();
    hooks.renderApp();
    void startInbox({ forceRender: true }).then(() => refreshActivePeerProfiles());
  }
}

export async function createIdentity() {
  const { bytes, formatted } = await generateLoginKey();
  const wrapKey = await wrapKeyFromLogin(bytes);
  const locator = await locatorFromLogin(bytes);
  const keys = await generateIdentity();
  const identityJwk = await exportPrivateJwk(keys.identity.privateKey);
  const exchangeJwk = await exportPrivateJwk(keys.exchange.privateKey);
  const publicId = await publicIdFromIdentityJwk(identityJwk);
  const privateVault = {
    ...(await emptyPrivateVault(publicId)),
    identityJwk,
    exchangeJwk,
  };
  const vault = await buildPublicVault({
    publicId,
    identityJwk,
    exchangeJwk,
    wrapKey,
    privateVault,
    revision: 1,
  });
  await apiRegister(publicId, locator, vault);
  state.revision = 1;
  await hydrateFromPrivateVault(privateVault, bytes);
  await enterSession({ revealKey: formatted });
}

export async function loginWithKey(text) {
  const loginBytes = parseLoginKey(text);
  const wrapKey = await wrapKeyFromLogin(loginBytes);
  const locator = await locatorFromLogin(loginBytes);
  const found = await apiGetVault(locator);
  const privateVault = await decryptJson(wrapKey, found.vault.enc);
  state.revision = found.vault.revision || 1;
  await hydrateFromPrivateVault(privateVault, loginBytes);
  if (state.publicId !== found.publicId) throw new Error(t("errVaultMismatch"));
  await enterSession();
}
