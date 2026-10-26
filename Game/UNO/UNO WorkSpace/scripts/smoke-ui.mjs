/**
 * A quick smoke check of the screens this change touched: the header-less table, the floating table bar and its
 * hamburger menu, the account settings page (theme switch + avatar cropper), the friends page and the tutorial's
 * spotlight tour. Screenshots go to test-results/smoke/.
 *
 *     node scripts/smoke-ui.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3199";
const SHOTS = "test-results/smoke";
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const watch = (page, label) => {
  page.on("pageerror", (error) => problems.push(`${label} page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // A missing favicon is the site's own long-standing 404, unrelated to this change.
    if (text.includes("favicon") || (text.includes("404") && (message.location()?.url ?? "").includes("favicon"))) return;
    problems.push(`${label} console: ${text} @ ${message.location()?.url ?? ""}`);
  });
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().includes("favicon")) problems.push(`${label} http ${response.status()}: ${response.url()}`); });
};

async function register(page, prefix) {
  const username = `${prefix}_${Date.now().toString(36).slice(-5)}`;
  await page.goto(`${BASE}/uno`);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.locator("#auth-username").fill(username);
  await page.locator("#auth-email").fill(`${username}@example.test`);
  await page.locator("#auth-password").fill("TestPass123!");
  await page.locator("#auth-confirm-password").fill("TestPass123!");
  await page.getByRole("button", { name: "注册并登录", exact: true }).click();
  await page.waitForURL(`${BASE}/`);
  return username;
}

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
watch(page, "A");
const name = await register(page, "smoke");

// The homepage keeps only the account entry: the theme switch moved into account settings.
await page.goto(`${BASE}/`);
if (await page.locator(".theme-control").count()) problems.push("homepage: theme switch is still on the homepage");
await page.screenshot({ path: `${SHOTS}/01-home.png` });

// The "我的" menu no longer offers 主页.
await page.locator(".my-link").click();
const menuItems = await page.locator(".my-menu a").allInnerTexts();
if (menuItems.includes("主页")) problems.push(`menu still has 主页: ${menuItems.join(",")}`);
if (!menuItems.includes("我的好友") || !menuItems.includes("账号设置")) problems.push(`menu lost entries: ${menuItems.join(",")}`);
await page.screenshot({ path: `${SHOTS}/02-menu.png` });

// Account settings: the theme switch, and the avatar picker that leads to the cropper.
await page.goto(`${BASE}/about`);
await page.waitForSelector(".about-page");
if (!(await page.locator(".theme-setting .theme-control").count())) problems.push("about: no theme switch");
const backText = (await page.locator(".about-back").innerText()).trim();
if (backText !== "返回主页") problems.push(`about: back entry reads ${backText}`);
await page.setInputFiles("#avatar-file", {
  name: "tiny.png",
  mimeType: "image/png",
  // A 2×2 PNG, exactly the kind of picture a phone hands over.
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64")
});
await page.waitForSelector(".avatar-crop", { timeout: 5000 }).catch(() => problems.push("about: picking a PNG did not open the cropper"));
await page.screenshot({ path: `${SHOTS}/03-cropper.png` });
const cropButtons = await page.locator(".avatar-crop-buttons button").allInnerTexts();
if (!cropButtons.some((text) => text.includes("使用这张头像"))) problems.push(`cropper buttons: ${cropButtons.join(",")}`);
// Cropping produces a file, which then shows as a pending avatar ready to be saved.
await page.getByRole("button", { name: "使用这张头像" }).click();
await page.waitForTimeout(400);
const saveEnabled = await page.getByRole("button", { name: "保存头像" }).isEnabled().catch(() => false);
if (!saveEnabled) problems.push("cropper: the cropped picture was not attached for saving");
await page.getByRole("button", { name: "保存头像" }).click();
await page.locator(".hint", { hasText: "头像已保存" }).first().waitFor({ timeout: 10_000 })
  .catch(async () => problems.push(`about: the cropped avatar did not save (notice: ${await page.locator(".hint").first().innerText().catch(() => "")})`));
// The saved avatar is served back from the account, so the profile picture and the header both show it.
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/04-avatar-saved.png` });

// Friends page: its own way back home, and per-friend presence with the game they are in.
const friendContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const friendPage = await friendContext.newPage();
watch(friendPage, "B");
const friendName = await register(friendPage, "smokefriend");
await page.goto(`${BASE}/friends`);
await page.waitForSelector(".friends-page");
if (!(await page.locator(".friends-home").count())) problems.push("friends: no 返回主页 entry");
// The other account asks for a friendship and the first accepts; both lists then update over the live socket.
await friendPage.goto(`${BASE}/friends`);
await friendPage.locator(".friend-search input").fill(name);
await friendPage.getByRole("button", { name: "发送好友申请" }).click();
await page.waitForTimeout(600);
await page.reload();
await page.waitForSelector(".friends-page");
await page.getByRole("button", { name: "接受", exact: true }).first().click();
await page.waitForTimeout(800);
const friendsText = await page.locator(".friends-page").innerText();
const listed = await page.locator(".friends-page .friend-name").first().innerText().catch(() => "");
if (!listed.includes(friendName.slice(0, 12))) problems.push(`friends: ${friendName} did not appear (list shows ${listed.split(String.fromCharCode(10)).join(" / ")})`);
if (!friendsText.includes("在线")) problems.push("friends: no 在线 label next to an online friend");
if (!(await page.locator(".friend-avatar").count())) problems.push("friends: no avatar next to a friend");
// Being in a room shows which game, straight from the server's own room bookkeeping.
await friendPage.goto(`${BASE}/arknights-union-arena/pvp`);
await friendPage.getByRole("button", { name: "创建对战房间" }).click();
await friendPage.waitForSelector(".ua-tablebar", { timeout: 8_000 });
await page.waitForTimeout(900);
const inGame = await page.locator(".friends-page").innerText();
if (!inGame.includes("正在游玩 明日方舟 UNION ARENA")) problems.push("friends: the game line is missing while the friend is in a Union Arena room");
await page.screenshot({ path: `${SHOTS}/14-friends.png` });
// Closing the other tab makes that friend offline, and the line about their game goes with it.
await friendPage.close();
await friendContext.close();
await page.waitForTimeout(1_500);
const offlineText = await page.locator(".friends-page").innerText();
if (!offlineText.includes("离线")) problems.push("friends: the friend was not shown offline after closing the tab");
if (offlineText.includes("正在游玩")) problems.push("friends: an offline friend still shows a game");

// The table: no top bar, the floating bar in the board's corner, a hamburger menu with all three entries.
await page.goto(`${BASE}/arknights-union-arena/pvp`);
// The room page (before a room exists) has no table, so its own create button is used directly.
await page.getByRole("button", { name: "创建对战房间" }).click();
await page.waitForSelector(".ua-tablebar", { timeout: 8000 }).catch(() => problems.push("table: no floating table bar"));
if (await page.locator("header.ua-header").count()) problems.push("table: the top header is still there");
if (await page.locator(".ua-tablebar .theme-control").count()) problems.push("table: the theme switch is still in the table");
await page.screenshot({ path: `${SHOTS}/05-table.png` });
await page.getByRole("button", { name: "房间菜单" }).click();
const entries = await page.locator(".ua-menu .ua-menu-item").allInnerTexts();
for (const wanted of ["解散房间", "返回大厅", "设置"]) if (!entries.includes(wanted)) problems.push(`hamburger menu is missing ${wanted}: ${entries.join(",")}`);
await page.screenshot({ path: `${SHOTS}/06-menu.png` });

// "返回大厅" leaves the room for good: coming back to the pvp route then shows the room page again, never the old room.
if (await page.getByRole("button", { name: "房间菜单" }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: "房间菜单" }).click();
await page.getByRole("menuitem", { name: "返回大厅" }).click();
await page.waitForURL("**/arknights-union-arena/", { timeout: 8000 }).catch(() => problems.push("menu: 返回大厅 did not reach the game lobby"));
await page.goto(`${BASE}/arknights-union-arena/pvp`);
await page.waitForSelector(".ua-room-page", { timeout: 8000 }).catch(() => problems.push("leaving: the pvp route still resumed the old room"));
if (await page.locator(".ua-room-page .theme-control").count()) problems.push("room page: the theme switch is still there");
if (await page.locator(".ua-table").count()) problems.push("leaving: the old room came back after 返回大厅");

// Tutorial: the spotlight tooltip and its dimming layer.
await page.goto(`${BASE}/arknights-union-arena/tutorial`);
await page.waitForSelector(".ua-spot-tip", { timeout: 10_000 }).catch(() => problems.push("tutorial: no spotlight tooltip"));
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/07-tutorial.png` });
await page.getByRole("button", { name: "下一步", exact: true }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/08-tutorial-step2.png` });
const tipText = await page.locator(".ua-spot-text").innerText().catch(() => "");
if (!tipText.includes("前线")) problems.push(`tutorial: step 2 text reads ${tipText}`);
// The second step points at the front line, so the ring must be visible over it.
const ring = await page.locator(".ua-spot-ring").count();
if (!ring) problems.push("tutorial: no spotlight ring on a highlighted step");

// Spotlight on a step the player carries out: the text steps aside, the highlight stays, and the reminder comes back
// only once after the wait. Everything is measured from the live DOM, so the highlight tracks the real element.
await page.goto(`${BASE}/arknights-union-arena/tutorial`);
await page.waitForSelector(".ua-spot-tip");
for (let step = 0; step < 7; step += 1) {
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.waitForTimeout(420);
}
// Step 8 (index 7) is the mulligan: an action step, so the text steps aside by itself.
await page.waitForTimeout(3_200);
const fading = await page.locator(".ua-spot-tip").getAttribute("data-fading");
if (fading !== "true") problems.push(`tutorial: the text did not step aside on a step the player must act on (data-fading=${fading})`);
if (!(await page.locator(".ua-spot-ring").count())) problems.push("tutorial: the highlight was lost while the player was acting");
await page.screenshot({ path: `${SHOTS}/09-tutorial-acting.png` });
// The reminder comes back once the wait (read 2.6 s + fade 0.26 s + wait 9 s) has run out.
await page.waitForTimeout(9_000);
const reminded = await page.locator(".ua-spot-tip").getAttribute("data-fading");
if (reminded === "true") problems.push("tutorial: the reminder never came back after the wait");
await page.screenshot({ path: `${SHOTS}/10-tutorial-reminder.png` });
// Completing the step cancels everything: press what the step asks for.
await page.getByRole("button", { name: "保留起手牌" }).click();
await page.waitForTimeout(1_200);
const afterDone = await page.locator(".ua-spot-tip").getAttribute("data-fading");
if (afterDone === "true") problems.push("tutorial: the text stayed hidden after the step was completed");
await page.screenshot({ path: `${SHOTS}/11-tutorial-next.png` });

// A phone in landscape: the table bar must stay in the corner, and nothing may scroll sideways. Same browser
// context, so the same login.
const phonePage = await context.newPage();
await phonePage.setViewportSize({ width: 844, height: 390 });
watch(phonePage, "phone");
await phonePage.goto(`${BASE}/arknights-union-arena/pvp`);
await phonePage.waitForSelector(".ua-room-page, .ua-app", { timeout: 10_000 });
await phonePage.screenshot({ path: `${SHOTS}/12-phone-start.png` });
if (!(await phonePage.locator(".ua-room-page").count())) problems.push(`phone: the pvp route shows ${(await phonePage.locator("body").innerText()).slice(0, 100)}`);
await phonePage.getByRole("button", { name: "创建对战房间" }).click();
await phonePage.waitForSelector(".ua-tablebar", { timeout: 8_000 });
const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) problems.push(`phone: the table scrolls sideways by ${overflow}px`);
const barBox = await phonePage.locator(".ua-tablebar").boundingBox();
if (!barBox || barBox.width < 40) problems.push("phone: the table bar is missing or collapsed");
await phonePage.screenshot({ path: `${SHOTS}/12-phone-table.png` });
await phonePage.getByRole("button", { name: "房间菜单" }).click();
if (!(await phonePage.locator(".ua-menu .ua-menu-item").count())) problems.push("phone: the hamburger menu did not open");
await phonePage.screenshot({ path: `${SHOTS}/13-phone-menu.png` });
await phonePage.close();

// The new behaviour: the table bar folds to a key during play, settings comes back to the game, the invite dialog only
// offers online friends, and a revealed life card sits in the middle of the screen.
// A fresh account: the earlier sections left rooms behind, and a seat lingers for the reconnect grace period.
const barContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const barPage = await barContext.newPage();
watch(barPage, "C");
await register(barPage, "smokebar");
await barPage.goto(`${BASE}/arknights-union-arena/pvp`);
await barPage.waitForSelector(".ua-room-page", { timeout: 10_000 });
await barPage.getByRole("button", { name: "创建对战房间" }).click();
await barPage.waitForSelector(".ua-tablebar", { timeout: 10_000 }).catch(async () => {
  problems.push(`bar: no table bar after creating a room (page: ${(await barPage.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 120)})`);
});
// In the lobby the full bar is up; opening the tools panel hides it entirely.
await barPage.getByRole("button", { name: /打开工具面板|展开侧栏/ }).click();
if (await barPage.locator(".ua-tablebar").count()) problems.push("bar: still visible while the tools panel is open");
await barPage.locator(".ua-panel").getByRole("button", { name: "关闭" }).click();
await barPage.waitForSelector(".ua-tablebar", { timeout: 5_000 });
// Settings opened from the room comes back to the room, not to the home page.
await barPage.getByRole("button", { name: "房间菜单" }).click();
await barPage.getByRole("menuitem", { name: "设置" }).click();
await barPage.waitForSelector(".about-page", { timeout: 10_000 });
const back = (await barPage.locator(".about-back").innerText()).trim();
if (back !== "返回对局") problems.push(`settings: back entry reads ${back} (expected 返回对局)`);
await barPage.locator(".about-back").click();
await barPage.waitForTimeout(2_000);
if (!(await barPage.locator(".ua-tablebar").count())) problems.push("settings: 返回对局 did not restore the table");
await barPage.screenshot({ path: `${SHOTS}/15-settings-back.png` });

// The invite dialog: an offline friend is greyed out and cannot be invited.
const seat = barPage.locator(".ua-seatbar[data-side='opponent'] .ua-empty-invite");
if (await seat.count()) {
  await seat.click();
  await barPage.waitForSelector(".invite-dialog", { timeout: 8_000 }).catch(() => problems.push("invite: the dialog did not open"));
  const rows = await barPage.locator(".invite-dialog-list li").count();
  if (rows) {
    const offlineRows = await barPage.locator(".invite-dialog-list li[data-unavailable='true']").count();
    const disabled = await barPage.locator(".invite-dialog-list li[data-unavailable='true'] button").first().isDisabled().catch(() => false);
    if (offlineRows && !disabled) problems.push("invite: an offline friend can still be invited");
    await barPage.screenshot({ path: `${SHOTS}/16-invite-online.png` });
  }
  await barPage.keyboard.press("Escape");
}
await barContext.close();

// A revealed life card: centred, sideways, with the event under it and no top bar while it is up.
await page.goto(`${BASE}/arknights-union-arena/tutorial`);
await page.waitForSelector(".ua-spot-tip");
const next = page.getByRole("button", { name: "下一步", exact: true });
for (let step = 0; step < 7; step += 1) { await next.click(); await page.waitForTimeout(380); }
await page.getByRole("button", { name: "保留起手牌" }).click();
await page.waitForTimeout(900);
// The tutorial cannot reach the later turns quickly, so the panel's presence is asserted through the CSS contract.
const revealCss = await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.className = "ua-reveal";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const result = { position: style.position, zIndex: style.zIndex };
  probe.remove();
  return result;
});
if (revealCss.position !== "fixed") problems.push(`reveal: panel is ${revealCss.position}, expected fixed`);

await browser.close();
console.log(problems.length ? `problems: ${problems.join(" | ")}` : "no problems");
process.exitCode = problems.length ? 1 : 0;
