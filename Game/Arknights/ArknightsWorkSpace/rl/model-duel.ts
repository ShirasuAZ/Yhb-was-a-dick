/** API-only models play a real referee game, with a read-only spectator page on loopback. */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startReferee } from "./referee.ts";
import { requestDecision, type ModelConfig } from "./model-api.ts";
import type { AgentView } from "../src/shared/ai/agent.ts";
import { UNION_ARENA_ASSET_ROOT, UNION_ARENA_CATALOG } from "../src/server/catalog.ts";
import type { DuelSnapshot } from "./model-duel-types.ts";

export interface DuelOptions {
  models: Record<"p1" | "p2", ModelConfig>;
  port?: number; seed?: number; deck?: string; opponentDeck?: string;
  /** Local transcript contains actions/reasons, never credentials or full model prompts. */
  logFile?: string;
  /** Already bundled spectator JS/CSS; tests supply a tiny page without building. */
  assets: { js: string; css: string };
  delayMs?: number;
  /** Explicit private recovery files; normal games still keep referee state only in memory. */
  resume?: { refereeFile: string; controllerFile: string };
}

interface SeatReply { seat: string; view: AgentView; actions: Array<{ index: number; text: string }>; newLog: string[] }

export async function startModelDuel(options: DuelOptions) {
  const restored = options.resume ? JSON.parse(readFileSync(options.resume.controllerFile, "utf8")) as { live: Partial<Omit<DuelSnapshot, "state" | "opponentHand">>; seen: Record<string, string[]> } : null;
  const referee = await startReferee({ level: "agent", seed: options.seed, deck: options.deck ?? "lungmen", opponentDeck: options.opponentDeck ?? "chernobog", saveFile: options.resume?.refereeFile });
  const abort = new AbortController();
  const labels = { p1: options.models.p1.label, p2: options.models.p2.label };
  const live: Omit<DuelSnapshot, "state" | "opponentHand"> = {
    labels, decks: { p1: options.deck ?? "lungmen", p2: options.opponentDeck ?? "chernobog" },
    status: "ready", thinkingSeat: null, thinkingSince: null, error: null, startedAt: Date.now(), moves: [],
    usage: { p1: { prompt_tokens: 0, completion_tokens: 0 }, p2: { prompt_tokens: 0, completion_tokens: 0 } },
    ...restored?.live
  };
  live.status = "ready"; live.error = null; live.thinkingSeat = null; live.thinkingSince = null;
  const snapshot = (): DuelSnapshot => {
    const board = referee.snapshot();
    board.state.players.forEach((player) => { player.username = labels[player.id as "p1" | "p2"] ?? player.username; });
    board.state.you.username = labels.p1;
    return structuredClone({ ...board, ...live });
  };
  const catalog = UNION_ARENA_CATALOG.map((card) => ({ ...card, imageUrl: card.imageAvailable ? `/cards/${encodeURIComponent(card.id)}` : null }));
  const knownCards = new Map(catalog.map((card) => [card.id, card]));
  const server = createServer((req, res) => {
    const send = (type: string, body: string | Buffer, status = 200) => { res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(body); };
    if (req.method !== "GET") { send("application/json", '{"error":"read only"}', 405); return; }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/snapshot") return send("application/json; charset=utf-8", JSON.stringify(snapshot()));
    if (url.pathname === "/catalog") return send("application/json; charset=utf-8", JSON.stringify(catalog));
    if (url.pathname === "/duel.js") return send("application/javascript; charset=utf-8", options.assets.js);
    if (url.pathname === "/duel.css") return send("text/css; charset=utf-8", options.assets.css);
    if (url.pathname.startsWith("/cards/")) {
      let card;
      try { card = knownCards.get(decodeURIComponent(url.pathname.slice(7))); } catch { /* invalid URL */ }
      if (!card?.imageAvailable) return send("text/plain", "not found", 404);
      try { return send("image/png", readFileSync(path.join(UNION_ARENA_ASSET_ROOT, card.file))); } catch { return send("text/plain", "not found", 404); }
    }
    if (url.pathname === "/") return send("text/html; charset=utf-8", '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT-6.1 Sol × DeepSeek · 明日方舟对战</title><link rel="stylesheet" href="/duel.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/duel.js"></script></body></html>');
    return send("text/plain", "not found", 404);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (route: string, seat: string, extra: Record<string, unknown> = {}): Promise<SeatReply> => {
    const response = await fetch(`http://${referee.host}:${referee.port}/${route}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat, token: referee.tokens[seat], ...extra }), signal: abort.signal
    });
    if (!response.ok) throw new Error(`裁判拒绝操作：HTTP ${response.status}`);
    return await response.json() as SeatReply;
  };
  const rules = `你正在与另一模型进行明日方舟 UNION ARENA 正式对战。你只知道自己的可见信息，不知道对手手牌、牌库顺序和未翻开的生命卡。认真利用能量线和 AP，建立前线并攻击以获胜；不要无故空过。只选择当前合法动作编号，不要编造操作。响应必须是一个 JSON 对象：{"index":整数,"reason":"60字以内的公开行动理由"}。reason 会显示给观众，不要给出长篇推理。你可以看到自己之前的行动和公共日志；当前动作编号只在本次有效。\n\n${readFileSync(new URL("../RULES.md", import.meta.url), "utf8")}`;
  const seen: Record<string, string[]> = restored?.seen ?? { p1: [], p2: [] };
  const persistController = () => { if (options.resume) writeFileSync(options.resume.controllerFile, JSON.stringify({ live, seen }), { mode: 0o600 }); };
  let running = false;
  const run = async (): Promise<void> => {
    if (running) throw new Error("DUEL_ALREADY_RUNNING");
    running = true;
    try {
      let reply = await call("view", "p1");
      seen.p1!.push(...reply.newLog);
      for (let step = 0; step < 1500; step++) {
        if (reply.view.step === "over") { live.status = "finished"; live.thinkingSeat = null; live.thinkingSince = null; return; }
        const seat = reply.view.toAct as "p1" | "p2";
        if (seat !== "p1" && seat !== "p2") throw new Error("裁判没有给出当前决策方");
        reply = await call("view", seat);
        seen[seat]!.push(...reply.newLog);
        seen[seat] = seen[seat]!.slice(-240);
        if (!reply.actions.length) throw new Error("当前没有可用动作");
        const fieldIds = new Set([...reply.view.you.front, ...reply.view.you.energyLine, ...reply.view.opponent.front, ...reply.view.opponent.energyLine].map((card) => card.cardId));
        // Derive references exclusively from that seat's public view. Never use snapshot/opponentHand here.
        const publicCardTexts = [...fieldIds].map((id) => { const card = knownCards.get(id); return card ? { id, name: card.name, number: card.number, stats: card.stats } : null; });
        const prompt = JSON.stringify({ seat, view: reply.view, actions: reply.actions, publicCardTexts, publicHistory: seen[seat], yourPreviousDecisions: live.moves.filter((move) => move.seat === seat).slice(-16).map(({ turn, action, reason }) => ({ turn, action, reason })) });
        live.status = "thinking"; live.thinkingSeat = seat; live.thinkingSince = Date.now();
        const decision = await requestDecision(options.models[seat], rules, prompt, reply.actions.map((action) => action.index), abort.signal);
        const move = { number: live.moves.length + 1, seat, label: labels[seat], turn: reply.view.turn, phase: reply.view.step === "mulligan" ? "mulligan" : reply.view.phase,
          action: reply.actions.find((action) => action.index === decision.index)!.text, reason: decision.reason, elapsedMs: decision.elapsedMs, attempts: decision.attempts, model: decision.model };
        const after = await call("act", seat, { index: decision.index });
        seen[seat]!.push(...after.newLog);
        live.moves.push(move);
        live.usage[seat]!.prompt_tokens += decision.usage?.prompt_tokens ?? 0;
        live.usage[seat]!.completion_tokens += decision.usage?.completion_tokens ?? 0;
        if (options.logFile) appendFileSync(options.logFile, JSON.stringify(move) + "\n", { mode: 0o600 });
        console.log(JSON.stringify({ move: move.number, seat, action: move.action, elapsedMs: move.elapsedMs }));
        live.status = "playing"; live.thinkingSeat = null; live.thinkingSince = null;
        persistController();
        reply = after;
        if (options.delayMs !== 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 800));
        abort.signal.throwIfAborted();
      }
      throw new Error("已达到 1500 次模型决策上限，对局暂停");
    } catch (error) {
      if (!abort.signal.aborted) {
        live.status = "error"; live.thinkingSeat = null; live.thinkingSince = null;
        let message = error instanceof Error ? error.message : String(error);
        for (const config of Object.values(options.models)) message = message.split(config.apiKey).join("[redacted]");
        live.error = message;
        persistController();
        console.error(message);
      }
    } finally {
      running = false;
    }
  };
  return { url, snapshot, run, close: async () => { abort.abort(); await referee.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("用法：tsx rl/model-duel.ts /absolute/path/credentials.json [port] [runtime-dir]");
  const models = JSON.parse(readFileSync(configPath, "utf8")) as DuelOptions["models"];
  for (const config of Object.values(models)) if (!config.baseUrl || !config.apiKey || !config.model) throw new Error("模型配置缺少 baseUrl/apiKey/model");
  const require = createRequire(new URL("../../../UNO/UNO WorkSpace/package.json", import.meta.url));
  const { build } = require("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }> };
  const nodeModules = fileURLToPath(new URL("../../../UNO/UNO WorkSpace/node_modules/", import.meta.url));
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../../UNO/UNO WorkSpace/client/src/model-duel.tsx", import.meta.url))], bundle: true, write: false, outdir: "out", platform: "browser", format: "esm", jsx: "automatic", tsconfigRaw: {}, alias: { react: path.join(nodeModules, "react"), "react-dom": path.join(nodeModules, "react-dom") }, define: { "process.env.NODE_ENV": '"production"' } });
  const runtime = process.argv[4] ?? path.dirname(path.resolve(configPath));
  const resume = process.argv.includes("--resume") ? { refereeFile: path.join(runtime, "referee-recovery.json"), controllerFile: path.join(runtime, "controller-recovery.json") } : undefined;
  const duel = await startModelDuel({ models, resume, port: Number(process.argv[3] ?? 0), assets: { js: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text, css: bundle.outputFiles.find((file) => file.path.endsWith(".css"))!.text }, logFile: path.join(runtime, "moves.jsonl") });
  writeFileSync(path.join(runtime, "connection.json"), JSON.stringify({ url: duel.url, pid: process.pid }), { mode: 0o600 });
  console.log(JSON.stringify({ url: duel.url }));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void duel.close().then(() => process.exit(0)); });
  void duel.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
