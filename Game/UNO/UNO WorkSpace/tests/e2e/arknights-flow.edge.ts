/**
 * The whole Arknights flow in Microsoft Edge, played through the page the way a person would: the lobby, the tutorial to its last step,
 * a game against the computer to the end, and a Players vs Players game between two Edge windows to the end. Each side's moves are
 * picked from what the page offers (hand cards, attack buttons in the card view, the action bar). Error notices, page errors and console
 * errors are collected and must stay empty; screenshots go to test-results/edge-flow/.
 *
 *     npx playwright test -c playwright.edge.config.ts
 */
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

const SHOTS = "test-results/edge-flow";
mkdirSync(SHOTS, { recursive: true });

/** Notices the page shows for a refused move, page errors and console errors, per page. */
interface Watch { label: string; problems: string[] }

function watch(page: Page, label: string): Watch {
  const result: Watch = { label, problems: [] };
  page.on("pageerror", (error) => result.problems.push(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") result.problems.push(`console: ${message.text()} @ ${message.location().url} (${page.url()})`); });
  page.on("response", (response) => { if (response.status() >= 400) result.problems.push(`http ${response.status()}: ${response.url()}`); });
  return result;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function register(page: Page, prefix: string): Promise<string> {
  const username = `${prefix}_${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
  await page.goto("/uno");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-email").fill(`${username}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await page.waitForURL("/");
  return username;
}

const prompt = (page: Page): Promise<string> => page.locator(".ua-actionbar-prompt").innerText({ timeout: 2_000 }).catch(() => "");
const barButton = (page: Page, label: string | RegExp) => page.locator(".ua-actionbar-buttons > button:enabled").filter({ hasText: label }).first();
async function clickBar(page: Page, label: string | RegExp): Promise<boolean> {
  const button = barButton(page, label);
  if (!(await button.count())) return false;
  await button.click();
  return true;
}
const dialog = (page: Page) => page.getByRole("dialog");
async function closeDialog(page: Page): Promise<void> {
  if (await dialog(page).isVisible().catch(() => false)) await page.keyboard.press("Escape");
}
/** A refused move shows a notice in the action bar: record it. */
async function notice(page: Page, watched: Watch): Promise<void> {
  const text = await page.locator(".ua-actionbar-notice").innerText({ timeout: 300 }).catch(() => "");
  if (text && !watched.problems.includes(`notice: ${text}`)) watched.problems.push(`notice: ${text}`);
}

/** Per-turn memory of the player driver: which hand cards and attackers it already tried this turn. */
interface Memory { handTries: number; attackTries: number; moved: boolean }

/**
 * One decision for the player on `page`, from what the page offers. Returns "over" when the game has ended, "acted" or "waiting".
 */
async function playStep(page: Page, memory: Memory, watched: Watch): Promise<"over" | "acted" | "waiting"> {
  const text = await prompt(page);
  if (text.startsWith("对局结束")) return "over";
  if (await dialog(page).isVisible().catch(() => false)) { await closeDialog(page); return "acted"; }
  // A new turn of ours starts at the start phase (which is left right away).
  if (text.startsWith("起始阶段")) Object.assign(memory, { handTries: 0, attackTries: 0, moved: false });

  if (await clickBar(page, "保留起手牌")) return "acted";
  if (await clickBar(page, "随机选择")) return "acted";
  if (await clickBar(page, /^发动$/)) return "acted";
  if (text.includes("没有触发") && await clickBar(page, /^确认$/)) return "acted";
  if (await clickBar(page, /^是$/)) return "acted";
  if (await clickBar(page, /^先结算/)) return "acted";
  if (await barButton(page, "确认保留").count() || text.startsWith("手牌超过")) {
    const hand = page.locator(".ua-handstrip button");
    for (let index = 0; index < 8; index += 1) await hand.nth(index).click();
    await clickBar(page, "确认保留");
    return "acted";
  }
  // A card choice: pick highlighted cards (or listed options) until the minimum is met, then confirm; "none" when allowed.
  if (await page.locator(".ua-actionbar-buttons > button", { hasText: /^确定$/ }).count()) {
    const confirm = page.locator(".ua-actionbar-buttons > button", { hasText: /^确定$/ });
    const candidates = page.locator("[data-candidate]:not([data-selected])");
    for (let guard = 0; guard < 6 && !(await confirm.isEnabled()) && (await candidates.count()); guard += 1) await candidates.first().click();
    if (!(await confirm.isEnabled())) {
      const options = page.locator(".ua-actionbar-buttons > button[aria-pressed='false']:enabled");
      for (let guard = 0; guard < 6 && !(await confirm.isEnabled()) && (await options.count()); guard += 1) await options.first().click();
    }
    if (await confirm.isEnabled()) await confirm.click();
    else if (!(await clickBar(page, "不选择"))) watched.problems.push(`stuck on a choice: ${text}`);
    return "acted";
  }
  if (await barButton(page, "不阻挡").count()) {
    const blockers = page.locator(".ua-half[data-side='self'] [data-candidate]");
    if ((await blockers.count()) && Math.random() < 0.5) await blockers.first().click();
    else await clickBar(page, "不阻挡");
    return "acted";
  }
  // Questions from the page itself (a Raid target, a full line, a trigger's target, a sideline card to put on the field).
  if (await page.locator("[data-candidate]").count()) {
    if (!text.startsWith("移动阶段")) { await page.locator("[data-candidate]").first().click(); return "acted"; }
  }
  if (text.startsWith("起始阶段")) { await clickBar(page, "进入移动阶段"); return "acted"; }
  if (text.startsWith("移动阶段") || text.startsWith("前线将超过") || text.startsWith("能量线将超过")) {
    const movable = page.locator(".ua-half[data-side='self'] .ua-z-energy [data-candidate]");
    if (!memory.moved && (await movable.count())) { memory.moved = true; await movable.first().click(); }
    if (await clickBar(page, /^确认移动/)) return "acted";
    await clickBar(page, "不移动，进入主要阶段");
    return "acted";
  }
  if (text.startsWith("主要阶段")) {
    const hand = page.locator(".ua-handstrip button");
    const count = await hand.count();
    if (memory.handTries < Math.min(count, 10)) {
      await hand.nth(memory.handTries % count).click();
      memory.handTries += 1;
      const box = dialog(page);
      const play = box.locator("button:enabled").filter({ hasText: /^(登场到前线|登场到能量线|使用事件)$/ });
      if (await play.count()) {
        // Energy first (cards need it), then the front line.
        const front = (await page.locator(".ua-half[data-side='self'] .ua-z-energy .ua-slot-button").count()) >= 3;
        const preferred = box.locator("button:enabled", { hasText: front ? "登场到前线" : "登场到能量线" });
        await ((await preferred.count()) ? preferred : play).first().click();
        // A full line asks which card to give up.
        if (await page.locator("[data-candidate]").count()) await page.locator("[data-candidate]").first().click();
        await notice(page, watched);
      } else await closeDialog(page);
      return "acted";
    }
    await clickBar(page, "进入攻击阶段");
    return "acted";
  }
  if (text.startsWith("攻击阶段")) {
    const attackers = page.locator(".ua-half[data-side='self'] .ua-z-front .ua-slot-button");
    const count = await attackers.count();
    while (memory.attackTries < count) {
      await attackers.nth(memory.attackTries).click();
      memory.attackTries += 1;
      const attack = dialog(page).locator("button:enabled", { hasText: /^攻击 / });
      if (await attack.count()) { await attack.first().click(); await notice(page, watched); return "acted"; }
      await closeDialog(page);
    }
    await clickBar(page, "结束回合");
    return "acted";
  }
  // Any other question the page asks (e.g. a 【突进】 trigger: add to the hand or Raid): take the first answer offered.
  const answers = page.locator(".ua-actionbar-buttons > button:enabled").filter({ hasNotText: /^取消$/ });
  if (await answers.count()) { await answers.first().click(); return "acted"; }
  return "waiting";
}

/** Plays every listed page until each one's game is over (or `stop` says to stop playing). */
async function playToEnd(pages: Array<{ page: Page; watched: Watch }>, limitMs: number, stop?: () => Promise<boolean>): Promise<void> {
  const memories = pages.map((): Memory => ({ handTries: 0, attackTries: 0, moved: false }));
  const started = Date.now();
  let sawRing = false;
  let lastChange = Date.now();
  let lastState = "";
  for (;;) {
    let over = 0;
    for (const [index, { page, watched }] of pages.entries()) {
      // A click that loses its target while the page updates is just tried again on the next round.
      const result = await playStep(page, memories[index]!, watched).catch((error: Error) => {
        if (/Target page|Test ended/.test(error.message)) throw error;
        return "acted" as const;
      });
      if (result === "over") over += 1;
      if (result !== "acted") await page.waitForTimeout(150);
      if (!sawRing && (await page.locator(".ua-winring").count())) sawRing = true;
    }
    if (over === pages.length || (stop && await stop())) break;
    const state = (await Promise.all(pages.map(({ page }) => prompt(page)))).join("|") + (await Promise.all(pages.map(({ page }) => page.locator(".ua-handstrip button").count()))).join(",");
    if (state !== lastState) { lastState = state; lastChange = Date.now(); }
    if (Date.now() - lastChange > 45_000) {
      for (const [index, { page }] of pages.entries()) await shot(page, `stuck-${index}`);
      throw new Error(`no progress for 45s: ${state}`);
    }
    if (Date.now() - started > limitMs) throw new Error("game did not finish in time");
  }
  expect(sawRing, "the win-rate ring was shown during the game").toBe(true);
}

/** Follows the tutorial's coach text through every step. */
async function playTutorial(page: Page, watched: Watch): Promise<void> {
  const coach = page.locator(".ua-coach-text");
  const progress = page.locator(".ua-coach-progress");
  let lastStep = "";
  let sameStepTries = 0;
  for (let guard = 0; guard < 600; guard += 1) {
    const text = await coach.innerText();
    if (text.startsWith("恭喜")) return;
    const step = await progress.innerText();
    if (step === lastStep) sameStepTries += 1; else { lastStep = step; sameStepTries = 0; }
    if (sameStepTries > 40) { await shot(page, "tutorial-stuck"); throw new Error(`tutorial stuck at ${step}: ${text}`); }
    if (await page.getByRole("button", { name: "下一步" }).isVisible().catch(() => false)) { await page.getByRole("button", { name: "下一步" }).click(); continue; }
    const names = [...text.matchAll(/『([^』]+)』/g)].map((match) => match[1]!);
    const bar = await prompt(page);
    if (bar.startsWith("对局结束")) { await page.waitForTimeout(200); continue; }
    if (await dialog(page).isVisible().catch(() => false)) { await closeDialog(page); continue; }
    // A button the coach names.
    let clicked = false;
    for (const name of names) {
      if (["否", "是", "发动", "不阻挡", "确认", "随机选择", "保留起手牌", "进入移动阶段", "不移动，进入主要阶段", "进入攻击阶段", "结束回合", "额外抽卡（1 AP）", "移动至前线"].includes(name) && await clickBar(page, name)) { clicked = true; break; }
    }
    if (clicked) continue;
    if (await clickBar(page, "随机选择")) continue;
    if (await clickBar(page, /^是$/) || await clickBar(page, /^发动$/)) continue;
    if (bar.includes("突进后") && await clickBar(page, "移动至前线")) continue;
    // A highlighted card the coach names (a block, a move, a trigger or ability target, a Raid target), else any highlighted card.
    const highlighted = page.locator("[data-candidate]:not([data-selected])");
    if (await highlighted.count()) {
      let picked = false;
      for (const name of names) {
        const match = page.locator(`[data-candidate]:not([data-selected])[aria-label^="${name}"]`);
        if (await match.count()) { await match.first().click(); picked = true; break; }
      }
      if (!picked && !text.includes("不阻挡")) await highlighted.first().click();
      if (await clickBar(page, /^确认移动/) || await clickBar(page, /^确定$/)) continue;
      if (picked) continue;
    }
    if (text.includes("不阻挡") && await clickBar(page, "不阻挡")) continue;
    // Playing a named hand card: try each hand card with that name until the step moves on.
    if (/登场到|使用事件|突进…/.test(text) && !(await page.locator("[data-candidate]").count())) {
      const wanted = text.includes("使用事件") ? "使用事件" : text.includes("突进…") ? "突进…" : text.includes("登场到前线") ? "登场到前线" : "登场到能量线";
      let done = false;
      for (const name of names) {
        const cards = page.locator(`.ua-handstrip button[aria-label$="：${name}"]`);
        for (let index = 0; index < (await cards.count()) && !done; index += 1) {
          await cards.nth(index).click();
          const button = dialog(page).locator("button:enabled", { hasText: wanted });
          if (await button.count()) { await button.first().click(); done = true; } else await closeDialog(page);
        }
        if (done) break;
      }
      if (done) continue;
    }
    // Attacking with a named front-line character (or any).
    if (bar.startsWith("攻击阶段") && /攻击/.test(text)) {
      const front = page.locator(".ua-half[data-side='self'] .ua-z-front .ua-slot-button");
      let attacked = false;
      for (const name of [...names, ""]) {
        const cards = name ? page.locator(`.ua-half[data-side='self'] .ua-z-front .ua-slot-button[aria-label^="${name}"]`) : front;
        for (let index = 0; index < (await cards.count()) && !attacked; index += 1) {
          await cards.nth(index).click();
          const attack = dialog(page).locator("button:enabled", { hasText: /^攻击 / });
          if (await attack.count()) { await attack.first().click(); attacked = true; } else await closeDialog(page);
        }
        if (attacked) break;
      }
      if (attacked) continue;
    }
    await notice(page, watched);
    await page.waitForTimeout(250);
  }
  throw new Error("tutorial did not finish");
}

async function newWindow(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(5_000);
  return context.newPage();
}

/** The turn number shown in the page header ("第 N 回合"). */
const turnOf = (page: Page): Promise<number> => page.evaluate(() => Number(document.body.innerText.match(/第 (\d+) 回合/)?.[1] ?? 0));

/** Concedes from the 效果 menu (confirming the browser's question) unless the game is already over. */
async function concede(page: Page): Promise<void> {
  await closeDialog(page);
  if ((await prompt(page)).startsWith("对局结束")) return;
  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.locator(".ua-effects summary").click();
  await page.getByRole("button", { name: "认输" }).click();
}

test("Arknights in Edge: lobby, tutorial, vs computer and Players vs Players, each to the end", async ({ browser }) => {
  const page = await newWindow(browser);
  const watched = watch(page, "A");
  const nameA = await register(page, "edgea");

  // Lobby.
  await page.goto("/arknights-union-arena/");
  const modes = page.getByRole("main", { name: "选择游戏模式" });
  await expect(modes.getByRole("heading", { name: "玩家对战" })).toBeVisible();
  await expect(modes.getByRole("heading", { name: "人机对战" })).toBeVisible();
  await shot(page, "01-lobby");

  // Tutorial, every step.
  await modes.getByRole("button", { name: "开始教程" }).click();
  await page.waitForURL("**/arknights-union-arena/tutorial");
  for (let step = 0; step < 7; step += 1) await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "保留起手牌" }).click();
  await playTutorial(page, watched);
  await expect(page.locator(".ua-actionbar-prompt")).toContainText("你获胜了");
  await shot(page, "02-tutorial-done");

  // Vs computer (normal), to the end.
  await page.goto("/arknights-union-arena/ai");
  await page.getByRole("button", { name: "开始对战" }).click();
  await playToEnd([{ page, watched }], 8 * 60_000, async () => (await turnOf(page)) >= 12);
  await concede(page);
  await expect(page.locator(".ua-actionbar-prompt")).toContainText("对局结束");
  await shot(page, "03-vs-ai-over");
  await expect(page.getByRole("button", { name: "再来一局" })).toBeVisible();

  // Players vs Players between two Edge windows.
  const other = await newWindow(browser);
  const watchedB = watch(other, "B");
  const nameB = await register(other, "edgeb");
  for (const [who, name] of [[page, nameA], [other, nameB]] as const) {
    await who.goto("/arknights-union-arena/pvp");
    await expect(who.locator(".ua-account")).toContainText(name);
  }
  await page.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
  await page.getByRole("button", { name: "创建对战房间" }).click();
  const code = (await page.locator(".ua-roominfo-main strong").innerText()).trim();
  await other.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
  await other.locator("#ua-room-code").fill(code);
  await other.getByRole("button", { name: "加入房间" }).click();
  for (const who of [page, other]) {
    if (!(await who.getByRole("button", { name: "快速组牌" }).isVisible().catch(() => false))) await who.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
    await who.getByRole("button", { name: "快速组牌" }).click();
    await who.getByRole("button", { name: "提交牌组" }).click();
    await expect(who.locator(".ua-deck-ok")).toBeVisible();
    await who.getByRole("button", { name: "准备", exact: true }).click();
  }
  await page.getByRole("button", { name: "开始游戏" }).click();
  for (const who of [page, other]) {
    const close = who.locator(".ua-panel").getByRole("button", { name: /^(关闭|关闭工具面板|收起侧栏)$/ });
    if (await close.first().isVisible().catch(() => false)) await close.first().click();
    await expect(who.locator(".ua-panel")).toBeHidden();
  }
  await shot(page, "04-pvp-start-a");
  // Play until turn 8 (or an earlier end), then A concedes from the 效果 menu.
  await playToEnd([{ page, watched }, { page: other, watched: watchedB }], 15 * 60_000, async () => (await turnOf(page)) >= 8);
  await shot(page, "05-pvp-turn8-a");
  await shot(other, "05-pvp-turn8-b");
  await concede(page);
  await expect(page.locator(".ua-actionbar-prompt")).toContainText("对局结束");
  await expect(other.locator(".ua-actionbar-prompt")).toContainText("对局结束");
  await shot(page, "06-pvp-over-a");
  await shot(other, "06-pvp-over-b");
  await page.getByRole("button", { name: "返回房间（保留牌组）" }).click();
  await expect(page.locator(".ua-roominfo-main")).toContainText(code);

  const problems = [...watched.problems, ...watchedB.problems.map((problem) => `B ${problem}`)];
  console.log(problems.length ? `problems:\n${problems.join("\n")}` : "no problems");
  // Refused moves of the simple players are fine; the site has never had a favicon, so the browser's own request for it 404s.
  expect(problems.filter((problem) => !/^(B )?notice:/.test(problem) && !problem.includes("/favicon.ico"))).toEqual([]);
});
