/**
 * Command-line game API for agents (and people): one Arknights UNION ARENA game, one decision per call, so any program that can run a
 * command can play. The game lives only in a referee process (rl/referee.ts); the other commands ask it over HTTP on 127.0.0.1 and get back
 * only what their own seat may see. Nothing an agent can read on disk holds the game: the connection file has only { host, port }.
 *
 * Start the referee (it keeps running; stop it with Ctrl+C once the game is over):
 *   npx tsx rl/agent.ts serve [--level hard] [--deck lungmen] [--opponent-deck rhodes] [--first random] [--seed 1] [--port 0] [--server-file F]
 *   -> prints { host, port, serverFile, tokens, seats, firstToDecide }
 * Against a computer the only seat is "agent"; --level agent starts a two-agent game with seats "p1" and "p2". Each seat gets a secret
 * token: give each agent its own seat and token (keep the referee's output away from the agents).
 *
 * Play a seat:
 *   npx tsx rl/agent.ts view --as agent --token T
 *   npx tsx rl/agent.ts act <index> --as p1 --token T
 *   npx tsx rl/agent.ts wait --as p1 --token T [--timeout 600]   (returns once it is that seat's decision or the game is over)
 * The referee is found through --server host:port, or the connection file (--server-file, default <tmpdir>/arknights-agent-server.json).
 *
 * Decks: rhodes, lungmen, reunion, chernobog or random. Levels: easy, normal, hard, master, agent. Add --text for a readable view.
 * Each call prints { seat, view, actions, newLog }: what the seat can see (src/shared/ai/agent.ts AgentView), the numbered decisions open to
 * it now (empty while it is the other side's decision), and the log lines since that seat's previous call.
 * To resume after a restart, "serve --save FILE" keeps the whole game in FILE; only the referee reads it, so put it where no agent looks.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS, startReferee, type Level } from "./referee.ts";

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const serverFile = option(args, "server-file", path.join(os.tmpdir(), "arknights-agent-server.json"));
  const text = args.includes("--text");
  if (!command || command === "help" || command === "--help") { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]); return; }

  if (command === "serve") {
    const level = option(args, "level", "hard") as Level;
    if (!LEVELS.includes(level)) throw new Error(`--level must be one of ${LEVELS.join(", ")}`);
    const seed = option(args, "seed", "");
    const save = option(args, "save", "");
    const referee = await startReferee({
      level, deck: option(args, "deck", "lungmen"), opponentDeck: option(args, "opponent-deck", "rhodes"), first: option(args, "first", "random"),
      seed: seed ? Number(seed) : undefined, port: Number(option(args, "port", "0")), saveFile: save ? path.resolve(save) : undefined
    });
    writeFileSync(serverFile, JSON.stringify({ host: referee.host, port: referee.port }));
    console.log(JSON.stringify({ host: referee.host, port: referee.port, serverFile, tokens: referee.tokens, seats: referee.seats, firstToDecide: referee.firstToDecide }, null, 2));
    const stop = (): void => { rmSync(serverFile, { force: true }); void referee.close().then(() => process.exit(0)); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  if (!["view", "act", "wait"].includes(command)) throw new Error(`unknown command "${command}" (serve, view, act, wait)`);
  const address = option(args, "server", "") || (() => {
    try { const { host, port } = JSON.parse(readFileSync(serverFile, "utf8")) as { host: string; port: number }; return `${host}:${port}`; }
    catch { throw new Error(`no referee found in ${serverFile}: start one with "serve" (or pass --server host:port)`); }
  })();
  const timeout = Number(option(args, "timeout", "600"));
  const body = { seat: option(args, "as", "agent"), token: option(args, "token", ""), text, ...(command === "act" ? { index: Number(args[0]) } : {}), ...(command === "wait" ? { timeout } : {}) };
  const response = await fetch(`http://${address}/${command}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout((timeout + 30) * 1000) })
    .catch(() => { throw new Error(`referee at ${address} does not answer`); });
  const reply = await response.json() as { error?: string; text?: string };
  if (!response.ok) throw new Error(reply.error ?? `HTTP ${response.status}`);
  console.log(text ? reply.text : JSON.stringify(reply, null, 2));
}

main().catch((error: Error) => { console.error(`error: ${error.message}`); process.exit(1); });
