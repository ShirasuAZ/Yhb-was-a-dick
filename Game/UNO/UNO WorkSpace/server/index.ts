import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./app.ts";

export { createAppServer };
export type { AppServer, AppServerOptions } from "./app.ts";

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const server = createAppServer({
    clientDist: path.resolve(currentDir, "../client")
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  server
    .listen(port, host)
    .then((actualPort) => {
      console.log(`UNO server listening on http://${host}:${actualPort}`);
      console.log(
        `LAN access ${server.lanAccess.isEnabled() ? "open" : "closed"}`
      );
      for (const address of server.lanAccess.status().addresses) {
        console.log(`- ${address.name}: ${address.url}`);
      }
    })
    .catch((error) => {
      console.error("Failed to start UNO server", error);
      process.exitCode = 1;
    });

  const shutdown = (): void => {
    server
      .close()
      .catch((error) => console.error(error))
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
