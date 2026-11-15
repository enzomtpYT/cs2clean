// Electron entry point: windows, IPC, the in-game overlay and the game data source.
//
//   electron .                     live data from Steam's players list + CS2's game-state feed (default)
//   electron . --replay            plays fixtures/premier-mirage.jsonl instead (no CS2 needed)
//   electron . --replay=<file>     plays a recording, e.g. one made with --record
//   ow-electron . --overwolf       Overwolf's CS2 game events and overlay (needs Overwolf's approval)
//   ... --record                   with --overwolf: saves Overwolf's CS2 data to <userData>/recordings
//   ... --minimized                start minimized to the taskbar (used when starting with Windows)
//
// Player data comes from Leetify's Public API (main/leetify.ts). An API key is saved in Settings, or taken
// from the LEETIFY_API_KEY environment variable.
//
// Hard rule: nothing here reads or changes CS2's memory, injects into it or hooks its drawing. The
// default overlay is an ordinary see-through, click-through window kept on top of the game, which works
// when CS2 runs in "Fullscreen Windowed" mode.

import { app, BrowserWindow, globalShortcut, ipcMain, net, safeStorage, screen, session, shell, utilityProcess, type UtilityProcess } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hotkeys } from "../shared/hotkeys";
import { OVERWOLF_HOTKEYS } from "../shared/overwolf-hotkeys";
import type { AppState } from "../shared/types";
import { Controller, type SettingsStore } from "./controller";
import { CSREP_DOCS_URL } from "./csrep";
import { checkHeroRuntime, configureHero, onHeroStatus } from "./leetify-hero";
import { keepClickThrough } from "./click-through";
import { keepOverlayPositionedAndOnTop, linuxOverlayWindowOptions, overlayBounds, OVERLAY_SIZE } from "./overlay-window";
import { playerCacheFileStore } from "./player-cache";
import { shouldUseWaylandLayerShell, WaylandLayerOverlay } from "./wayland-overlay";
import { ensurePortableDataDir, portableDataDir } from "./portable";
import { noteUpdateCheck, readLastUpdateCheck, settingsFileStore, type KeyCrypto } from "./settings-file";
import { checkForUpdate, OWNER, REPO } from "./update-checker";
import type { UpdateResult } from "./update-checker";
import { OverwolfSource, type OverwolfPackages } from "./game/overwolf";
import { record } from "./game/recorder";
import { ReplaySource } from "./game/replay";
import { CS2_GAME_ID, type GameSource } from "./game/source";
import { SteamSource } from "./game/steam";
import { SirenIgnoreList, SIREN_IGNORE_FILE } from "./siren-ignore";
import type { CoplayResult } from "./steam/coplay";
import { FRIENDS_WINDOW_URL, FriendsWindowOpener } from "./steam/friends-window";
import { installGsiConfig, newGsiToken, readActiveSteamId, startGsiServer } from "./steam/gsi";
import { isCs2Running } from "./steam/process";
import { cefHint, detectCef, findCs2ConsoleLog, friendsHint, profileFallbackWanted, systemCefIo, systemConsoleLog, type CefCapability, type ConsoleLogCapability } from "./steam/capabilities";
import { MiniprofileStatus } from "./steam/miniprofile";
import { watchStatusBlocks } from "./steam/console-log";
import { FriendNameDirectory } from "./steam/friend-names";
import { findFriendsTarget, listDebugTargets, readFriendUi } from "./steam/steam-ui";

// Overwolf's overlay keeps the default hotkeys (none is bound in CS2 by default); the app's own overlay
// window uses the ones chosen in Settings.
// const HOTKEY = { label: DEFAULT_HOTKEYS.lobby, code: "F2", accelerator: DEFAULT_HOTKEYS.lobby };
// const DETAIL_HOTKEY = { label: DEFAULT_HOTKEYS.detail, code: "F7", accelerator: DEFAULT_HOTKEYS.detail };
// const CYCLE_HOTKEY = { label: DEFAULT_HOTKEYS.cycle, code: "F6", accelerator: DEFAULT_HOTKEYS.cycle };
// const PREVIOUS_HOTKEY = { label: DEFAULT_HOTKEYS.previous, code: "Shift+F6", accelerator: DEFAULT_HOTKEYS.previous };
const HOTKEY = OVERWOLF_HOTKEYS.lobby;
const DETAIL_HOTKEY = OVERWOLF_HOTKEYS.detail;
const CYCLE_HOTKEY = OVERWOLF_HOTKEYS.cycle;
const PREVIOUS_HOTKEY = OVERWOLF_HOTKEYS.previous;

const root = join(__dirname, "..", "..");
const rendererDir = join(root, "dist", "renderer");
const preload = join(__dirname, "preload.js");

function arg(name: string): string | true | undefined {
  for (const a of process.argv) {
    if (a === `--${name}`) return true;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

/** The OS keychain, as far as settings.json is concerned. */
const keychain: KeyCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
  decrypt: (base64) => safeStorage.decryptString(Buffer.from(base64, "base64")),
};

/** settings.json in the app's data folder (main/settings-file.ts). */
const settingsPath = () => join(app.getPath("userData"), "settings.json");

/** The API keys are encrypted with the OS keychain when available. */
function settingsStore(): SettingsStore {
  return settingsFileStore(settingsPath(), keychain);
}

function overwolfPackages(): OverwolfPackages | undefined {
  return (app as unknown as { overwolf?: { packages?: OverwolfPackages } }).overwolf?.packages;
}

const useOverwolf = !!arg("overwolf") && !arg("replay");

function gameSource(): GameSource {
  const replay = arg("replay");
  if (replay) {
    const file = typeof replay === "string" ? replay : join(root, "fixtures", "premier-mirage.jsonl");
    return ReplaySource.fromFile(file, { loopPauseMs: 15_000 });
  }
  const packages = overwolfPackages();
  if (useOverwolf && packages) return new OverwolfSource(packages);
  return steamSource();
}

/** A random token in <userData>/gsi.json, so only CS2 (reading our cfg file) can post game state. */
function gsiToken(): string {
  const file = join(app.getPath("userData"), "gsi.json");
  try {
    const t = JSON.parse(readFileSync(file, "utf8")).token;
    if (typeof t === "string" && t.length >= 16) return t;
  } catch {
    /* first start */
  }
  const token = newGsiToken();
  writeFileSync(file, JSON.stringify({ token }));
  return token;
}

/** The "open Steam's friends list for me" setting; the controller exists once the app is ready. */
const autoOpenFriendsList = (): boolean => controller?.state.autoOpenFriendsList ?? true;

// The Steam Web API key for matching `status` names to all friends is the controller's (the Settings key, else
// STEAM_API_KEY), asked each time so a key saved or removed in Settings counts at once, and the Steam ID the friends
// list is asked about. The directory keeps its answer per key and account.
let nameLocal: string | null = null;
const friendNameDirectory = new FriendNameDirectory(() => controller?.steamKey ?? null, () => nameLocal);

// One look at what Steam and CS2 allow, shared by the hint and the mini-profile fallback, at most every 10 seconds.
const miniprofile = new MiniprofileStatus();
let capsMemo: { at: number; sessionStartMs: number | null; value: Promise<{ cef: CefCapability; log: ConsoleLogCapability }> } | null = null;
function capabilities(sessionStartMs: number | null): Promise<{ cef: CefCapability; log: ConsoleLogCapability }> {
  if (!capsMemo || Date.now() - capsMemo.at > 10_000 || capsMemo.sessionStartMs !== sessionStartMs)
    capsMemo = { at: Date.now(), sessionStartMs, value: (async () => ({ cef: await detectCef(systemCefIo()), log: systemConsoleLog(sessionStartMs) }))() };
  return capsMemo.value;
}

function steamSource(): SteamSource {
  const token = gsiToken();
  let gsiProblem: string | null = null;
  try {
    const r = installGsiConfig(token);
    if (r.status === "not-found")
      gsiProblem = "Couldn't find CS2's folder, so the app can't tell when a match starts. It still reads Steam's players list.";
    else if (r.status === "installed")
      gsiProblem = "If CS2 is already running, restart it once so it loads CS2Clean's game-state file.";
  } catch (e) {
    gsiProblem = `Couldn't write CS2's game-state file: ${e instanceof Error ? e.message : e}`;
  }
  return new SteamSource({
    scan: scanCoplay,
    // Known before CS2's game-state feed says anything, and whether CS2 runs at all (a closed game has no match).
    localSteamId: readActiveSteamId,
    cs2Running: isCs2Running,
    // Friends in the same match are found through Steam's friends list when Steam was started with -cef-enable-debugging.
    uiStatus: () => readFriendUi(), // Steam's debug port, 8080
    // ... and Steam's friends list window is opened when it is closed (the "open it for me" setting), once when the app
    // starts and in a match's warm-up.
    friendsWindow: new FriendsWindowOpener({
      open: (url) => {
        if (url === FRIENDS_WINDOW_URL) return shell.openExternal(url);
      },
      windowState: async () => {
        const r = await listDebugTargets();
        return !r.ok ? "unreachable" : findFriendsTarget(r.targets) ? "open" : "closed";
      },
      enabled: autoOpenFriendsList,
    }),
    friendsListHint: async () => cefHint(await detectCef(systemCefIo()), autoOpenFriendsList()),
    // The user runs `status` in CS2's console (CS2 launched with -condebug): the players it lists are matched to friends.
    listenStatus: (onBlock) => {
      const path = findCs2ConsoleLog();
      if (!path) return () => {};
      const w = watchStatusBlocks(path, onBlock);
      return () => w.stop();
    },
    friendNames: (local) => {
      nameLocal = local;
      return friendNameDirectory.get();
    },
    // While friends are playing CS2 and the match has an empty slot, say what would find them.
    friendsHint: async (ctx) => friendsHint({ ...(await capabilities(ctx.sessionStartMs)), statusSeen: ctx.statusSeen, autoOpen: autoOpenFriendsList() }),
    // The fallback, only when neither Steam's debug port nor CS2's console.log is in use: friends on our map from their
    // Steam profile (up to ~10 minutes old), shown as a guess.
    friendStatus: (steamId) => miniprofile.get(steamId),
    profileFallback: async (ctx) => profileFallbackWanted({ ...(await capabilities(ctx.sessionStartMs)), nowMs: Date.now() }),
    listen: (onState) => {
      const server = startGsiServer(token, onState);
      return () => server.close();
    },
    gsiProblem,
  });
}

let coplayWorker: UtilityProcess | null = null;
let coplaySeq = 0;
const coplayPending = new Map<number, {
  resolve: (r: CoplayResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}>();

function ensureCoplayWorker(): UtilityProcess {
  if (coplayWorker) return coplayWorker;
  const child = utilityProcess.fork(join(__dirname, "steam", "coplay-worker.js"), [], { serviceName: "Steam players list" });
  child.on("message", (m: { id?: number; ok: boolean; result?: CoplayResult; error?: string }) => {
    const entry = typeof m.id === "number" ? coplayPending.get(m.id) : undefined;
    if (!entry) return;
    coplayPending.delete(m.id!);
    clearTimeout(entry.timer);
    if (m.ok && m.result) entry.resolve(m.result);
    else entry.reject(new Error(m.error ?? "Couldn't read Steam's players list."));
  });
  child.on("exit", (code) => {
    if (coplayWorker === child) coplayWorker = null;
    for (const [id, entry] of coplayPending) {
      coplayPending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error(`Reading Steam's players list failed (code ${code}).`));
    }
  });
  coplayWorker = child;
  return child;
}

function stopCoplayWorker(): void {
  if (!coplayWorker) return;
  const child = coplayWorker;
  coplayWorker = null;
  child.kill();
}

/** Reads Steam's players list in a persistent utility process (steam/coplay-worker.ts). */
function scanCoplay(localSteamId: string | null): Promise<CoplayResult> {
  return new Promise((resolve, reject) => {
    const id = ++coplaySeq;
    const child = ensureCoplayWorker();
    const timer = setTimeout(() => {
      coplayPending.delete(id);
      stopCoplayWorker(); // reset wedged worker
      reject(new Error("Steam didn't answer. Is Steam running and signed in?"));
    }, 10_000);
    coplayPending.set(id, { resolve, reject, timer });
    child.postMessage({ id, localSteamId });
  });
}

let desktop: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let waylandOverlay: WaylandLayerOverlay | null = null;
let controller: Controller;
/** The siren ignore list in the app's data folder (main/siren-ignore.ts); made when the app starts. */
let sirenIgnore: SirenIgnoreList | null = null;

function webPreferences() {
  return { preload, contextIsolation: true, sandbox: true, nodeIntegration: false };
}

function load(win: BrowserWindow, page: "index" | "overlay") {
  const dev = arg("dev-ui");
  if (typeof dev === "string") void win.loadURL(`${dev.replace(/\/$/, "")}/${page}.html`);
  else void win.loadFile(join(rendererDir, `${page}.html`));
}

function createDesktopWindow() {
  desktop = new BrowserWindow({
    width: 880, height: 680, minWidth: 640, minHeight: 520,
    title: "CS2Clean", backgroundColor: "#0d1014", show: false,
    icon: join(root, "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  // Started with Windows: sit in the taskbar instead of opening over whatever the user is doing.
  desktop.once("ready-to-show", () => (arg("minimized") ? desktop?.minimize() : desktop?.show()));
  desktop.on("closed", () => {
    desktop = null;
    app.quit(); // the overlay has no use without the app
  });
  lockNavigation(desktop);
  load(desktop, "index");
}

/** Opens only validated http(s) URLs in the user's browser. */
function openSafeExternal(raw: string): void {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && !app.isPackaged)) {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignore malformed URLs.
  }
}

/** Pages stay inside the app; links open in the user's browser. */
function lockNavigation(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

// ------------------------------------------------------------------ overlay

function setupOverlay(): AppState["overlay"] {
  const base = {
    hotkey: HOTKEY.label, detailHotkey: DETAIL_HOTKEY.label, cycleHotkey: CYCLE_HOTKEY.label, previousHotkey: PREVIOUS_HOTKEY.label,
    visible: false, view: "lobby" as const, focusSlot: null, siren: true,
    sirenVolume: 0.22, sirenThreshold: "high" as const, opacity: 0.92, scale: 1, autoHideOnLive: true,
  };
  const packages = overwolfPackages() as any;
  if (useOverwolf && packages) {
    // The overlay package arrives with 'ready'; until then (or without approval) there is no in-game overlay.
    if (packages.overlay) startOverwolfOverlay(packages.overlay);
    else packages.on("ready", (_e: unknown, name: string) => {
      if (name === "overlay") startOverwolfOverlay(packages.overlay);
    });
    return { ...base, mode: "overwolf" };
  }
  // Our own see-through window on top of the game, with global hotkeys (registered by the controller).
  app.whenReady().then(() => createOverlayWindow());
  return { ...base, mode: "window" };
}

/** Registers the overlay window's hotkeys system-wide; returns why not when one is taken. */
function applyHotkeys(h: Hotkeys): string | null {
  globalShortcut.unregisterAll();
  const keys = [h.lobby, h.detail, h.cycle, h.previous];
  const ok = [
    globalShortcut.register(h.lobby, () => controller?.toggleOverlay()),
    globalShortcut.register(h.detail, () => controller?.toggleDetail()),
    globalShortcut.register(h.cycle, () => controller?.cyclePlayer()),
    globalShortcut.register(h.previous, () => controller?.previousPlayer()),
  ];
  const taken = keys.filter((_, i) => !ok[i]);
  if (taken.length === 0) return null;
  globalShortcut.unregisterAll();
  return `${taken.join(" and ")} ${taken.length > 1 ? "are" : "is"} already used by another program. Pick another key.`;
}

function startOverwolfOverlay(overlayApi: any) {
  overlayApi.registerGames({ gamesIds: [CS2_GAME_ID] });
  overlayApi.on("game-launched", (event: { inject: () => void }, gameInfo: { classId?: number }) => {
    if (gameInfo?.classId === CS2_GAME_ID) event.inject();
  });
  overlayApi.on("game-injected", async () => {
    if (overlayWin && !overlayWin.isDestroyed()) return;
    const ow = await overlayApi.createWindow({
      name: "lobby",
      ...OVERLAY_SIZE,
      x: 24, y: 120,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      // Display only: mouse and keyboard keep going to the game.
      passthrough: "passThrough",
      zOrder: "topMost",
      dpiAware: true,
      webPreferences: webPreferences(),
    });
    overlayWin = ow.window;
    overlayWin!.on("closed", () => (overlayWin = null));
    load(overlayWin!, "overlay");
    syncOverlay();
  });
  overlayApi.on("game-exit", () => {
    overlayWin?.destroy();
    overlayWin = null;
    controller?.setOverlayVisible(false);
  });
  for (const [name, hk, fn] of [
    ["toggle-lobby", HOTKEY, () => controller?.toggleOverlay()],
    ["toggle-detail", DETAIL_HOTKEY, () => controller?.toggleDetail()],
    ["cycle-player", CYCLE_HOTKEY, () => controller?.cyclePlayer()],
    ["previous-player", PREVIOUS_HOTKEY, () => controller?.previousPlayer()],
  ] as const)
    overlayApi.hotkeys.register(
      { name, keyCode: hk.code, modifiers: { shift: hk.accelerator.startsWith("Shift+") }, passthrough: false },
      (_hk: unknown, state: string) => {
        if (state === "pressed") fn();
      },
    );
}

function waylandOverlayBinPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", "dist", "wayland-overlay")
    : join(root, "dist", "wayland-overlay");
}

/** Created hidden at start-up, so the siren can play before the overlay is shown. */
function createOverlayWindow(): BrowserWindow {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  const bounds = overlayBounds(screen.getPrimaryDisplay().workArea);
  const waylandBin = waylandOverlayBinPath();
  if (shouldUseWaylandLayerShell(process.env, process.platform, existsSync(waylandBin))) {
    overlayWin = new BrowserWindow({
      ...bounds,
      frame: false, transparent: true, show: false,
      webPreferences: { ...webPreferences(), offscreen: true, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
    });
    waylandOverlay = new WaylandLayerOverlay(waylandBin, bounds);
    overlayWin.webContents.setFrameRate(30);
    overlayWin.webContents.on("paint", (_e, _dirty, image) => {
      const { width, height } = image.getSize();
      waylandOverlay?.sendFrame(width, height, image.toBitmap());
    });
    overlayWin.on("closed", () => {
      overlayWin = null;
      waylandOverlay?.dispose();
      waylandOverlay = null;
    });
    lockNavigation(overlayWin);
    load(overlayWin, "overlay");
    return overlayWin;
  }

  overlayWin = new BrowserWindow({
    ...bounds,
    ...linuxOverlayWindowOptions(),
    frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { ...webPreferences(), backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  // Above a fullscreen-windowed game, and every click goes through to the game.
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  keepClickThrough(overlayWin);
  overlayWin.on("closed", () => (overlayWin = null));
  lockNavigation(overlayWin);
  load(overlayWin, "overlay");
  return overlayWin;
}

/** Shows or hides the overlay window to match the app state (hotkeys, warm-up, match going live). */
function syncOverlay() {
  if (!controller) return;
  const win = overlayWin && !overlayWin.isDestroyed() ? overlayWin : null;
  if (!win) return;
  const want = controller.state.overlay.visible;
  if (waylandOverlay) {
    if (want && !waylandOverlay.visible) waylandOverlay.show();
    else if (!want && waylandOverlay.visible) waylandOverlay.hide();
    return;
  }
  if (want && !win.isVisible()) {
    win.showInactive();
    keepOverlayPositionedAndOnTop(win, overlayBounds(screen.getPrimaryDisplay().workArea));
    keepClickThrough(win); // the window manager can undo it while it maps the window (main/click-through.ts)
  } else if (!want && win.isVisible()) win.hide();
}

// ------------------------------------------------------------------ app

/** Starting with Windows, minimized: a login item for the installed app or the extracted portable folder (Windows
 *  matches it by path and args, so a moved portable folder needs it switched off and on again). */
const STARTUP_ARGS = ["--minimized"];
const startup = {
  get: () => app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin,
  set: (on: boolean) => app.setLoginItemSettings({ openAtLogin: on, args: STARTUP_ARGS }),
};

/**
 * Asks GitHub for a newer release now and tells the window what it found. Only an answer from GitHub (a newer release,
 * or none) is noted in settings.json for the once-a-day limit: a check that failed, say with no network yet at
 * start-up, must not hold off the next one.
 */
async function checkUpdate(ctrl: Controller): Promise<UpdateResult> {
  const result = await checkForUpdate(ctrl.state.version);
  ctrl.setUpdateResult(result);
  if (result.status !== "failed") {
    try {
      noteUpdateCheck(settingsPath(), Date.now());
    } catch { /* ignore */ }
  }
  return result;
}

/** The check at start-up: at most once per day (stored in settings.json). */
async function checkUpdateOncePerDay(ctrl: Controller): Promise<void> {
  const lastCheck = readLastUpdateCheck(settingsPath());
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) return;
  await checkUpdate(ctrl);
}

// The portable zip keeps its data beside the exe (main/portable.ts). Electron wants the folders set before anything
// asks for them, and before the single-instance lock, which is per data folder.
const portableData = portableDataDir(dirname(process.execPath));
if (portableData && ensurePortableDataDir(portableData)) {
  app.setPath("userData", portableData);
  app.setPath("sessionData", portableData);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (desktop) {
      if (desktop.isMinimized()) desktop.restore();
      desktop.focus();
    }
  });

  const overlay = setupOverlay();

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const source = gameSource();
    if (arg("record")) console.log("recording to", record(source, join(app.getPath("userData"), "recordings")));
    // The csst.at fallback uses Electron's net.fetch (Chromium's network stack) in-process.
    configureHero({ fetchImpl: net.fetch.bind(net) as typeof fetch });
    sirenIgnore = new SirenIgnoreList(join(app.getPath("userData"), SIREN_IGNORE_FILE));
    sirenIgnore.ensureFile();
    controller = new Controller({
      version: app.getVersion(),
      source,
      store: settingsStore(),
      lobby: {
        cacheStore: playerCacheFileStore(join(app.getPath("userData"), "player-cache.json")),
      },
      envKey: process.env.LEETIFY_API_KEY?.trim() || null,
      steamApiKey: process.env.STEAM_API_KEY?.trim() || null,
      csrepApiKey: process.env.CSREP_API_KEY?.trim() || null,
      overlay,
      applyHotkeys: overlay.mode === "window" ? applyHotkeys : undefined,
      // Store (MSIX) installs can't add a plain login item, so they don't offer it.
      startup: app.isPackaged && process.platform === "win32" && !process.windowsStore ? startup : undefined,
      sirenIgnore: () => sirenIgnore!.ids(),
    });
    controller.on("state", (s) => {
      for (const w of [desktop, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send("state", s);
      syncOverlay();
    });

    ipcMain.handle("state:get", () => controller.state);
    ipcMain.handle("leetify:set-key", (_e, key: unknown) => (typeof key === "string" ? controller.setApiKey(key) : false));
    ipcMain.handle("leetify:clear-key", () => controller.clearApiKey());
    ipcMain.handle("hotkey:set", (_e, which: unknown, hotkey: unknown) =>
      (which === "lobby" || which === "detail" || which === "cycle" || which === "previous") && typeof hotkey === "string" ? controller.setHotkey(which, hotkey) : false);
    ipcMain.handle("hotkey:reset", () => controller.resetHotkeys());
    ipcMain.handle("startup:set", (_e, on: unknown) => controller.setStartWithWindows(on === true));
    ipcMain.handle("friends-window:set", (_e, on: unknown) => controller.setAutoOpenFriendsList(on === true));
    ipcMain.handle("hotkey:pause", (_e, paused: unknown) => {
      if (overlay.mode !== "window") return;
      if (paused === true) globalShortcut.unregisterAll();
      else {
        const o = controller.state.overlay;
        applyHotkeys({ lobby: o.hotkey, detail: o.detailHotkey, cycle: o.cycleHotkey, previous: o.previousHotkey });
      }
    });
    ipcMain.handle("overlay:toggle", () => controller.toggleOverlay());
    ipcMain.handle("overlay:detail", () => controller.toggleDetail());
    ipcMain.handle("overlay:cycle", () => controller.cyclePlayer());
    ipcMain.handle("overlay:previous", () => controller.previousPlayer());
    ipcMain.handle("siren:set", (_e, on: unknown) => controller.setSiren(on === true));
    ipcMain.handle("siren:set-volume", (_e, volume: unknown) => {
      if (typeof volume === "number") controller.setSirenVolume(volume);
    });
    ipcMain.handle("siren:set-threshold", (_e, threshold: unknown) => {
      if (threshold === "high" || threshold === "very_high") controller.setSirenThreshold(threshold);
    });
    ipcMain.handle("overlay:set-opacity", (_e, opacity: unknown) => {
      if (typeof opacity === "number") controller.setOverlayOpacity(opacity);
    });
    ipcMain.handle("overlay:set-scale", (_e, scale: unknown) => {
      if (typeof scale === "number") controller.setOverlayScale(scale);
    });
    ipcMain.handle("overlay:set-auto-hide", (_e, on: unknown) => controller.setAutoHideOnLive(on === true));
    ipcMain.handle("siren:test", () => controller.testSiren());
    ipcMain.handle("siren:open-ignore-list", async () => {
      if (!sirenIgnore) return;
      sirenIgnore.ensureFile(); // in case it was deleted
      const failed = await shell.openPath(sirenIgnore.file); // "" when a program took it; no program for .txt: show where it is
      if (failed) shell.showItemInFolder(sirenIgnore.file);
    });
    ipcMain.handle("player:open", (_e, steamId: unknown) => {
      const url = controller.playerUrl(String(steamId ?? ""));
      if (url) openSafeExternal(url);
    });
    ipcMain.handle("player:add", (_e, input: unknown) => (typeof input === "string" ? controller.addPlayer(input) : false));
    ipcMain.handle("player:remove", (_e, steamId: unknown) => { if (typeof steamId === "string") controller.removePlayer(steamId); });
    ipcMain.handle("leetify:open", () => {
      openSafeExternal("https://leetify.com/");
    });
    ipcMain.handle("leetify:developer", () => {
      openSafeExternal("https://leetify.com/app/developer");
    });
    ipcMain.handle("steam:set-key", (_e, key: unknown) =>
      (typeof key === "string" ? controller.setSteamApiKey(key) : false));
    ipcMain.handle("steam:clear-key", () => controller.clearSteamApiKey());
    ipcMain.handle("steam:open-developer", () => {
      openSafeExternal("https://steamcommunity.com/dev/apikey");
    });
    ipcMain.handle("csrep:set-key", (_e, key: unknown) =>
      (typeof key === "string" ? controller.setCsrepKey(key) : false));
    ipcMain.handle("csrep:clear-key", () => controller.clearCsrepKey());
    ipcMain.handle("csrep:open-player", (_e, steamId: unknown) => {
      const url = controller.csrepPlayerUrl(String(steamId ?? ""));
      if (url) openSafeExternal(url);
    });
    ipcMain.handle("csrep:open-docs", () => {
      openSafeExternal(CSREP_DOCS_URL);
    });
    ipcMain.handle("update:check", () => checkUpdate(controller));
    ipcMain.handle("update:open-releases", () => {
      openSafeExternal(`https://github.com/${OWNER}/${REPO}/releases`);
    });

    // The window follows the fallback's status, and a broken one shows up now, not at the first unknown player.
    onHeroStatus((s) => controller.setFallback(s));
    createDesktopWindow();
    controller.start();
    void checkHeroRuntime();
    // Check for updates: only once per day (stored in settings.json).
    void checkUpdateOncePerDay(controller);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    waylandOverlay?.dispose();
    waylandOverlay = null;
    stopCoplayWorker();
    controller?.stop();
  });
  app.on("window-all-closed", () => app.quit());
}
