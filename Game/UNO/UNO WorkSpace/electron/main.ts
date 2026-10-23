import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  type MessageBoxOptions
} from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAppServer,
  type AppServer
} from "../server/app.ts";
import { isNewerVersion } from "../shared/version.ts";

let mainWindow: BrowserWindow | null = null;
let embeddedServer: AppServer | null = null;
let quitting = false;

interface UpdateManifest {
  version: string;
  downloadUrl: string;
  notes?: string;
}

interface ResolvedUpdate {
  manifest: UpdateManifest;
  downloadTarget: string;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

function clientDistPath(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "dist",
        "client"
      )
    : path.resolve(process.cwd(), "dist", "client");
}

function accountDataPath(): string {
  return process.env.UNO_DATA_DIR ?? path.join(app.getPath("userData"), "data");
}

async function loadUpdateManifest(): Promise<ResolvedUpdate | null> {
  const sources: string[] = [];
  if (process.env.UNO_UPDATE_MANIFEST) {
    sources.push(process.env.UNO_UPDATE_MANIFEST);
  }
  sources.push(path.join(app.getPath("userData"), "update.json"));
  sources.push(path.join(path.dirname(app.getPath("exe")), "update.json"));

  for (const source of sources) {
    try {
      let raw: string;
      const isHttp = /^https?:\/\//i.test(source);
      if (isHttp) {
        const response = await fetch(source);
        if (!response.ok) {
          continue;
        }
        raw = await response.text();
      } else {
        if (!existsSync(source)) {
          continue;
        }
        raw = await fs.readFile(source, "utf8");
      }
      const parsed = JSON.parse(raw) as Partial<UpdateManifest>;
      if (
        typeof parsed.version !== "string" ||
        typeof parsed.downloadUrl !== "string" ||
        parsed.version.length > 40 ||
        parsed.downloadUrl.length > 2048
      ) {
        continue;
      }
      let downloadTarget = parsed.downloadUrl;
      if (!/^(https?|file):\/\//i.test(downloadTarget)) {
        downloadTarget = isHttp
          ? new URL(downloadTarget, source).toString()
          : path.resolve(path.dirname(source), downloadTarget);
      }
      return {
        manifest: {
          version: parsed.version,
          downloadUrl: parsed.downloadUrl,
          notes: typeof parsed.notes === "string" ? parsed.notes : undefined
        },
        downloadTarget
      };
    } catch (error) {
      console.warn(`Unable to read update manifest ${source}`, error);
    }
  }
  return null;
}

async function promptForUpdateIfAvailable(): Promise<void> {
  const update = await loadUpdateManifest();
  if (
    !update ||
    !isNewerVersion(update.manifest.version, app.getVersion())
  ) {
    return;
  }
  const messageOptions: MessageBoxOptions = {
    type: "info",
    title: "发现新版本",
    message: `发现 UNO LAN v${update.manifest.version}`,
    detail:
      update.manifest.notes ??
      `当前版本 v${app.getVersion()}。更新会关闭游戏、覆盖安装新版本并删除安装包，账号数据会保留。`,
    buttons: ["立即更新", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, messageOptions)
    : await dialog.showMessageBox(messageOptions);
  if (result.response !== 0) {
    return;
  }
  try {
    await launchSilentUpdate(update);
  } catch (error) {
    const errorOptions: MessageBoxOptions = {
      type: "error",
      title: "更新失败",
      message: "无法准备更新文件",
      detail: error instanceof Error ? error.message : String(error)
    };
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, errorOptions);
    } else {
      await dialog.showMessageBox(errorOptions);
    }
  }
}

async function downloadUpdateFile(
  target: string,
  destination: string
): Promise<string | null> {
  if (/^https?:\/\//i.test(target)) {
    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`下载更新失败：HTTP ${response.status}`);
    }
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return null;
  }
  const source = target.startsWith("file:")
    ? fileURLToPath(target)
    : target;
  await fs.copyFile(source, destination);
  return source;
}

async function launchSilentUpdate(update: ResolvedUpdate): Promise<void> {
  const installDir =
    process.env.PORTABLE_EXECUTABLE_DIR ??
    path.dirname(app.getPath("exe"));
  const updateDir = path.join(app.getPath("temp"), "uno-lan-update");
  await fs.mkdir(updateDir, { recursive: true });
  const setupPath = path.join(
    updateDir,
    `UNO-LAN-${update.manifest.version}-${randomUUID()}.exe`
  );
  const originalInstaller = await downloadUpdateFile(
    update.downloadTarget,
    setupPath
  );
  const scriptPath = path.join(updateDir, `apply-${randomUUID()}.ps1`);
  const newAppPath = path.join(installDir, "UNO LAN.exe");
  const script = `
$ErrorActionPreference = "SilentlyContinue"
try { Wait-Process -Id ([int]$env:UNO_UPDATE_PID) -Timeout 40 } catch {}
$installArgs = @("/S", "/currentuser", ("/D=" + $env:UNO_UPDATE_INSTALL_DIR))
$install = Start-Process -FilePath $env:UNO_UPDATE_SETUP -ArgumentList $installArgs -Wait -PassThru
if ($install.ExitCode -eq 0) {
  Remove-Item -LiteralPath $env:UNO_UPDATE_SETUP -Force
  if ($env:UNO_UPDATE_ORIGINAL) {
    Remove-Item -LiteralPath $env:UNO_UPDATE_ORIGINAL -Force
  }
  Start-Process -FilePath $env:UNO_UPDATE_APP
}
Remove-Item -LiteralPath $env:UNO_UPDATE_SCRIPT -Force
`;
  await fs.writeFile(scriptPath, script, "utf8");
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        UNO_UPDATE_PID: String(process.pid),
        UNO_UPDATE_SETUP: setupPath,
        UNO_UPDATE_INSTALL_DIR: installDir,
        UNO_UPDATE_ORIGINAL: originalInstaller ?? "",
        UNO_UPDATE_APP: newAppPath,
        UNO_UPDATE_SCRIPT: scriptPath
      }
    }
  );
  child.unref();
  app.quit();
}

async function startEmbeddedServer(): Promise<{
  server: AppServer;
  port: number;
}> {
  const basePort = Number(process.env.UNO_PORT ?? 3000);
  let lastError: unknown = null;
  for (let port = basePort; port < basePort + 12; port += 1) {
    const candidate = createAppServer({
      clientDist: clientDistPath(),
      dataDir: accountDataPath()
    });
    try {
      const actualPort = await candidate.listen(port, "0.0.0.0");
      return { server: candidate, port: actualPort };
    } catch (error) {
      lastError = error;
      await candidate.close().catch(() => undefined);
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("No available local port");
}

function createMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: "UNO LAN",
    backgroundColor: "#101112",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      void dialog.showMessageBox({
        type: "error",
        title: "UNO LAN",
        message: "无法加载游戏界面",
        detail: `${errorDescription} (${errorCode})`
      });
    }
  );
  void mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("com.local.uno.lan");
  try {
    const started = await startEmbeddedServer();
    embeddedServer = started.server;
    console.log(
      `UNO desktop server listening on 0.0.0.0:${started.port}`
    );
    createMainWindow(started.port);
    setTimeout(() => {
      void promptForUpdateIfAvailable();
    }, 1200);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "UNO LAN",
      message: "启动桌面服务器失败",
      detail: error instanceof Error ? error.message : String(error)
    });
    app.quit();
  }
}

app.on("before-quit", (event) => {
  if (!embeddedServer || quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  embeddedServer
    .close()
    .catch(() => undefined)
    .finally(() => {
      embeddedServer = null;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  app.quit();
});

if (gotLock) {
  app.whenReady().then(bootstrap).catch((error) => {
    console.error(error);
    app.quit();
  });
}
