import http from "node:http";
import { prisma } from "./core/db.js";
import { config } from "./core/config.js";
import { ensureDataDirs } from "./core/paths.js";
import { createHttpApp } from "./routes/http.js";
import { attachWebSocket } from "./routes/ws.js";

ensureDataDirs();

const PORT = Number(process.env.PORT || 8787);
const sockets = new Map();
const app = createHttpApp(sockets);
const server = http.createServer(app);
attachWebSocket(server, sockets);

server.listen(PORT, () => {
  const addr = `http://127.0.0.1:${PORT}`;
  const title = `${config.name} relay`;
  const w = 44;
  const line = (l, r) => `  ║  ${l.padEnd(10)} ${r.padEnd(w - 15)}║`;
  console.log();
  console.log(`  ╔${"═".repeat(w)}╗`);
  console.log(`  ║${title.padStart((w + title.length) / 2).padEnd(w)}║`);
  console.log(`  ╠${"═".repeat(w)}╣`);
  console.log(line("Status", "Running"));
  console.log(line("Address", addr));
  console.log(line("Crypto", "E2EE · AES-256-GCM"));
  console.log(line("Mode", "Opaque relay (zero-knowledge)"));
  console.log(line("Author", config.credits.author));
  console.log(line("GitHub", config.credits.github));
  console.log(`  ╚${"═".repeat(w)}╝`);
  console.log();
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
