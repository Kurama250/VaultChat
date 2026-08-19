# VaultChat — E2EE Messaging Relay

<div align="center">

<img src="https://cdn.simpleicons.org/letsencrypt/181717" width="80" alt="Encryption"/>

<br/><br/>

[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge)](.)
[![Version](https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge)](.)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?style=for-the-badge&logo=node.js&logoColor=white)](.)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![PM2](https://img.shields.io/badge/PM2-Process_Manager-2B037A?style=for-the-badge)](https://pm2.keymetrics.io/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)

<br/>

</div>

---

<div align="center">

## Overview

**VaultChat** is a self-hosted, end-to-end encrypted messaging relay.  
The server is **opaque** — it never reads, stores, or processes any plaintext.  
All encryption happens client-side using **AES-256-GCM**, **ECDH P-256** and **ECDSA P-256**.

</div>

---

<div align="center">

## Features

### ![Encryption](https://img.shields.io/badge/🔐_End--to--End_Encryption-181717?style=flat-square)

| Algorithm | Usage |
|---|---|
| AES-256-GCM | Message & file encryption |
| ECDH P-256 | Key agreement (pairwise & sealed) |
| ECDSA P-256 | Identity signatures |
| HKDF-SHA-256 | Key derivation |

---

### ![Messaging](https://img.shields.io/badge/💬_Messaging-0088FF?style=flat-square)

| Feature | Description |
|---|---|
| Direct Messages | 1-to-1 encrypted conversations |
| Group Chats | Multi-member with shared group key |
| File Sharing | Encrypted file upload & download (20 MB max) |
| GIF Picker | Integrated search via Gifukai & Openverse |
| Emoji Picker | Full emoji panel with categories |
| GIF Favorites | Save and reuse favorite GIFs |

---

### ![Security](https://img.shields.io/badge/🛡️_Security-FF4444?style=flat-square)

| Feature | Description |
|---|---|
| Zero-Knowledge | Server never sees plaintext data |
| Signed Requests | Every API call is identity-signed |
| Rate Limiting | Sliding-window per-route limits |
| CSP + Helmet | Strict Content Security Policy |
| HSTS | Enforced in production |
| ID Validation | Strict format checks on all identifiers |

---

### ![Real-time](https://img.shields.io/badge/⚡_Real--time-F38020?style=flat-square)

| Feature | Description |
|---|---|
| WebSocket | Instant message delivery |
| Polling Backup | Light 12s fallback polling |
| Notifications | Browser push notifications |

---

### ![UI](https://img.shields.io/badge/🎨_Interface-9B59B6?style=flat-square)

| Feature | Description |
|---|---|
| Bilingual | French & English (live switch) |
| Responsive | Desktop & mobile layout |
| Dark Theme | Modern dark UI |
| Custom Dialogs | No native browser alerts |
| Password Manager | Auto-fill compatible login |
| Session Resume | Instant reload without flash |

</div>

---

## How It Works

```
Client generates identity keys (ECDSA + ECDH)
        ↓
Vault encrypted with login key (AES-256-GCM)
        ↓
Sealed envelopes sent through opaque relay
        ↓
Recipient decrypts with their private key
        ↓
Server only stores encrypted blobs + indexes
```

---

## Requirements

| Requirement | Details |
|---|---|
| Node.js | `>= 18.0.0` |
| PM2 | Recommended for production |
| SQLite | Via Prisma (auto-managed) |
| Browser | Modern browser with Web Crypto API |

---

## Setup

```
1. Clone the repository
2. Edit config.json (project name, logo, credits)
3. npm install
4. npm start
```

### Install

```bash
git clone https://github.com/Kurama250/VaultChat.git
cd VaultChat
npm install
```

### Start with PM2

```bash
npm install -g pm2

pm2 start server/index.js --name vaultchat
pm2 save
pm2 startup
```

### PM2 commands

```bash
pm2 status              # Check process status
pm2 logs vaultchat      # Live logs
pm2 restart vaultchat   # Restart after config change
pm2 stop vaultchat      # Stop the relay
pm2 delete vaultchat    # Remove from PM2
```

### `config.json`

```json
{
  "name": "Chat.kurama.info",
  "logo": "/img/kurama.png",
  "url": "https://chat.kurama.info",
  "credits": {
    "author": "Kurama",
    "github": "https://github.com/Kurama250/"
  }
}
```

Change the project name and logo here — the entire UI updates automatically.

---

## Scripts

| Command | Description |
|---|---|
| `npm start` | Push DB schema & start server |
| `npm run dev` | Dev mode with auto-reload |
| `pm2 start server/index.js --name vaultchat` | Production with PM2 |

---

## Project Structure

```
VaultChat/
├── config.json
├── package.json
├── prisma/
│   └── schema.prisma
├── server/
│   ├── index.js
│   ├── core/
│   │   ├── db.js
│   │   ├── paths.js
│   │   ├── config.js
│   │   └── verify.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── security.js
│   ├── data/
│   │   └── store.js
│   ├── services/
│   │   ├── avatar.js
│   │   ├── profile.js
│   │   └── gifs.js
│   └── routes/
│       ├── http.js
│       └── ws.js
├── client/
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── app.js
│       ├── boot-early.js
│       ├── core/
│       │   ├── state.js
│       │   ├── util.js
│       │   ├── vault.js
│       │   ├── api.js
│       │   ├── crypto.js
│       │   ├── idb.js
│       │   ├── i18n.js
│       │   ├── profile.js
│       │   └── media.js
│       ├── chat/
│       │   ├── session.js
│       │   ├── protocol.js
│       │   ├── conversations.js
│       │   ├── contacts.js
│       │   └── messages.js
│       └── ui/
│           ├── render.js
│           ├── modals.js
│           ├── dialog.js
│           ├── lang.js
│           ├── picker.js
│           ├── emoji-data.js
│           └── gif-favs.js
└── data/
    ├── index.db
    ├── vaults/
    ├── envelopes/
    └── files/
```

---

## Startup Preview

```
  ╔════════════════════════════════════════════╗
  ║      Chat.kurama.info relay               ║
  ╠════════════════════════════════════════════╣
  ║  Status     Running                        ║
  ║  Address    http://127.0.0.1:8787          ║
  ║  Crypto     E2EE · AES-256-GCM            ║
  ║  Mode       Opaque relay (zero-knowledge)  ║
  ║  Author     Kurama                         ║
  ║  GitHub     https://github.com/Kurama250/  ║
  ╚════════════════════════════════════════════╝
```

---

<div align="center">

## Support

<a href="https://discord.gg/6aebQGdDxB" title="Join Discord Support">
  <img src="https://cdn.simpleicons.org/discord/5865F2" width="56" alt="Discord Support"/>
</a>

<br/>

If you like this project don't hesitate to give it a star ⭐ !

</div>

---

<div align="center">

## Developer

[![Kurama250](https://img.shields.io/badge/Main%20Dev-Kurama250-orange?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Kurama250)

---

*VaultChat — Self-hosted end-to-end encrypted messaging with an opaque relay*

</div>
