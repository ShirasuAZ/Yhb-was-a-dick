import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startReferee, type Referee } from "../../../../Arknights/ArknightsWorkSpace/rl/referee.ts";
import { parseDecision, requestDecision } from "../../../../Arknights/ArknightsWorkSpace/rl/model-api.ts";
import { startModelDuel } from "../../../../Arknights/ArknightsWorkSpace/rl/model-duel.ts";

let referee: Referee | undefined;
let server: Server | undefined;
let duel: Awaited<ReturnType<typeof startModelDuel>> | undefined;
let temporaryDirectory: string | undefined;
afterEach(async () => {
  await duel?.close(); duel = undefined;
  await referee?.close(); referee = undefined;
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; }
  vi.restoreAllMocks();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined;
});

describe("API model duel", () => {
  it("allows a local observer to see both hands without exposing tokens, deck order or life faces", async () => {
    referee = await startReferee({ level: "agent", seed: 19 });
    const snapshot = referee.snapshot();
    expect(snapshot.state.hand).toHaveLength(7);
    expect(snapshot.opponentHand).toHaveLength(7);
    expect(snapshot.state.game?.deckCount).toEqual({ you: 43, opponent: 43 });
    expect(snapshot.state.life.you.every((card) => card.cardId === null)).toBe(true);
    expect(snapshot.state.life.opponent.every((card) => card.cardId === null)).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(referee.tokens.p1!);
    expect(serialized).not.toContain(referee.tokens.p2!);
    expect(serialized).not.toContain('"library"');
    const reply = await fetch(`http://${referee.host}:${referee.port}/view`, { method: "POST", body: JSON.stringify({ seat: "p1", token: referee.tokens.p1 }) }).then((r) => r.json());
    expect(reply.view.opponent.hand).toBe(7);
    expect(reply.opponentHand).toBeUndefined();
    for (const seat of [referee.firstToDecide!, referee.firstToDecide === "p1" ? "p2" : "p1"]) {
      await fetch(`http://${referee.host}:${referee.port}/act`, { method: "POST", body: JSON.stringify({ seat, token: referee.tokens[seat], index: 0 }) });
    }
    const started = referee.snapshot();
    expect(started.state.life.you).toHaveLength(7);
    expect(started.state.life.opponent).toHaveLength(7);
    expect([...started.state.life.you, ...started.state.life.opponent].every((card) => card.cardId === null)).toBe(true);
  });

  it("accepts JSON decisions only when their index is a legal integer", () => {
    expect(parseDecision('```json\n{"index":7,"reason":"建立能量"}\n```', [2, 7])).toEqual({ index: 7, reason: "建立能量" });
    for (const text of ['{"index":8}', '{"index":2.5}', '{"index":"7"}', '7', '{"index":null}', 'invalid']) {
      expect(() => parseDecision(text, [2, 7])).toThrow();
    }
  });

  it("retries malformed model output and submits only the validated action", async () => {
    let calls = 0;
    server = createServer((req, res) => {
      let raw = ""; req.on("data", (chunk) => { raw += String(chunk); });
      req.on("end", () => {
        const body = JSON.parse(raw);
        if (req.url !== "/v1/chat/completions" || req.headers.authorization !== "Bearer test-secret" || body.model !== "test-model") { res.writeHead(400).end(); return; }
        calls++;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ model: "test-model", choices: [{ message: { content: calls === 1 ? '{"index":99}' : '{"index":2,"reason":"展开"}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const result = await requestDecision({ baseUrl, apiKey: "test-secret", model: "test-model", label: "模型" }, "规则", "局面", [2, 7]);
    expect(result.index).toBe(2);
    expect(result.reason).toBe("展开");
    expect(result.attempts).toBe(2);
    expect(result.usage?.prompt_tokens).toBe(40);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });

  it("redacts API keys from provider errors and stops after bounded retries", async () => {
    server = createServer((_req, res) => { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"message":"bad key test-secret"}}'); });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(requestDecision({ baseUrl, apiKey: "test-secret", model: "test-model", label: "模型" }, "规则", "局面", [0])).rejects.toThrow(/401/);
    try { await requestDecision({ baseUrl, apiKey: "test-secret", model: "test-model", label: "模型" }, "规则", "局面", [0]); } catch (error) { expect(String(error)).not.toContain("test-secret"); }
  });

  it("increases the reasoning budget after truncation without sending an empty assistant message", async () => {
    const budgets: number[] = [];
    let invalidHistory = false;
    server = createServer((req, res) => {
      let raw = ""; req.on("data", (chunk) => { raw += String(chunk); });
      req.on("end", () => {
        const body = JSON.parse(raw);
        budgets.push(body.max_tokens);
        if (body.messages.some((message: { role: string; content: string }) => message.role === "assistant" && message.content === "")) invalidHistory = true;
        const truncated = budgets.length === 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "test-model", choices: [{ finish_reason: truncated ? "length" : "stop", message: { content: truncated ? "" : '{"index":7,"reason":"展开"}', reasoning_content: "private reasoning" } }], usage: { prompt_tokens: 10, completion_tokens: 8192 } }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await requestDecision({ baseUrl, apiKey: "test-secret", model: "test-model", label: "模型" }, "规则", "局面", [2, 7]);
    expect(result.index).toBe(7);
    expect(result.attempts).toBe(2);
    expect(budgets[0]).toBeGreaterThanOrEqual(8192);
    expect(budgets[1]).toBeGreaterThan(budgets[0]!);
    expect(invalidHistory).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private reasoning");
  });

  it("reports output truncation separately from malformed JSON after bounded retries", async () => {
    server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "private reasoning" } }] })); });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(requestDecision({ baseUrl, apiKey: "test-secret", model: "test-model", label: "模型" }, "规则", "局面", [0])).rejects.toThrow(/输出.*截断/);
  });

  it("resumes the same saved game and decision history without dealing again", async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "duel-resume-"));
    const refereeFile = path.join(temporaryDirectory, "referee.json");
    const controllerFile = path.join(temporaryDirectory, "controller.json");
    referee = await startReferee({ level: "agent", seed: 5, first: "p1", saveFile: refereeFile });
    for (const seat of ["p1", "p2"]) await fetch(`http://${referee.host}:${referee.port}/act`, { method: "POST", body: JSON.stringify({ seat, token: referee.tokens[seat], index: 0 }) });
    const before = referee.snapshot();
    await referee.close(); referee = undefined;
    const moves = [{ number: 1, seat: "p1", label: "模型 A", turn: 0, phase: "mulligan", action: "保留起手牌", reason: "保留", elapsedMs: 1, attempts: 1, model: "a" }];
    writeFileSync(controllerFile, JSON.stringify({ live: { moves, startedAt: 123, status: "error", error: "旧错误" }, seen: { p1: ["旧日志"], p2: [] } }));
    const model = { baseUrl: "http://127.0.0.1:1", apiKey: "private", model: "a", label: "模型 A" };
    duel = await startModelDuel({ models: { p1: model, p2: { ...model, label: "模型 B" } }, resume: { refereeFile, controllerFile }, assets: { js: "", css: "" } });
    const after = duel.snapshot();
    expect(after.state.game).toEqual(before.state.game);
    expect(after.state.hand).toEqual(before.state.hand);
    expect(after.opponentHand).toEqual(before.opponentHand);
    expect(after.moves).toEqual(moves);
    expect(after.startedAt).toBe(123);
    expect(after.status).toBe("ready");
    expect(after.error).toBeNull();
  });

  it("runs two API-only players to game over while the spectator remains read only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const leaks: string[] = [];
    const seats = new Set<string>();
    server = createServer((req, res) => {
      let raw = ""; req.on("data", (chunk) => { raw += String(chunk); });
      req.on("end", () => {
        const request = JSON.parse(raw);
        const prompt = JSON.parse(request.messages[1].content);
        seats.add(prompt.seat);
        if (typeof prompt.view.opponent.hand !== "number" || "opponentHand" in prompt || "tokens" in prompt || raw.includes("p1-private") || raw.includes("p2-private")) leaks.push(prompt.seat);
        const last = prompt.actions.at(-1);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: request.model, choices: [{ message: { content: JSON.stringify({ index: last.index, reason: "测试选择合法动作" }) } }] }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    duel = await startModelDuel({
      models: { p1: { baseUrl, apiKey: "p1-private", model: "model-a", label: "模型 A" }, p2: { baseUrl, apiKey: "p2-private", model: "model-b", label: "模型 B" } },
      seed: 8, deck: "rhodes", opponentDeck: "lungmen", delayMs: 0, assets: { js: "", css: "" }
    });
    expect((await fetch(duel.url + "/act", { method: "POST", body: '{"index":0}' })).status).toBe(405);
    const first = await fetch(duel.url + "/snapshot").then((r) => r.json());
    expect(first.state.hand).toHaveLength(7);
    expect(first.opponentHand).toHaveLength(7);
    expect(JSON.stringify(first)).not.toContain("p1-private");
    const catalog = await fetch(duel.url + "/catalog").then((r) => r.json());
    expect((await fetch(duel.url + catalog.find((card: { imageAvailable: boolean }) => card.imageAvailable).imageUrl)).headers.get("content-type")).toBe("image/png");
    await duel.run();
    const final = await fetch(duel.url + "/snapshot").then((r) => r.json());
    expect(final.status).toBe("finished");
    expect(final.state.game.step).toBe("over");
    expect(["p1", "p2"]).toContain(final.state.game.winnerId);
    expect(seats).toEqual(new Set(["p1", "p2"]));
    expect(leaks).toEqual([]);
    expect(final.moves.length).toBeGreaterThan(10);
  }, 60_000);
});
