import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";

const root = process.cwd();
const entry = path.join(root, "dist/server/shogi-index.js");
await fs.access(entry);

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "layudown-shogi-dist-"));
const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: {
    ...process.env,
    UNO_DATA_DIR: path.join(temp, "accounts"),
    SHOGI_PORT: String(port),
    SHOGI_HOST: "127.0.0.1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let logs = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => { logs += chunk; });
child.stderr.setEncoding("utf8").on("data", (chunk) => { logs += chunk; });

const base = `http://127.0.0.1:${port}`;
let socket;
try {
  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Shogi server exited early. ${logs}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (health?.ok !== true || health.service !== "shogi") throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);

  const head = await fetch(`${base}/shogi`, { method: "HEAD" });
  if (head.status !== 200) throw new Error(`HEAD /shogi returned HTTP ${head.status}`);
  const page = await fetch(`${base}/shogi`);
  if (!page.ok || !(await page.text()).includes("<title>LayUDown</title>")) {
    throw new Error("GET /shogi did not return the protected LayUDown SPA document");
  }

  socket = io(base, {
    path: "/shogi-socket.io",
    transports: ["websocket"],
    reconnection: false,
    timeout: 3000
  });
  const authResult = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Unauthenticated Shogi WebSocket timed out")), 4000);
    socket.once("connect_error", (error) => { clearTimeout(timer); resolve(error.message); });
    socket.once("connect", () => { clearTimeout(timer); reject(new Error("Unauthenticated Shogi WebSocket was accepted")); });
  });
  if (authResult !== "AUTH_REQUIRED") throw new Error(`Unexpected WebSocket auth result: ${authResult}`);

  console.log(`SHOGI_DIST_SMOKE_OK health=${health.service} GET=/shogi HEAD=/shogi:${head.status} websocket=AUTH_REQUIRED`);
} finally {
  socket?.close();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await fs.rm(temp, { recursive: true, force: true });
}
