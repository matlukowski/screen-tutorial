import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { LocalAssistantOrchestrator } from "@local-ai/orchestrator";
import { LocalSttWorker, type TranscribeAudioInput } from "@local-ai/stt-worker";

const AUTO_CAPTURE_INTERVAL_MS = 3_000;
const DEFAULT_WINDOWED_WIDTH = 1440;
const DEFAULT_WINDOWED_HEIGHT = 900;
const MAX_STORED_SCREENSHOTS = 10;

let overlayWindow: BrowserWindow | null = null;
let orchestrator: LocalAssistantOrchestrator;
let sttWorker: LocalSttWorker;
let screenshotDir: string;
let autoCaptureTimer: NodeJS.Timeout | null = null;
let captureInFlight = false;
let prefersFullscreen = true;
let screenshotBuffer: string[] = [];

async function getActiveWindowTitle(): Promise<string> {
  try {
    const activeWinModule = await import("active-win");
    const info = await activeWinModule.activeWindow();
    return info?.title || "Unknown Application";
  } catch {
    return "Unknown Application";
  }
}

async function deleteScreenshotIfExists(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn("Failed to delete old screenshot", { filePath, error: error?.message });
    }
  }
}

async function initializeScreenshotBuffer() {
  const entries = await fs.readdir(screenshotDir, { withFileTypes: true });
  const screenshotPaths = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("screen-") && entry.name.endsWith(".png"))
    .map((entry) => path.join(screenshotDir, entry.name))
    .sort();

  const overflow = screenshotPaths.slice(0, Math.max(0, screenshotPaths.length - MAX_STORED_SCREENSHOTS));
  screenshotBuffer = screenshotPaths.slice(-MAX_STORED_SCREENSHOTS);

  await Promise.all(overflow.map((filePath) => deleteScreenshotIfExists(filePath)));
}

async function pushScreenshotToBuffer(filePath: string) {
  screenshotBuffer.push(filePath);

  while (screenshotBuffer.length > MAX_STORED_SCREENSHOTS) {
    const oldest = screenshotBuffer.shift();
    if (oldest) {
      await deleteScreenshotIfExists(oldest);
    }
  }
}

async function captureScreenshot(): Promise<string> {
  const screenshot = await import("screenshot-desktop");
  const image = await screenshot.default({ format: "png" });

  const filePath = path.join(screenshotDir, `screen-${Date.now()}.png`);
  await fs.writeFile(filePath, image);
  await pushScreenshotToBuffer(filePath);
  return filePath;
}

function getCenteredWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(DEFAULT_WINDOWED_WIDTH, workArea.width);
  const height = Math.min(DEFAULT_WINDOWED_HEIGHT, workArea.height);

  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
  };
}

function sendWindowMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send("overlay:window-mode", {
    isFullscreen: overlayWindow.isFullScreen(),
  });
}

function applyWindowMode() {
  if (!overlayWindow) return;

  if (prefersFullscreen) {
    overlayWindow.setFullScreen(true);
  } else {
    const bounds = getCenteredWindowBounds();
    overlayWindow.setFullScreen(false);
    overlayWindow.setBounds(bounds);
  }

  sendWindowMode();
}

function ensureWindow() {
  if (overlayWindow) return;

  overlayWindow = new BrowserWindow({
    show: false,
    frame: false,
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    alwaysOnTop: false,
    resizable: true,
    backgroundColor: "#08111f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, "../src/renderer/index.html"));

  overlayWindow.webContents.on("did-finish-load", () => {
    applyWindowMode();
  });

  overlayWindow.on("show", () => {
    startAutoCapture();
    sendWindowMode();
  });

  overlayWindow.on("hide", () => {
    stopAutoCapture();
  });

  overlayWindow.on("minimize", () => {
    stopAutoCapture();
  });

  overlayWindow.on("restore", () => {
    void openOverlayWithContext("restore");
  });

  overlayWindow.on("enter-full-screen", () => {
    sendWindowMode();
  });

  overlayWindow.on("leave-full-screen", () => {
    sendWindowMode();
  });

  overlayWindow.on("closed", () => {
    stopAutoCapture();
    overlayWindow = null;
  });
}

async function refreshOverlayContext(captureSource: "auto" | "hotkey" | "restore" | "startup") {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  if (!overlayWindow.isVisible() || overlayWindow.isMinimized()) return null;
  if (captureInFlight) return null;

  captureInFlight = true;

  try {
    const [screenshotPath, windowTitle] = await Promise.all([
      captureScreenshot(),
      getActiveWindowTitle(),
    ]);

    const payload = {
      screenshotPath,
      screenshotPaths: [...screenshotBuffer],
      screenshotUrl: pathToFileURL(screenshotPath).href,
      windowTitle,
      capturedAt: new Date().toISOString(),
      captureSource,
      storedScreenshotCount: screenshotBuffer.length,
      maxStoredScreenshots: MAX_STORED_SCREENSHOTS,
    };

    overlayWindow.webContents.send("overlay:context", payload);
    return payload;
  } catch (error) {
    console.error("Failed to capture overlay context:", error);
    const payload = {
      screenshotPath: "",
      screenshotPaths: [...screenshotBuffer],
      screenshotUrl: "",
      windowTitle: await getActiveWindowTitle(),
      capturedAt: new Date().toISOString(),
      captureSource,
      storedScreenshotCount: screenshotBuffer.length,
      maxStoredScreenshots: MAX_STORED_SCREENSHOTS,
    };

    overlayWindow.webContents.send("overlay:context", payload);
    return payload;
  } finally {
    captureInFlight = false;
  }
}

function startAutoCapture() {
  if (autoCaptureTimer) return;

  autoCaptureTimer = setInterval(() => {
    void refreshOverlayContext("auto");
  }, AUTO_CAPTURE_INTERVAL_MS);
}

function stopAutoCapture() {
  if (!autoCaptureTimer) return;
  clearInterval(autoCaptureTimer);
  autoCaptureTimer = null;
}

async function openOverlayWithContext(captureSource: "hotkey" | "restore" | "startup" = "hotkey") {
  ensureWindow();
  if (!overlayWindow) return;

  applyWindowMode();
  overlayWindow.show();
  overlayWindow.focus();

  startAutoCapture();
  await refreshOverlayContext(captureSource);
}

function registerIpc() {
  ipcMain.handle("assistant:ask", async (_, input) => {
    return orchestrator.ask(input);
  });

  ipcMain.handle("history:list", async (_, appTitle?: string) => {
    return orchestrator.listSessions(appTitle);
  });

  ipcMain.handle("history:get", async (_, sessionId: string) => {
    return orchestrator.getSession(sessionId);
  });

  ipcMain.handle("stt:transcribe", async (_, input: Omit<TranscribeAudioInput, "bytes"> & { bytes?: number[] }) => {
    const payload: TranscribeAudioInput = {
      bytes: Buffer.from(input?.bytes || []),
      chunkCount: input?.chunkCount,
      durationMs: input?.durationMs,
      mimeType: input?.mimeType,
    };

    const result = await sttWorker.transcribeFromBuffer(payload);

    if (result.status === "ok") {
      console.info("Local STT transcription succeeded", {
        durationMs: payload.durationMs,
        mimeType: payload.mimeType,
        status: result.status,
        textLength: result.text.length,
      });
    } else {
      console.warn("Local STT transcription did not produce text", {
        diagnostics: result.diagnostics,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        status: result.status,
      });
    }

    return result;
  });

  ipcMain.handle("window:minimize", () => {
    stopAutoCapture();
    overlayWindow?.minimize();
  });

  ipcMain.handle("window:close", () => {
    stopAutoCapture();
    overlayWindow?.hide();
  });

  ipcMain.handle("window:toggle-pin", () => {
    if (!overlayWindow) return false;
    const next = !overlayWindow.isAlwaysOnTop();
    overlayWindow.setAlwaysOnTop(next);
    return next;
  });

  ipcMain.handle("window:toggle-mode", () => {
    if (!overlayWindow) {
      return { isFullscreen: prefersFullscreen };
    }

    prefersFullscreen = !prefersFullscreen;
    applyWindowMode();
    return { isFullscreen: prefersFullscreen };
  });
}

async function bootstrap() {
  const userDataPath = app.getPath("userData");
  screenshotDir = path.join(userDataPath, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  await initializeScreenshotBuffer();

  const dbPath = path.join(userDataPath, "assistant-history.db");
  orchestrator = new LocalAssistantOrchestrator(dbPath);
  sttWorker = new LocalSttWorker();

  ensureWindow();
  registerIpc();

  globalShortcut.register("Control+Shift+Space", () => {
    void openOverlayWithContext("hotkey");
  });

  void openOverlayWithContext("startup");

  if (process.platform === "win32") {
    app.setAppUserModelId("local-ai-screen-assistant");
  }
}

app.whenReady()
  .then(() => bootstrap())
  .catch((error) => {
    console.error("Failed to bootstrap desktop app:", error);
    app.quit();
  });

app.on("will-quit", () => {
  stopAutoCapture();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    ensureWindow();
  }
});
