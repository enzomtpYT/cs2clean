import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  keepOverlayPositionedAndOnTop,
  linuxOverlayWindowOptions,
  OVERLAY_OFFSET,
  OVERLAY_SETTLE_RETRIES_MS,
  OVERLAY_SIZE,
  overlayBounds,
} from "../src/main/overlay-window";

function fakeOverlayWindow() {
  const w = {
    destroyed: false,
    setBounds: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
    isDestroyed: () => w.destroyed,
  };
  return w;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("overlay window bounds and Linux options", () => {
  it("positions the overlay at top-left offset from workArea", () => {
    expect(overlayBounds({ x: 0, y: 0 })).toEqual({
      x: OVERLAY_OFFSET.x,
      y: OVERLAY_OFFSET.y,
      ...OVERLAY_SIZE,
    });
    expect(overlayBounds({ x: 1920, y: 32 })).toEqual({
      x: 1920 + OVERLAY_OFFSET.x,
      y: 32 + OVERLAY_OFFSET.y,
      ...OVERLAY_SIZE,
    });
  });

  it("uses notification window type on Linux only", () => {
    expect(linuxOverlayWindowOptions("linux")).toEqual({ type: "notification" });
    expect(linuxOverlayWindowOptions("win32")).toEqual({});
    expect(linuxOverlayWindowOptions("darwin")).toEqual({});
  });
});

describe("keeping the overlay positioned and on top", () => {
  it("applies bounds, screen-saver alwaysOnTop, and moveTop at once", () => {
    const w = fakeOverlayWindow();
    const bounds = overlayBounds({ x: 0, y: 0 });
    keepOverlayPositionedAndOnTop(w, bounds, "linux");
    expect(w.setBounds).toHaveBeenCalledTimes(1);
    expect(w.setBounds).toHaveBeenCalledWith(bounds);
    expect(w.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(w.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(w.moveTop).toHaveBeenCalledTimes(1);
  });

  it("retries positioning and z-order on Linux after showInactive settles", () => {
    const w = fakeOverlayWindow();
    const bounds = overlayBounds({ x: 0, y: 0 });
    keepOverlayPositionedAndOnTop(w, bounds, "linux");
    let elapsed = 0;
    OVERLAY_SETTLE_RETRIES_MS.forEach((ms, i) => {
      vi.advanceTimersByTime(ms - elapsed - 1);
      expect(w.setBounds).toHaveBeenCalledTimes(1 + i);
      vi.advanceTimersByTime(1);
      expect(w.setBounds).toHaveBeenCalledTimes(2 + i);
      expect(w.setAlwaysOnTop).toHaveBeenCalledTimes(2 + i);
      expect(w.moveTop).toHaveBeenCalledTimes(2 + i);
      elapsed = ms;
    });
  });

  it("only applies once on Windows and macOS", () => {
    const bounds = overlayBounds({ x: 0, y: 0 });
    for (const platform of ["win32", "darwin"]) {
      const w = fakeOverlayWindow();
      keepOverlayPositionedAndOnTop(w, bounds, platform);
      vi.runAllTimers();
      expect(w.setBounds).toHaveBeenCalledTimes(1);
      expect(w.setAlwaysOnTop).toHaveBeenCalledTimes(1);
      expect(w.moveTop).toHaveBeenCalledTimes(1);
    }
  });

  it("stops quietly once the window is destroyed", () => {
    const w = fakeOverlayWindow();
    const bounds = overlayBounds({ x: 0, y: 0 });
    keepOverlayPositionedAndOnTop(w, bounds, "linux");
    vi.advanceTimersByTime(OVERLAY_SETTLE_RETRIES_MS[0]);
    w.destroyed = true;
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(w.setBounds.mock.calls.length).toBeLessThan(1 + OVERLAY_SETTLE_RETRIES_MS.length);
  });
});
