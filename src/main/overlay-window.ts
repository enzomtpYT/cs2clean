// Overlay window geometry, type, and z-order helpers for Linux (XWayland / KWin).
//
// On KDE Plasma Wayland, normal `xdg_toplevel` windows ignore client-requested (x, y) coordinates
// and `alwaysOnTop`, and even XWayland `alwaysOnTop` windows sit below fullscreen `gamescope -f`.
// Using X11 `_NET_WM_WINDOW_TYPE_NOTIFICATION` (`type: "notification"`) and re-applying bounds and
// z-order after mapping keeps the overlay at top-left and above fullscreen windows.

export const OVERLAY_SIZE = { width: 380, height: 640 };
export const OVERLAY_OFFSET = { x: 24, y: 120 };

/** Delays (in ms) after showInactive() to re-apply bounds and always-on-top while the WM maps the window. */
export const OVERLAY_SETTLE_RETRIES_MS = [50, 150, 400];

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayWindowTarget {
  setBounds(bounds: OverlayBounds): void;
  setAlwaysOnTop(flag: boolean, level?: "normal" | "floating" | "torn-off-menu" | "modal-panel" | "main-menu" | "status" | "pop-up-menu" | "screen-saver"): void;
  moveTop(): void;
  isDestroyed(): boolean;
}

/** Computes the top-left overlay bounds relative to the display work area. */
export function overlayBounds(workArea: { x: number; y: number }): OverlayBounds {
  return {
    x: workArea.x + OVERLAY_OFFSET.x,
    y: workArea.y + OVERLAY_OFFSET.y,
    ...OVERLAY_SIZE,
  };
}

/** Extra BrowserWindow options for Linux so KWin places the overlay in NotificationLayer and honors (x, y). */
export function linuxOverlayWindowOptions(platform: string = process.platform): { type?: "notification" } {
  return platform === "linux" ? { type: "notification" } : {};
}

/** Applies overlay bounds and always-on-top now, and on Linux repeats shortly after showInactive() settles. */
export function keepOverlayPositionedAndOnTop(
  win: OverlayWindowTarget,
  bounds: OverlayBounds,
  platform: string = process.platform,
  later: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  const apply = () => {
    if (win.isDestroyed()) return;
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, "screen-saver");
    win.moveTop();
  };
  apply();
  if (platform !== "linux") return;
  for (const ms of OVERLAY_SETTLE_RETRIES_MS) {
    later(apply, ms);
  }
}
