// Host-side controller for the native Wayland wlr-layer-shell overlay helper (tools/wayland/wayland-overlay.c).
//
// On Wayland compositors (KDE KWin, Hyprland, Sway), regular xdg_toplevel windows cannot position
// themselves at (x, y) or stay above fullscreen games like `gamescope -f`. Rendering the overlay
// offscreen in Electron and forwarding BGRA frames to a zwlr_layer_surface_v1 (layer=OVERLAY,
// anchor=TOP|LEFT, empty input region) solves positioning, z-order, and click-through natively.

import { spawn, type ChildProcess } from "node:child_process";
import type { OverlayBounds } from "./overlay-window";

export const WAYLAND_CMD_FRAME = 1;
export const WAYLAND_CMD_SHOW = 2;
export const WAYLAND_CMD_HIDE = 3;
export const WAYLAND_CMD_QUIT = 4;

/** Encodes a 12-byte little-endian command header [cmd, width, height] for wayland-overlay. */
export function encodeWaylandCommand(cmd: number, width = 0, height = 0): Buffer {
  const buf = Buffer.allocUnsafe(12);
  buf.writeUInt32LE(cmd >>> 0, 0);
  buf.writeUInt32LE(width >>> 0, 4);
  buf.writeUInt32LE(height >>> 0, 8);
  return buf;
}

/** True when running on Linux under a Wayland session with the compiled wayland-overlay binary present. */
export function shouldUseWaylandLayerShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  helperExists = false,
): boolean {
  return platform === "linux" && Boolean(env.WAYLAND_DISPLAY) && helperExists;
}

export class WaylandLayerOverlay {
  private proc: ChildProcess | null = null;
  private _visible = false;
  private disposed = false;

  constructor(
    private readonly binPath: string,
    private readonly bounds: OverlayBounds,
    private readonly logError: (msg: string) => void = (msg) => console.error(msg),
  ) {
    this.proc = spawn(
      this.binPath,
      [
        "--x", String(this.bounds.x),
        "--y", String(this.bounds.y),
        "--width", String(this.bounds.width),
        "--height", String(this.bounds.height),
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.logError(`[wayland-overlay] ${text}`);
    });
    this.proc.on("exit", () => {
      this.proc = null;
    });
    this.proc.on("error", (err) => {
      this.logError(`[wayland-overlay] ${err.message}`);
      this.proc = null;
    });
  }

  get visible(): boolean {
    return this._visible;
  }

  /** Sends a BGRA frame (from Electron offscreen `paint` event) to the Wayland surface. */
  sendFrame(width: number, height: number, bgra: Buffer): void {
    if (this.disposed || !this.proc?.stdin?.writable) return;
    if (width <= 0 || height <= 0 || bgra.length !== width * height * 4) return;
    this.proc.stdin.write(encodeWaylandCommand(WAYLAND_CMD_FRAME, width, height));
    this.proc.stdin.write(bgra);
  }

  show(): void {
    if (this.disposed || this._visible) return;
    this._visible = true;
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(encodeWaylandCommand(WAYLAND_CMD_SHOW));
    }
  }

  hide(): void {
    if (this.disposed || !this._visible) return;
    this._visible = false;
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(encodeWaylandCommand(WAYLAND_CMD_HIDE));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._visible = false;
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    if (p.stdin?.writable) {
      try {
        p.stdin.end(encodeWaylandCommand(WAYLAND_CMD_QUIT));
      } catch {
        p.kill();
      }
    } else {
      p.kill();
    }
  }
}
