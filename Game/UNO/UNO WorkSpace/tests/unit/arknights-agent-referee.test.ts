import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startReferee, type Referee } from "../../../../unionarena/UnionArenaWorkSpace/Arknights/rl/referee.ts";

type Reply = { seat: string; view: { step: string; toAct: string | null; you: { hand: Array<{ id: string }> }; opponent: { hand: number } }; actions: Array<{ index: number; text: string }>; newLog: string[] };

let referee: Referee | null = null;
afterEach(async () => { await referee?.close(); referee = null; });

async function call(where: Referee, route: string, body: Record<string, unknown>): Promise<{ status: number; reply: Reply & { error?: string } }> {
  const response = await fetch(`http://${where.host}:${where.port}/${route}`, { method: "POST", body: JSON.stringify(body) });
  return { status: response.status, reply: await response.json() as Reply & { error?: string } };
}

describe("Arknights agent referee", () => {
  it("refuses a wrong or missing token, and another seat's token", async () => {
    referee = await startReferee({ level: "agent", seed: 3 });
    expect((await call(referee, "view", { seat: "p1", token: "0".repeat(32) })).status).toBe(403);
    expect((await call(referee, "view", { seat: "p1" })).status).toBe(403);
    expect((await call(referee, "view", { seat: "p1", token: referee.tokens.p2 })).status).toBe(403);
    expect((await call(referee, "view", { seat: "p1", token: referee.tokens.p1 })).status).toBe(200);
  });

  it("gives each seat its own hand and never the other's", async () => {
    referee = await startReferee({ level: "agent", seed: 5 });
    const one = (await call(referee, "view", { seat: "p1", token: referee.tokens.p1 })).reply;
    const two = (await call(referee, "view", { seat: "p2", token: referee.tokens.p2 })).reply;
    expect(one.view.you.hand.length).toBeGreaterThan(0);
    expect(two.view.opponent.hand).toBe(one.view.you.hand.length);
    const seenByTwo = JSON.stringify(two);
    // Card ids are unique per copy, so none of p1's hand cards may appear anywhere in p2's reply.
    for (const card of one.view.you.hand) expect(seenByTwo).not.toContain(card.id);
    expect(seenByTwo).not.toContain(referee.tokens.p1!);
  });

  it("plays a two-agent game through act and wait", async () => {
    const where = referee = await startReferee({ level: "agent", seed: 8, deck: "rhodes", opponentDeck: "lungmen" });
    let moves = 0;
    let over = false;
    // Everything p1 is told, call after call: it must keep coming after the engine's own log has filled up.
    const seenByOne: string[] = [];
    while (!over && moves < 3000) {
      const look = (await call(where, "view", { seat: "p1", token: where.tokens.p1 })).reply;
      seenByOne.push(...look.newLog);
      const seat = look.view.toAct!;
      const mine = (await call(where, "wait", { seat, token: where.tokens[seat], timeout: 5 })).reply;
      if (seat === "p1") seenByOne.push(...mine.newLog);
      if (mine.view.step === "over") { over = true; break; }
      expect(mine.actions.length).toBeGreaterThan(0);
      const after = await call(where, "act", { seat, token: where.tokens[seat], index: mine.actions[mine.actions.length - 1]!.index });
      expect(after.status).toBe(200);
      if (seat === "p1") seenByOne.push(...after.reply.newLog);
      over = after.reply.view.step === "over";
      moves += 1;
    }
    expect(over).toBe(true);
    seenByOne.push(...(await call(where, "view", { seat: "p1", token: where.tokens.p1 })).reply.newLog);
    expect(seenByOne.length).toBeGreaterThan(60);
    expect(seenByOne.some((line) => line.startsWith("对局结束"))).toBe(true);
    expect(seenByOne.filter((line) => line.startsWith("对局结束"))).toHaveLength(1);
    expect((await call(where, "act", { seat: "p1", token: where.tokens.p1, index: 0 })).status).toBe(409);
  }, 60_000);

  it("plays against a computer with the agent seat's token", async () => {
    referee = await startReferee({ level: "normal", seed: 2 });
    expect(referee.seats).toEqual(["agent"]);
    const { status, reply } = await call(referee, "view", { token: referee.tokens.agent });
    expect(status).toBe(200);
    expect(reply.actions.length).toBeGreaterThan(0);
  });

  it("writes nothing to disk unless asked; a save file is the referee's own", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "referee-test-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      referee = await startReferee({ level: "agent", seed: 4 });
      await call(referee, "act", { seat: referee.firstToDecide, token: referee.tokens[referee.firstToDecide!], index: 0 });
      expect(readdirSync(dir)).toEqual([]);
      await referee.close();
      const saveFile = path.join(dir, "game.json");
      referee = await startReferee({ level: "agent", seed: 4, saveFile });
      expect(readdirSync(dir)).toEqual(["game.json"]);
      const tokens = referee.tokens;
      await referee.close();
      // Resuming from the save file keeps the same game and tokens.
      referee = await startReferee({ saveFile });
      expect(referee.tokens).toEqual(tokens);
      expect(JSON.parse(readFileSync(saveFile, "utf8")).tokens).toEqual(tokens);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
