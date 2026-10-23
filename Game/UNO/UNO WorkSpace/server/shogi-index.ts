import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShogiServer } from "./shogi.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const server = createShogiServer({ clientDist: path.resolve(currentDir, "../client") });
server.listen().then((port) => console.log(`Shogi server listening on http://127.0.0.1:${port}`)).catch((error) => { console.error("Failed to start Shogi server", error); process.exitCode = 1; });

const shutdown = (): void => { server.close().catch((error) => console.error(error)).finally(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
