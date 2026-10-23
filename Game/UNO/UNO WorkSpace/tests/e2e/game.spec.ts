import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function newPage(
  browser: Browser,
  width: number,
  height: number,
  mobile = false
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile
  });
  const page = await context.newPage();
  return {
    page,
    close: () => context.close()
  };
}

async function waitForGame(page: Page): Promise<void> {
  await expect(page.locator(".hand")).toBeVisible();
  await expect(page.locator(".turn-order-strip")).toBeVisible();
}

async function handIds(page: Page): Promise<string[]> {
  return page
    .locator(".hand [data-card-id]")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-card-id") ?? "")
    );
}

async function currentPlayerName(page: Page): Promise<string> {
  if ((await page.locator(".self-heading .active-tag").count()) > 0) {
    return page.locator("#your-hand-heading").innerText();
  }
  return page.locator(".table-seat.is-current .seat-name").innerText();
}

async function registerAccount(
  page: Page,
  username: string,
  path = "/uno"
): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-email").fill(`${username}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  if (path.startsWith("/room/")) {
    await expect(page.getByText("准备与开局")).toBeVisible();
    return;
  }
  await expect(page.locator(".lobby-shell")).toBeVisible();
  await page.getByRole("region", { name: "UNO" }).getByRole("button", { name: "进入游戏", exact: true }).click();
  await page.waitForURL(/\/uno$/);
  await expect(page.getByRole("heading", { name: "UNO", level: 1 })).toBeVisible();
}

test("lobby separates game entry from room controls and opens the profile flow", async ({
  page
}) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
    .toString(36)
    .slice(2, 4)}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "LayUDown", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("LayUDown");
  await expect(page.getByRole("region", { name: "UNO" })).toBeVisible();
  await expect(page.getByRole("region", { name: "日本将棋" })).toBeVisible();
  await expect(page.getByRole("link", { name: "我的" })).toBeVisible();
  await expect(page.locator(".profile-summary")).toHaveCount(0);
  await expect(page.getByText("在线联机卡牌游戏", { exact: true })).toHaveCount(0);
  await page.goto("/uno");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(`lobby_${suffix}`);
  await page.locator("#auth-email").fill(`lobby_${suffix}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await expect(page.locator(".lobby-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "LayUDown", level: 1 })).toBeVisible();
  await expect(page.locator("#uno-feature-title")).toHaveText("UNO");
  await expect(page.getByText("在线联机卡牌游戏", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "连接主机" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "创建房间" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加入房间" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "日本将棋" })).toBeVisible();
  await expect(page.getByRole("region", { name: "日本将棋" }).locator(".shogi-cover-board span")).toHaveCount(81);
  const shogiCardLayout = await page.getByRole("region", { name: "日本将棋" }).evaluate((card) => {
    const cover = card.querySelector(".shogi-cover")?.getBoundingClientRect();
    const details = card.querySelector(".uno-feature-details")?.getBoundingClientRect();
    return !!cover && !!details && cover.width > 300 && cover.bottom <= details.top;
  });
  expect(shogiCardLayout).toBe(true);
  await expect.poll(async () => page.getByRole("region", { name: "日本将棋" }).locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator(".profile-summary")).toHaveCount(0);
  await expect(page.locator(".lobby-header .my-link")).toBeVisible();
  await page.screenshot({ path: "test-results/ui/lobby-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("region", { name: "日本将棋" })).toBeVisible();
  const narrowShogiLayout = await page.getByRole("region", { name: "日本将棋" }).evaluate((card) => {
    const cover = card.querySelector(".shogi-cover")?.getBoundingClientRect();
    const details = card.querySelector(".uno-feature-details")?.getBoundingClientRect();
    return !!cover && !!details && cover.width > 300 && cover.bottom <= details.top;
  });
  expect(narrowShogiLayout).toBe(true);
  await page.screenshot({ path: "test-results/ui/lobby-mobile.png", fullPage: true });

  await page.locator(".lobby-header .my-link").click();
  await page.waitForURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "我的" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".donation-disclosure > summary")).toHaveText("向开发商赞助");
  await expect(page.getByText("向我投喂")).toHaveCount(0);
  // Sponsorship sits below logout / delete-account.
  const actionsBottom = await page.locator(".about-account-actions").evaluate((el) => el.getBoundingClientRect().bottom);
  const sponsorTop = await page.locator(".donation-disclosure").evaluate((el) => el.getBoundingClientRect().top);
  expect(sponsorTop).toBeGreaterThanOrEqual(actionsBottom);
  await expect(page.locator(".donation-disclosure")).not.toHaveAttribute("open", "");
  await page.locator(".donation-disclosure > summary").click();
  await expect(page.locator(".donation-disclosure")).toHaveAttribute("open", "");
  await expect(page.getByRole("img", { name: "微信支付收款码" })).toBeVisible();
  await expect(page.getByRole("img", { name: "支付宝收款码" })).toHaveAttribute(
    "src",
    "/assets/support/alipay.jpg"
  );
  const donationOrder = await page.locator(".donation-method img").evaluateAll((images) =>
    images.map((image) => image.getBoundingClientRect().top)
  );
  expect(donationOrder[0]).toBeLessThan(donationOrder[1]!);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/ui/about-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "返回大厅" }).click();

  await page.getByRole("region", { name: "UNO" }).getByRole("button", { name: "进入游戏", exact: true }).click();
  await page.waitForURL(/\/uno$/);
  await expect(page.getByRole("heading", { name: "UNO", level: 1 })).toBeVisible();
  await expect(page.locator(".connect-host > summary")).toBeVisible();
  await expect(page.locator(".connect-host input")).toHaveCount(1);
  await expect(page.getByLabel("主机 IP 或地址")).toBeVisible();
  await expect(page.locator(".connect-host")).not.toContainText("房间号（可选）");
  await expect(page.getByText("这里只查询当前所在主机", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "创建房间" })).toBeVisible();
  await expect(page.getByRole("button", { name: "加入房间" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "加入房间" })).toBeVisible();
});

test("online shogi route keeps the website title and fits desktop and mobile orientations", async ({ page }) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
  await registerAccount(page, `shogi_${suffix}`);
  await page.goto("/shogi");
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".shogi-waiting-panel")).toContainText("等待玩家加入房间");
  await expect(page.getByRole("button", { name: "退出房间" })).toBeVisible();
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 540, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/shogi");
    await expect(page).toHaveTitle("LayUDown");
    await expect(page.getByRole("heading", { name: "日本将棋" })).toBeVisible();
    await expect(page.locator(".shogi-waiting-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "退出房间" })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const board = document.querySelector(".shogi-board-wrap")?.getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, height: window.innerHeight, board };
    });
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.board).toBeFalsy();
  }
});

test("Arknights uses the dedicated battle map, shared account and authoritative room seats", async ({ page }) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
  const username = `ark_${suffix}`;
  await page.goto("/uno");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-email").fill(`${username}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await page.waitForURL("/");
  await page.goto("/arknights-union-arena/");
  // The game lobby comes first: player vs. player and the tutorial are open, vs. computer is listed but closed.
  const modes = page.getByRole("main", { name: "选择游戏模式" });
  await expect(modes.getByRole("heading", { name: "玩家对战" })).toBeVisible();
  await expect(modes.getByRole("heading", { name: /人机对战/ })).toBeVisible();
  await expect(modes.locator("[data-mode='ai'] button")).toBeDisabled();
  await expect(modes.getByRole("button", { name: "开始教程" })).toBeEnabled();
  await modes.locator("[data-mode='pvp'] button").click();
  await page.waitForURL("**/arknights-union-arena/pvp");
  await expect(page.getByRole("button", { name: "返回大厅" })).toBeVisible();
  await expect(page.locator(".ua-account")).toContainText(username);
  await expect(page.locator(".ua-catalog-heading")).toContainText("254 / 254");
  // The tools panel starts closed on every screen size so the table owns the whole window.
  await expect(page.locator(".ua-panel")).toBeHidden();
  await page.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
  await page.getByRole("button", { name: "创建对战房间" }).click();
  await expect(page.locator(".ua-panel")).toBeHidden();
  await expect(page.locator(".ua-seat-self")).toContainText(username);
  await expect(page.getByText("待玩家加入")).toBeVisible();
  await page.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
  await expect(page.locator(".ua-status strong")).toHaveText("1/2");
  await expect(page.getByRole("button", { name: "准备" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "开始游戏" })).toBeDisabled();
  await page.locator(".ua-card-row").first().click();
  await expect(page.locator(".ua-card-preview")).toBeVisible();
  // Card lightbox: opens from the preview button, Esc / X / the dim backdrop close it, focus goes back to the preview button and the panel stays open.
  const zoomButton = page.locator(".ua-card-zoom");
  await expect(zoomButton).toHaveAttribute("aria-label", /^放大查看 /);
  for (const how of ["escape", "close-button", "backdrop"] as const) {
    await zoomButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("button", { name: "关闭放大查看" })).toBeFocused();
    const card = (await page.locator(".ua-lb-card").boundingBox())!;
    expect(Math.abs(card.width / card.height - 600 / 838)).toBeLessThan(0.01);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    if (how === "escape") await page.keyboard.press("Escape");
    else if (how === "close-button") await page.getByRole("button", { name: "关闭放大查看" }).click();
    else await page.mouse.click(3, 300);
    await expect(dialog).toBeHidden();
    await expect(zoomButton).toBeFocused();
    await expect(page.locator(".ua-panel")).toBeVisible();
  }
  await page.locator(".ua-panel-close").click();
  expect((await page.request.get("/assets/arknights/battle-map.png")).status()).toBe(200);
  expect((await page.request.get("/assets/arknights/Map.png")).status()).toBe(404);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    // The page never scrolls, and the table fills the whole stage under the header.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
    const stage = (await page.locator(".ua-stage").boundingBox())!;
    const table = (await page.locator(".ua-table").boundingBox())!;
    expect(table.width).toBeGreaterThanOrEqual(stage.width - 2);
    expect(table.height).toBeGreaterThanOrEqual(stage.height - 2);
    expect(stage.width).toBeGreaterThanOrEqual(viewport.width - 16);
    // Joining players sit in bars above and below the board, never at its left/right sides.
    const opponentSeat = (await page.locator(".ua-seatbar[data-side='opponent'] .ua-seat").boundingBox())!;
    const selfSeat = (await page.locator(".ua-seatbar[data-side='self'] .ua-seat").boundingBox())!;
    const opponentHalf = (await page.locator(".ua-half[data-side='opponent']").boundingBox())!;
    const selfHalf = (await page.locator(".ua-half[data-side='self']").boundingBox())!;
    expect(opponentSeat.y + opponentSeat.height).toBeLessThanOrEqual(opponentHalf.y + 1);
    expect(selfSeat.y).toBeGreaterThanOrEqual(selfHalf.y + selfHalf.height - 1);
    // Cards stay big enough to read: every front-line slot is at least 28px wide.
    const slotWidths = await page.locator(".ua-z-front .ua-slot").evaluateAll((slots) => slots.map((slot) => slot.getBoundingClientRect().width));
    expect(Math.min(...slotWidths)).toBeGreaterThanOrEqual(28);
    const compact = viewport.width <= 900 || viewport.height <= 520;
    const open = page.getByRole("button", { name: compact ? "打开工具面板" : "展开侧栏" });
    await open.click();
    await expect(page.locator(".ua-panel")).toBeVisible();
    // Opening the panel overlays the table: the table itself must not move or resize.
    const tableWhileOpen = (await page.locator(".ua-table").boundingBox())!;
    expect(tableWhileOpen).toEqual(table);
    await expect(page.locator(".ua-card-preview")).toBeVisible();
    await (compact ? page.getByRole("button", { name: "关闭工具面板" }) : page.getByRole("button", { name: "收起侧栏" })).click();
    await expect(page.locator(".ua-panel")).toBeHidden();
    expect((await page.locator(".ua-table").boundingBox())!).toEqual(table);
  }
});

test("Arknights tutorial: fixed cards, step-by-step guidance, and a card lightbox that browses the hand", async ({ page }) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
  const username = `tut_${suffix}`;
  await page.goto("/uno");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-email").fill(`${username}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await page.waitForURL("/");
  await page.goto("/arknights-union-arena/");
  await page.getByRole("button", { name: "开始教程" }).click();
  await page.waitForURL("**/arknights-union-arena/tutorial");
  await expect(page.locator(".ua-seatbar[data-side='opponent']")).toContainText("test");
  // The introduction, then the mulligan: only "keep" moves on.
  for (let step = 0; step < 7; step += 1) await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "保留起手牌" }).click();
  await expect(page.locator(".ua-half[data-side='self'] .ua-life-card")).toHaveCount(7);
  // The tutorial always deals the same hand.
  await expect(page.locator(".ua-handstrip button").first()).toHaveAttribute("aria-label", "手牌 1：陈");
  await page.getByRole("button", { name: "进入移动阶段" }).click();
  await page.getByRole("button", { name: "不移动，进入主要阶段" }).click();
  // Lightbox: "<" and ">" browse the hand in order, wrapping around.
  await page.locator(".ua-handstrip button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".ua-lb-position")).toHaveText("手牌 1 / 7");
  await dialog.getByRole("button", { name: "下一张" }).click();
  await expect(dialog.locator(".ua-lb-position")).toHaveText("手牌 2 / 7");
  await dialog.getByRole("button", { name: "上一张" }).click();
  await dialog.getByRole("button", { name: "上一张" }).click();
  await expect(dialog.locator(".ua-lb-position")).toHaveText("手牌 7 / 7");
  await dialog.getByRole("button", { name: "下一张" }).click();
  // A move the step does not ask for is refused with a hint; the asked one plays the card.
  await dialog.getByRole("button", { name: "登场到前线" }).click();
  await expect(page.locator(".ua-actionbar-notice")).toContainText("教程中请按照上方提示操作");
  await page.locator(".ua-handstrip button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "登场到能量线" }).click();
  await expect(page.locator(".ua-half[data-side='self'] .ua-z-energy .ua-slot-button")).toHaveCount(1);
  await expect(page.locator(".ua-coach-text")).toContainText("AP 用完了");
});

test("two verified accounts see opposite piece directions and synchronize an online move", async ({ browser }) => {
  const suffix = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`;
  const host = await newPage(browser, 1280, 900);
  const guest = await newPage(browser, 390, 844, true);
  try {
    await registerAccount(host.page, `shogih_${suffix}`);
    await host.page.goto("/shogi");
    await host.page.getByRole("button", { name: "创建房间" }).click();
    const code = await host.page.locator(".shogi-room-identity strong").innerText();
    await expect(host.page.locator(".shogi-waiting-panel")).toContainText("等待玩家加入房间");

    await registerAccount(guest.page, `shogig_${suffix}`);
    await guest.page.goto(`/shogi?room=${code}`);
    await expect(guest.page.getByRole("button", { name: "准备" })).toBeVisible();
    await expect(guest.page.locator(".shogi-room-identity strong")).toHaveText(code);
    await expect(host.page.getByRole("button", { name: "开始游戏" })).toBeDisabled();
    await guest.page.getByRole("button", { name: "准备" }).click();
    await expect(host.page.getByRole("button", { name: "开始游戏" })).toBeEnabled();
    await host.page.getByRole("button", { name: "开始游戏" }).click();
    await expect(host.page.getByRole("grid", { name: "9乘9日本将棋棋盘" })).toBeVisible();
    await expect(guest.page.getByRole("grid", { name: "9乘9日本将棋棋盘" })).toBeVisible();
    await expect(host.page.locator(".shogi-room-identity strong")).toHaveCount(0);
    await expect(host.page.getByRole("button", { name: "退出房间" })).toBeVisible();
    await host.page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const activeTurnColors = await host.page.locator(".shogi-active-bar").evaluate((bar) => {
      const background = getComputedStyle(bar).backgroundColor;
      const foreground = getComputedStyle(bar.querySelector("strong")!).color;
      const button = getComputedStyle(bar.querySelector("button")!).color;
      return { background, foreground, button };
    });
    expect(activeTurnColors.background).toBe("rgb(232, 245, 236)");
    expect(activeTurnColors.foreground).toBe("rgb(23, 90, 50)");
    expect(activeTurnColors.button).toBe("rgb(32, 37, 43)");

    const hostDirections = await host.page.locator(".shogi-board .shogi-piece").evaluateAll((pieces) => pieces.map((piece) => [piece.getAttribute("data-piece-side"), piece.getAttribute("data-facing"), getComputedStyle(piece).transform]));
    const guestDirections = await guest.page.locator(".shogi-board .shogi-piece").evaluateAll((pieces) => pieces.map((piece) => [piece.getAttribute("data-piece-side"), piece.getAttribute("data-facing"), getComputedStyle(piece).transform]));
    expect(hostDirections).toHaveLength(40);
    expect(guestDirections).toHaveLength(40);
    expect(hostDirections.filter(([side, facing]) => side === "sente" && facing === "own")).toHaveLength(20);
    expect(hostDirections.filter(([side, facing]) => side === "gote" && facing === "opponent")).toHaveLength(20);
    expect(guestDirections.filter(([side, facing]) => side === "gote" && facing === "own")).toHaveLength(20);
    expect(guestDirections.filter(([side, facing]) => side === "sente" && facing === "opponent")).toHaveLength(20);
    expect(hostDirections.every(([, , transform]) => transform === "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);
    expect(guestDirections.every(([, , transform]) => transform === "matrix(-1, 0, 0, -1, 0, 0)")).toBe(true);
    const hostBoardEnds = await host.page.locator(".shogi-board .shogi-square").evaluateAll((squares) => [squares[0]?.getAttribute("data-board-row"), squares.at(-1)?.getAttribute("data-board-row")]);
    const guestBoardEnds = await guest.page.locator(".shogi-board .shogi-square").evaluateAll((squares) => [squares[0]?.getAttribute("data-board-row"), squares.at(-1)?.getAttribute("data-board-row")]);
    expect(hostBoardEnds).toEqual(["0", "8"]);
    expect(guestBoardEnds).toEqual(["8", "0"]);

    await host.page.locator(".shogi-board .shogi-square").nth(6 * 9 + 4).click();
    await host.page.locator(".shogi-board .shogi-square").nth(5 * 9 + 4).click();
    await expect(host.page.locator(".shogi-active-bar")).toContainText(`轮到对手行棋 · shogig_${suffix}`);
    await expect(guest.page.locator(".shogi-active-bar")).toContainText(`轮到你行棋 · shogig_${suffix}`);

    await guest.page.locator(".shogi-board .shogi-square").nth(6 * 9 + 4).click();
    await guest.page.locator(".shogi-board .shogi-square").nth(5 * 9 + 4).click();
    await host.page.locator(".shogi-board .shogi-square").nth(5 * 9 + 4).click();
    await host.page.locator(".shogi-board .shogi-square").nth(4 * 9 + 4).click();
    await guest.page.locator(".shogi-board .shogi-square").nth(5 * 9 + 4).click();
    await guest.page.locator(".shogi-board .shogi-square").nth(4 * 9 + 4).click();
    await expect(guest.page.locator(".shogi-hand-piece .shogi-piece")).toHaveCount(1);

    await guest.page.setViewportSize({ width: 844, height: 390 });
    const landscapeLayout = await guest.page.evaluate(() => {
      const board = document.querySelector(".shogi-board-wrap")!.getBoundingClientRect();
      const opponentHand = document.querySelector(".shogi-hand-sente")!.getBoundingClientRect();
      const ownHand = document.querySelector(".shogi-hand-gote")!.getBoundingClientRect();
      const handPieces = document.querySelector(".shogi-hand-pieces")!;
      return { board, opponentHand, ownHand, handDirection: getComputedStyle(handPieces).flexDirection, viewportHeight: window.innerHeight };
    });
    expect(landscapeLayout.board.width).toBeGreaterThan(220);
    expect(landscapeLayout.board.width).toBeLessThanOrEqual(512);
    expect(landscapeLayout.board.bottom).toBeLessThanOrEqual(landscapeLayout.viewportHeight);
    expect(landscapeLayout.opponentHand.right).toBeLessThan(landscapeLayout.board.left);
    expect(landscapeLayout.ownHand.left).toBeGreaterThan(landscapeLayout.board.right);
    expect(landscapeLayout.handDirection).toBe("column");
    const handFacing = await guest.page.locator(".shogi-hand-piece .shogi-piece").evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute("data-facing")));
    expect(handFacing).toHaveLength(1);
    expect(handFacing.every((facing) => facing === "own")).toBe(true);

    host.page.once("dialog", (dialog) => dialog.accept());
    await host.page.getByRole("button", { name: "退出房间" }).click();
    await expect(guest.page.locator(".shogi-active-bar")).toContainText("后手获胜");
  } finally {
    await host.close();
    await guest.close();
  }
});

async function expectTableGeometry(
  page: Page,
  opponentCount: number
): Promise<void> {
  await expect(page.locator(".table-seat")).toHaveCount(opponentCount);
  const geometry = await page.evaluate(() => {
    const surface = document.querySelector(".table-surface")?.getBoundingClientRect();
    const publicTable = document
      .querySelector(".public-table")
      ?.getBoundingClientRect();
    const handDock = document.querySelector(".hand-dock")?.getBoundingClientRect();
    const seats = [...document.querySelectorAll(".table-seat")].map((seat) => {
      const box = seat.getBoundingClientRect();
      return {
        slot: seat.getAttribute("data-seat-slot") ?? "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom
      };
    });
    const overlaps = (
      first: { left: number; right: number; top: number; bottom: number },
      second: { left: number; right: number; top: number; bottom: number }
    ): boolean =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top;
    const seatOverlaps: string[] = [];
    for (let index = 0; index < seats.length; index += 1) {
      for (let inner = index + 1; inner < seats.length; inner += 1) {
        if (overlaps(seats[index]!, seats[inner]!)) {
          seatOverlaps.push(
            `${seats[index]!.slot}:${seats[inner]!.slot}`
          );
        }
      }
    }
    return {
      slots: seats.map((seat) => seat.slot),
      outsideSurface: surface
        ? seats
            .filter(
              (seat) =>
                seat.left < surface.left - 1 ||
                seat.right > surface.right + 1 ||
                seat.top < surface.top - 1 ||
                seat.bottom > surface.bottom + 1
            )
            .map((seat) => seat.slot)
        : ["missing-surface"],
      publicOverlaps:
        publicTable && seats.some((seat) => overlaps(seat, publicTable))
          ? ["public-table"]
          : [],
      seatOverlaps,
      handBelowTable:
        surface && handDock ? handDock.top >= surface.bottom - 1 : false,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });
  expect(new Set(geometry.slots).size).toBe(opponentCount);
  expect(geometry.outsideSurface).toEqual([]);
  expect(geometry.publicOverlaps).toEqual([]);
  expect(geometry.seatOverlaps).toEqual([]);
  expect(geometry.handBelowTable).toBe(true);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentHeight).toBeLessThanOrEqual(
    geometry.viewportHeight + 1
  );
}

async function autoPlayUntilFinished(pages: Page[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (
      (await pages[0]!.locator("#end-heading").count()) > 0 ||
      (await pages[1]!.locator("#end-heading").count()) > 0
    ) {
      return;
    }

    let acted = false;
    for (const page of pages) {
      const accept = page.getByRole("button", {
        name: /^接受摸 \d+ 张$/
      });
      if ((await accept.count()) > 0 && (await accept.isEnabled())) {
        await accept.click();
        acted = true;
        break;
      }

      const uno = page.getByRole("button", { name: "宣告 UNO", exact: true });
      if ((await uno.count()) > 0 && (await uno.isEnabled())) {
        await uno.click();
        acted = true;
        break;
      }

      const turnText = await page.locator(".turn-order-copy").innerText();
      if (!turnText.includes("轮到你")) {
        continue;
      }

      const playable = page.locator(
        '.hand button.playing-card[data-playable="true"]'
      );
      if ((await playable.count()) > 0) {
        await playable.first().click();
        const confirm = page.locator('[data-action="confirm-play"]');
        await expect(confirm).toBeEnabled();
        await confirm.click();
        const colorChoice = page.locator(".color-choice").first();
        if ((await colorChoice.count()) > 0) {
          await colorChoice.click();
        }
        acted = true;
        break;
      }

      const endTurn = page.getByRole("button", {
        name: "结束回合",
        exact: true
      });
      if ((await endTurn.count()) > 0 && (await endTurn.isEnabled())) {
        await endTurn.click();
        acted = true;
        break;
      }

      const draw = page.locator(".draw-pile");
      if ((await draw.count()) > 0 && (await draw.isEnabled())) {
        await draw.click();
        acted = true;
        break;
      }
    }
    await pages[0]!.waitForTimeout(acted ? 45 : 80);
  }
  throw new Error("UI game did not finish in time");
}

test("two independent browser contexts can complete a real online game and reconnect", async ({
  browser
}) => {
  const host = await newPage(browser, 1440, 1000);
  const guest = await newPage(browser, 390, 844, true);
  const errors: string[] = [];
  for (const [label, page] of [
    ["host", host.page],
    ["guest", guest.page]
  ] as const) {
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`${label} console: ${message.text()}`);
      }
    });
  }

  try {
    mkdirSync("test-results/ui", { recursive: true });
    const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    const hostName = `host_${suffix}`;
    const guestName = `guest_${suffix}`;
    await registerAccount(host.page, hostName);
    await host.page.getByRole("button", { name: "创建房间", exact: true }).click();
    await host.page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
    const roomCode = host.page.url().split("/").pop()!;
    await expect(host.page.locator(".lan-panel .warn-tag")).toHaveText("已关闭");
    await expect(host.page.locator(".lan-primary")).toHaveCount(0);
    await host.page
      .getByRole("button", { name: "开放局域网访问", exact: true })
      .click();
    await expect(host.page.locator(".lan-panel .lan-open-tag")).toHaveText(
      "已开放"
    );
    await expect(host.page.locator(".lan-primary")).toBeVisible();
    await expect(host.page.locator(".lan-address-list")).toBeHidden();
    await expect(
      host.page.getByText("当前只有运行服务器的本机可以通过 localhost 访问")
    ).toHaveCount(0);
    await host.page.locator(".lan-more summary").click();
    await expect(host.page.locator(".lan-address-list")).toBeVisible();

    await registerAccount(guest.page, guestName, `/room/${roomCode}`);
    await expect(guest.page.getByText("准备与开局")).toBeVisible();
    await guest.page.getByRole("button", { name: "准备", exact: true }).click();
    await host.page.screenshot({
      path: "test-results/ui/room-waiting.png",
      fullPage: true
    });

    const start = host.page.getByRole("button", {
      name: "开始游戏",
      exact: true
    });
    await expect(start).toBeEnabled();
    await start.click();
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);
    await expect(host.page.locator(".version-badge")).toHaveText("v2.3.0");
    await expect.poll(async () =>
      host.page
        .locator(".hand .card-sprite")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0);
    await expect.poll(async () =>
      host.page
        .locator(".public-table .card-sprite")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0);
    await expect.poll(async () =>
      host.page
        .locator(".mini-card-back")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth)
    ).toBeGreaterThan(0);
    expect(await host.page.locator(".card-face").count()).toBe(0);
    expect(
      (await host.page.request.get("/assets/uno/plus10.svg")).ok()
    ).toBe(true);
    expect(
      (await host.page.request.get("/assets/uno/card-back.svg")).ok()
    ).toBe(true);
    await host.page.screenshot({
      path: "test-results/ui/game-desktop.png",
      fullPage: true
    });
    await guest.page.screenshot({
      path: "test-results/ui/game-mobile.png",
      fullPage: true
    });

    expect((await handIds(host.page)).length).toBeGreaterThanOrEqual(7);
    expect((await handIds(guest.page)).length).toBeGreaterThanOrEqual(7);
    expect(
      await host.page.locator(".table-seat [data-card-id]").count()
    ).toBe(0);
    expect(
      await guest.page.locator(".table-seat [data-card-id]").count()
    ).toBe(0);

    const mobileMetrics = await guest.page.evaluate(() => {
      const cards = [...document.querySelectorAll(".hand .playing-card")].map(
        (card) => {
          const box = card.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom
          };
        }
      );
      let overlap = false;
      for (let index = 0; index < cards.length; index += 1) {
        for (let inner = index + 1; inner < cards.length; inner += 1) {
          const first = cards[index]!;
          const second = cards[inner]!;
          if (
            first.left < second.right &&
            first.right > second.left &&
            first.top < second.bottom &&
            first.bottom > second.top
          ) {
            overlap = true;
          }
        }
      }
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        overlap
      };
    });
    expect(mobileMetrics.documentWidth).toBeLessThanOrEqual(
      mobileMetrics.viewportWidth
    );
    expect(mobileMetrics.overlap).toBe(false);

    const beforeReload = (await handIds(guest.page)).sort();
    await guest.page.reload();
    await waitForGame(guest.page);
    await expect
      .poll(async () => (await handIds(guest.page)).sort())
      .toEqual(beforeReload);

    await autoPlayUntilFinished([host.page, guest.page]);
    await expect(host.page.locator("#end-heading")).toBeVisible();
    await expect(guest.page.locator("#end-heading")).toBeVisible();
    await expect(host.page.locator("#end-heading")).toContainText("获胜");
    await host.page.screenshot({
      path: "test-results/ui/game-finished.png",
      fullPage: true
    });
    await host.page.getByRole("button", { name: "再来一局", exact: true }).click();
    await expect(host.page.locator("#end-heading")).toHaveCount(0);
    await expect(guest.page.locator("#end-heading")).toHaveCount(0);
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await guest.close();
  }
});

test("six browser clients stay in the same room and turn order", async ({
  browser
}) => {
  const sessions = await Promise.all(
    Array.from({ length: 6 }, () => newPage(browser, 1100, 900))
  );
  const pages = sessions.map((session) => session.page);
  try {
    const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    await registerAccount(pages[0]!, `p1_${suffix}`);
    await pages[0]!.getByRole("button", {
      name: "创建房间",
      exact: true
    }).click();
    await pages[0]!.waitForURL(/\/room\/[A-Z2-9]{6}$/);
    const roomCode = pages[0]!.url().split("/").pop()!;

    for (let index = 1; index < pages.length; index += 1) {
      const page = pages[index]!;
      await registerAccount(page, `p${index + 1}_${suffix}`, `/room/${roomCode}`);
      await expect(page.getByText("准备与开局")).toBeVisible();
      await page.getByRole("button", { name: "准备", exact: true }).click();
    }

    const start = pages[0]!.getByRole("button", {
      name: "开始游戏",
      exact: true
    });
    await expect(start).toBeEnabled();
    await start.click();
    await Promise.all(pages.map(waitForGame));

    for (const page of pages) {
      await expect(page.locator(".table-seat")).toHaveCount(5);
    }
    await pages[0]!.screenshot({
      path: "test-results/ui/game-six-players.png",
      fullPage: true
    });
    const currentNames = await Promise.all(pages.map(currentPlayerName));
    expect(new Set(currentNames).size).toBe(1);

    const currentPage = await (async () => {
      for (const page of pages) {
        const turnText = await page.locator(".turn-order-copy").innerText();
        if (turnText.includes("轮到你")) {
          return page;
        }
      }
      throw new Error("No page reported its own turn");
    })();
    const playable = currentPage.locator(
      '.hand button.playing-card[data-playable="true"]'
    );
    if ((await playable.count()) > 0) {
      await playable.first().click();
      const confirm = currentPage.locator('[data-action="confirm-play"]');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const colorChoice = currentPage.locator(".color-choice").first();
      if ((await colorChoice.count()) > 0) {
        await colorChoice.click();
      }
    } else {
      await currentPage.locator(".draw-pile").click();
    }
    await pages[0]!.waitForTimeout(120);
    const namesAfterAction = await Promise.all(pages.map(currentPlayerName));
    expect(new Set(namesAfterAction).size).toBe(1);
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
  }
});

test("cards are selected first and only played after confirming", async ({
  browser
}) => {
  const host = await newPage(browser, 1280, 900);
  const guest = await newPage(browser, 390, 844, true);
  try {
    const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    await registerAccount(host.page, `selH_${suffix}`);
    await host.page.getByRole("button", {
      name: "创建房间",
      exact: true
    }).click();
    await host.page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
    const roomCode = host.page.url().split("/").pop()!;
    await registerAccount(guest.page, `selG_${suffix}`, `/room/${roomCode}`);
    await expect(guest.page.getByText("准备与开局")).toBeVisible();
    await guest.page.getByRole("button", { name: "准备", exact: true }).click();
    const start = host.page.getByRole("button", {
      name: "开始游戏",
      exact: true
    });
    await expect(start).toBeEnabled();
    await start.click();
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);

    const currentPage = (await host.page
      .locator(".turn-order-copy")
      .innerText()).includes("轮到你")
      ? host.page
      : guest.page;
    const waitingPage = currentPage === host.page ? guest.page : host.page;
    const waitingCard = waitingPage.locator(".hand button.playing-card").first();
    await expect(waitingCard).toBeDisabled();
    const waitingOpacity = await waitingCard.evaluate(
      (element) => getComputedStyle(element).opacity
    );
    expect(waitingOpacity).toBe("1");

    const cards = currentPage.locator(".hand button.playing-card");
    await expect(cards.first()).toBeEnabled();
    const discardIdBefore = await currentPage
      .locator(".public-table .playing-card")
      .getAttribute("data-card-id");
    await cards.first().click();
    await expect(cards.first()).toHaveAttribute("data-selected", "true");
    await currentPage.screenshot({
      path: "test-results/ui/card-selected.png",
      fullPage: true
    });
    expect(
      await currentPage
        .locator(".public-table .playing-card")
        .getAttribute("data-card-id")
    ).toBe(discardIdBefore);
    await expect(
      currentPage.locator('[data-action="confirm-play"]')
    ).toBeVisible();

    const firstBox = await cards.first().boundingBox();
    const secondBox = await cards.nth(1).boundingBox();
    expect(firstBox && secondBox).toBeTruthy();
    expect(secondBox!.y - firstBox!.y).toBeGreaterThanOrEqual(15);
    expect(secondBox!.y - firstBox!.y).toBeLessThanOrEqual(25);
    expect(
      await cards.nth(1).evaluate((element) => getComputedStyle(element).opacity)
    ).toBe("1");

    await cards.nth(1).click();
    await expect(cards.first()).toHaveAttribute("data-selected", "false");
    await expect(cards.nth(1)).toHaveAttribute("data-selected", "true");
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute("data-selected", "false");
    await expect(
      currentPage.locator('[data-action="confirm-play"]')
    ).toBeDisabled();
    await expect(currentPage.getByText("先选择一张手牌")).toBeVisible();

    const invalid = currentPage.locator(
      '.hand button.playing-card[data-playable="false"]'
    );
    if ((await invalid.count()) > 0) {
      await invalid.first().click();
      await expect(
        currentPage.locator('[data-action="confirm-play"]')
      ).toBeDisabled();
      await expect(currentPage.getByText("此牌不可打出")).toBeVisible();
    }

    const playable = currentPage.locator(
      '.hand button.playing-card[data-playable="true"]'
    );
    if ((await playable.count()) > 0) {
      await playable.first().click();
      const confirm = currentPage.locator('[data-action="confirm-play"]');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const colorChoice = currentPage.locator(".color-choice").first();
      if ((await colorChoice.count()) > 0) {
        await colorChoice.click();
      }
      await expect
        .poll(async () =>
          currentPage
            .locator(".public-table .playing-card")
            .getAttribute("data-card-id")
        )
        .not.toBe(discardIdBefore);
    }
  } finally {
    await host.close();
    await guest.close();
  }
});

test("renders 2–6 player seats around the table without overlap", async ({
  browser
}) => {
  const viewports: Record<number, { width: number; height: number; mobile: boolean }> =
    {
      2: { width: 1440, height: 900, mobile: false },
      3: { width: 1280, height: 800, mobile: false },
      4: { width: 1100, height: 800, mobile: false },
      5: { width: 900, height: 800, mobile: false },
      6: { width: 390, height: 844, mobile: true }
    };

  for (const count of [2, 3, 4, 5, 6]) {
    const viewport = viewports[count]!;
    const sessions = await Promise.all(
      Array.from({ length: count }, () =>
        newPage(browser, viewport.width, viewport.height, viewport.mobile)
      )
    );
    const pages = sessions.map((session) => session.page);
    const suffix = `${count}${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    try {
      await registerAccount(pages[0]!, `t${count}h_${suffix}`);
      await pages[0]!.getByRole("button", {
        name: "创建房间",
        exact: true
      }).click();
      await pages[0]!.waitForURL(/\/room\/[A-Z2-9]{6}$/);
      const roomCode = pages[0]!.url().split("/").pop()!;

      for (let index = 1; index < pages.length; index += 1) {
        const page = pages[index]!;
        await registerAccount(
          page,
          `t${count}p${index}_${suffix}`,
          `/room/${roomCode}`
        );
        await expect(page.getByText("准备与开局")).toBeVisible();
        await page.getByRole("button", { name: "准备", exact: true }).click();
      }

      const start = pages[0]!.getByRole("button", {
        name: "开始游戏",
        exact: true
      });
      await expect(start).toBeEnabled();
      await start.click();
      await Promise.all(pages.map(waitForGame));
      await expectTableGeometry(pages[0]!, count - 1);
      if (count === 6) {
        const mobilePage = pages[0]!;
        await expect(mobilePage.locator(".turn-order-player")).toHaveCount(6);
        await expect(
          mobilePage.locator(".turn-order-player.is-current .turn-order-tag")
        ).toHaveText("当前");
        await mobilePage.setViewportSize({ width: 844, height: 390 });
        await expect.poll(() =>
          mobilePage.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(844);
        await expect(mobilePage.locator(".turn-order-strip")).toBeVisible();
        await expect(mobilePage.locator(".table-stage")).toBeVisible();
        await expectTableGeometry(mobilePage, 5);
        const handCardsFit = await mobilePage
          .locator(".hand .playing-card")
          .evaluateAll((cards) => {
            const handDock = document
              .querySelector(".hand-dock")!
              .getBoundingClientRect();
            return cards.every((card) => {
              const bounds = card.getBoundingClientRect();
              return bounds.top >= handDock.top && bounds.bottom <= handDock.bottom;
            });
          });
        expect(handCardsFit).toBe(true);
        await mobilePage.screenshot({
          path: "test-results/ui/game-mobile-landscape.png"
        });
      }
    } finally {
      await Promise.all(sessions.map((session) => session.close()));
    }
  }
});

test("quick emoji bubbles reach both players and stay on screen", async ({
  browser
}) => {
  const host = await newPage(browser, 1280, 900);
  const guest = await newPage(browser, 390, 844, true);
  try {
    const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    const hostName = `emote_host_${suffix}`;
    const guestName = `emote_guest_${suffix}`;
    await registerAccount(host.page, hostName);
    await host.page
      .getByRole("button", { name: "创建房间", exact: true })
      .click();
    await host.page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
    const roomCode = host.page.url().split("/").pop()!;

    await registerAccount(guest.page, guestName, `/room/${roomCode}`);
    await expect(guest.page.getByText("准备与开局")).toBeVisible();
    await guest.page
      .getByRole("button", { name: "准备", exact: true })
      .click();
    await host.page
      .getByRole("button", { name: "开始游戏", exact: true })
      .click();
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);

    await host.page
      .getByRole("button", { name: "发送表情", exact: true })
      .click();
    await expect(host.page.locator(".emoji-choice")).toHaveCount(9);
    await host.page.locator(".emoji-choice").first().click();

    await expect(guest.page.locator(".table-seat .emote-bubble")).toHaveText(
      "😹"
    );
    await expect(
      host.page.locator(".hand-dock .emote-bubble")
    ).toHaveText("😹");

    const bubble = await guest.page
      .locator(".table-seat .emote-bubble")
      .boundingBox();
    expect(bubble).not.toBeNull();
    expect(bubble!.x).toBeGreaterThanOrEqual(0);
    expect(bubble!.y).toBeGreaterThanOrEqual(0);
    expect(bubble!.x + bubble!.width).toBeLessThanOrEqual(390);
    expect(bubble!.y + bubble!.height).toBeLessThanOrEqual(844);
    await guest.page.screenshot({
      path: "test-results/ui/game-mobile-emote.png",
      fullPage: true
    });

    await expect(
      guest.page.locator(".table-seat .emote-bubble")
    ).toHaveCount(0, { timeout: 5000 });
  } finally {
    await host.close();
    await guest.close();
  }
});

test("card sound plays once on both clients after a successful play", async ({
  browser
}) => {
  const host = await newPage(browser, 1280, 900);
  const guest = await newPage(browser, 390, 844, true);
  for (const page of [host.page, guest.page]) {
    await page.addInitScript(() => {
      const target = window as unknown as { __cardSoundPlays: number[] };
      target.__cardSoundPlays = [];
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function play() {
        const source = this.currentSrc || this.src || "";
        if (source.includes("/sounds/card-play.mp3") && !this.muted) {
          target.__cardSoundPlays.push(Date.now());
        }
        const result = originalPlay.call(this);
        return result && typeof result.catch === "function"
          ? result.catch(() => undefined)
          : result;
      };
    });
  }
  try {
    const suffix = `${Date.now().toString(36).slice(-5)}${Math.random()
      .toString(36)
      .slice(2, 4)}`;
    const hostName = `sound_host_${suffix}`;
    const guestName = `sound_guest_${suffix}`;
    await registerAccount(host.page, hostName);
    await host.page
      .getByRole("button", { name: "创建房间", exact: true })
      .click();
    await host.page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
    const roomCode = host.page.url().split("/").pop()!;
    await registerAccount(guest.page, guestName, `/room/${roomCode}`);
    await expect(guest.page.getByText("准备与开局")).toBeVisible();
    await guest.page
      .getByRole("button", { name: "准备", exact: true })
      .click();
    await host.page
      .getByRole("button", { name: "开始游戏", exact: true })
      .click();
    await Promise.all([waitForGame(host.page), waitForGame(guest.page)]);

    const current = (await host.page.locator(".self-heading .active-tag").count())
      ? host.page
      : guest.page;
    const playable = current.locator(
      '.hand button.playing-card[data-playable="true"]'
    );
    await expect(playable.first()).toBeVisible();
    await playable.first().click();
    await current.locator('[data-action="confirm-play"]').click();
    const colorChoice = current.locator(".color-choice").first();
    if ((await colorChoice.count()) > 0) {
      await colorChoice.click();
    }
    await host.page.waitForFunction(
      () =>
        (window as unknown as { __cardSoundPlays: number[] }).__cardSoundPlays
          .length > 0
    );
    await guest.page.waitForFunction(
      () =>
        (window as unknown as { __cardSoundPlays: number[] }).__cardSoundPlays
          .length > 0
    );
    await host.page.waitForTimeout(500);
    expect(
      await host.page.evaluate(
        () =>
          (window as unknown as { __cardSoundPlays: number[] }).__cardSoundPlays
            .length
      )
    ).toBe(1);
    expect(
      await guest.page.evaluate(
        () =>
          (window as unknown as { __cardSoundPlays: number[] }).__cardSoundPlays
            .length
      )
    ).toBe(1);
  } finally {
    await host.close();
    await guest.close();
  }
});
