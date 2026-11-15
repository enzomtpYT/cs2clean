// The only bridge between the windows and the main process. Pages get these calls and nothing else
// (no Node, no API key).

import { contextBridge, ipcRenderer } from "electron";
import type { AppState, Bridge } from "../shared/types";

const bridge: Bridge = {
  getState: () => ipcRenderer.invoke("state:get"),
  onState(listener) {
    const handler = (_e: unknown, s: AppState) => listener(s);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
  setApiKey: (key) => ipcRenderer.invoke("leetify:set-key", key),
  clearApiKey: () => ipcRenderer.invoke("leetify:clear-key"),
  setHotkey: (which, hotkey) => ipcRenderer.invoke("hotkey:set", which, hotkey),
  resetHotkeys: () => ipcRenderer.invoke("hotkey:reset"),
  setStartWithWindows: (on) => ipcRenderer.invoke("startup:set", on),
  setAutoOpenFriendsList: (on) => ipcRenderer.invoke("friends-window:set", on),
  pauseHotkeys: (paused) => ipcRenderer.invoke("hotkey:pause", paused),
  toggleOverlay: () => ipcRenderer.invoke("overlay:toggle"),
  toggleDetail: () => ipcRenderer.invoke("overlay:detail"),
  cyclePlayer: () => ipcRenderer.invoke("overlay:cycle"),
  previousPlayer: () => ipcRenderer.invoke("overlay:previous"),
  setSiren: (on) => ipcRenderer.invoke("siren:set", on),
  setSirenVolume: (volume) => ipcRenderer.invoke("siren:set-volume", volume),
  setSirenThreshold: (threshold) => ipcRenderer.invoke("siren:set-threshold", threshold),
  setOverlayOpacity: (opacity) => ipcRenderer.invoke("overlay:set-opacity", opacity),
  setOverlayScale: (scale) => ipcRenderer.invoke("overlay:set-scale", scale),
  setAutoHideOnLive: (on) => ipcRenderer.invoke("overlay:set-auto-hide", on),
  testSiren: () => ipcRenderer.invoke("siren:test"),
  openSirenIgnoreList: () => ipcRenderer.invoke("siren:open-ignore-list"),
  openPlayer: (steamId) => ipcRenderer.invoke("player:open", steamId),
  addPlayer: (input) => ipcRenderer.invoke("player:add", input),
  removePlayer: (steamId) => ipcRenderer.invoke("player:remove", steamId),
  openLeetify: () => ipcRenderer.invoke("leetify:open"),
  openDeveloperPage: () => ipcRenderer.invoke("leetify:developer"),
  openSteamDeveloper: () => ipcRenderer.invoke("steam:open-developer"),
  setSteamApiKey: (key) => ipcRenderer.invoke("steam:set-key", key),
  clearSteamApiKey: () => ipcRenderer.invoke("steam:clear-key"),
  setFlaresolverrUrl: (url) => ipcRenderer.invoke("csrep:set-proxy", url),
  clearFlaresolverrUrl: () => ipcRenderer.invoke("csrep:clear-proxy"),
  openCsrepPlayer: (steamId) => ipcRenderer.invoke("csrep:open-player", steamId),
  setFaceitApiKey: (key) => ipcRenderer.invoke("faceit:set-key", key),
  clearFaceitApiKey: () => ipcRenderer.invoke("faceit:clear-key"),
  openFaceitDeveloper: () => ipcRenderer.invoke("faceit:open-developer"),
  updateCheck: () => ipcRenderer.invoke("update:check"),
  openReleases: () => ipcRenderer.invoke("update:open-releases"),
};

contextBridge.exposeInMainWorld("cs2clean", bridge);
