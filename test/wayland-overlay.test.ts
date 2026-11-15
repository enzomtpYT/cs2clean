import { describe, expect, it } from "vitest";
import {
  encodeWaylandCommand,
  shouldUseWaylandLayerShell,
  WAYLAND_CMD_FRAME,
  WAYLAND_CMD_HIDE,
  WAYLAND_CMD_QUIT,
  WAYLAND_CMD_SHOW,
} from "../src/main/wayland-overlay";

describe("wayland layer-shell overlay helpers", () => {
  it("enables layer-shell only on Linux with WAYLAND_DISPLAY and a built helper", () => {
    expect(shouldUseWaylandLayerShell({ WAYLAND_DISPLAY: "wayland-1" }, "linux", true)).toBe(true);
    expect(shouldUseWaylandLayerShell({ WAYLAND_DISPLAY: "wayland-1" }, "linux", false)).toBe(false);
    expect(shouldUseWaylandLayerShell({}, "linux", true)).toBe(false);
    expect(shouldUseWaylandLayerShell({ WAYLAND_DISPLAY: "wayland-1" }, "win32", true)).toBe(false);
    expect(shouldUseWaylandLayerShell({ WAYLAND_DISPLAY: "wayland-1" }, "darwin", true)).toBe(false);
  });

  it("encodes 12-byte little-endian command headers", () => {
    const frameHdr = encodeWaylandCommand(WAYLAND_CMD_FRAME, 380, 640);
    expect(frameHdr.length).toBe(12);
    expect(frameHdr.readUInt32LE(0)).toBe(WAYLAND_CMD_FRAME);
    expect(frameHdr.readUInt32LE(4)).toBe(380);
    expect(frameHdr.readUInt32LE(8)).toBe(640);

    for (const cmd of [WAYLAND_CMD_SHOW, WAYLAND_CMD_HIDE, WAYLAND_CMD_QUIT]) {
      const hdr = encodeWaylandCommand(cmd);
      expect(hdr.readUInt32LE(0)).toBe(cmd);
      expect(hdr.readUInt32LE(4)).toBe(0);
      expect(hdr.readUInt32LE(8)).toBe(0);
    }
  });
});
