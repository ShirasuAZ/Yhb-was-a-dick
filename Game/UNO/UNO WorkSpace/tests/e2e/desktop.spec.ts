import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("desktop EXE entry launches the embedded game window", async () => {
  const app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: {
      ...process.env,
      UNO_PORT: "3210",
      UNO_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "uno-desktop-"))
    }
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect(window.locator(".lobby-shell")).toBeVisible();
    await expect(window.locator(".connect-host")).toHaveCount(0);
    await expect(window.getByRole("heading", { name: "LayUDown" })).toBeVisible();
    await expect(window.locator(".version-badge")).toHaveText("v2.3.0");
    expect(window.url()).toContain("127.0.0.1:3210");
    await expect(window.getByText("账号保存在运行服务器的电脑上")).toHaveCount(0);
    await window.screenshot({
      path: "test-results/ui/desktop-window.png",
      fullPage: true
    });
  } finally {
    await app.close();
  }
});
