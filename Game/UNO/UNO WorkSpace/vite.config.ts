import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
) as { version: string };

export default defineConfig({
  root: "client",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  resolve: {
    alias: {
      "@shared": path.resolve(process.cwd(), "shared"),
      "@uno-client": path.resolve(process.cwd(), "client/src"),
      "@arknights": path.resolve(process.cwd(), "../../unionarena/UnionArenaWorkSpace/Arknights/src/client"),
      "react/jsx-runtime": path.resolve(process.cwd(), "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(process.cwd(), "node_modules/react/jsx-dev-runtime.js"),
      react: path.resolve(process.cwd(), "node_modules/react"),
      "socket.io-client": path.resolve(process.cwd(), "node_modules/socket.io-client/build/esm/index.js"),
      "@shogi/engine": path.resolve(process.cwd(), "../../Hon shugi/Hon shugi WorkSpace/src/engine.ts")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true
      },
      "/api": {
        target: "http://127.0.0.1:3000"
      },
      "/assets/arknights": {
        target: "http://127.0.0.1:3000"
      },
      // Card art and translations for every title come from the room service. The home page's own cover images live in
      // client/public/assets/union-arena and are served by Vite, so only these two sub-paths are proxied.
      "/assets/union-arena/cards": {
        target: "http://127.0.0.1:3000"
      },
      "/assets/union-arena/translations": {
        target: "http://127.0.0.1:3000"
      },
      "/shogi-socket.io": {
        target: "http://127.0.0.1:3001",
        ws: true
      }
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist/client"),
    emptyOutDir: true
  }
});
