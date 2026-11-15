import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type ThemePresetId = "obsidian" | "amber" | "plum" | "midnight";
export type UiDensity = "comfortable" | "compact";

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  accent: string;
  accentInk: string;
  dark: {
    base: string;
    surface: string;
    elevated: string;
    subtle: string;
    edge: string;
    edgeStrong: string;
  };
  light: {
    base: string;
    surface: string;
    elevated: string;
    subtle: string;
    edge: string;
    edgeStrong: string;
  };
}

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  obsidian: {
    id: "obsidian",
    name: "Obsidian Slate",
    description: "Neutral obsidian surfaces with crisp contrast",
    accent: "#3b82f6",
    accentInk: "#ffffff",
    dark: {
      base: "#0b0c0f",
      surface: "#121419",
      elevated: "#191c23",
      subtle: "#222630",
      edge: "#252933",
      edgeStrong: "#363c4b",
    },
    light: {
      base: "#f6f7f9",
      surface: "#ffffff",
      elevated: "#eff1f5",
      subtle: "#e3e6ee",
      edge: "#dcdfe7",
      edgeStrong: "#c1c7d4",
    },
  },
  amber: {
    id: "amber",
    name: "CS2 Amber",
    description: "Tactical dark charcoal with warm amber accent",
    accent: "#f0a13a",
    accentInk: "#1a1206",
    dark: {
      base: "#0d1014",
      surface: "#12161c",
      elevated: "#171c23",
      subtle: "#1e242e",
      edge: "#252c37",
      edgeStrong: "#353f4e",
    },
    light: {
      base: "#f7f6f4",
      surface: "#ffffff",
      elevated: "#f1efe9",
      subtle: "#e6e2d8",
      edge: "#ded9cd",
      edgeStrong: "#c4bdad",
    },
  },
  plum: {
    id: "plum",
    name: "ImgSniffr Plum",
    description: "Deep obsidian plum with vibrant magenta accent",
    accent: "#d53299",
    accentInk: "#ffffff",
    dark: {
      base: "#0b0a0d",
      surface: "#121016",
      elevated: "#1a1720",
      subtle: "#24202c",
      edge: "#27232f",
      edgeStrong: "#3a3446",
    },
    light: {
      base: "#f7f6f9",
      surface: "#ffffff",
      elevated: "#f1eff5",
      subtle: "#e6e2ec",
      edge: "#ded9e6",
      edgeStrong: "#c5bdd1",
    },
  },
  midnight: {
    id: "midnight",
    name: "Midnight Cyan",
    description: "Cool slate surfaces with sharp cyan highlight",
    accent: "#06b6d4",
    accentInk: "#041c22",
    dark: {
      base: "#090d12",
      surface: "#0f151d",
      elevated: "#161e29",
      subtle: "#1e2937",
      edge: "#222e3d",
      edgeStrong: "#334459",
    },
    light: {
      base: "#f4f7fa",
      surface: "#ffffff",
      elevated: "#eaf0f6",
      subtle: "#dce5ef",
      edge: "#d2dde9",
      edgeStrong: "#b3c4d6",
    },
  },
};

const STORAGE_MODE = "cs2clean.theme.mode";
const STORAGE_PRESET = "cs2clean.theme.preset";
const STORAGE_ACCENT = "cs2clean.theme.customAccent";
const STORAGE_DENSITY = "cs2clean.theme.density";

function readStorage<T extends string>(key: string, fallback: T, valid?: readonly T[]): T {
  try {
    const val = localStorage.getItem(key);
    if (!val) return fallback;
    if (valid && !valid.includes(val as T)) return fallback;
    return val as T;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, val: string | null): void {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {
    /* ignore storage errors */
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function contrastInk(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#111318" : "#ffffff";
}

function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyThemeToDocument(
  mode: ThemeMode,
  presetId: ThemePresetId,
  customAccent: string | null,
  density: UiDensity,
): void {
  if (typeof document === "undefined") return;
  const resolved = resolveMode(mode);
  const preset = THEME_PRESETS[presetId] ?? THEME_PRESETS.obsidian;
  const palette = resolved === "light" ? preset.light : preset.dark;
  const accent = customAccent && hexToRgb(customAccent) ? customAccent : preset.accent;
  const accentRgb = hexToRgb(accent) ?? [59, 130, 246];
  const accentInk = customAccent && hexToRgb(customAccent) ? contrastInk(accent) : preset.accentInk;

  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-density", density);
  root.style.setProperty("--theme-bg-base", palette.base);
  root.style.setProperty("--theme-bg-surface", palette.surface);
  root.style.setProperty("--theme-bg-elevated", palette.elevated);
  root.style.setProperty("--theme-bg-subtle", palette.subtle);
  root.style.setProperty("--theme-border-subtle", palette.edge);
  root.style.setProperty("--theme-border-strong", palette.edgeStrong);
  root.style.setProperty("--theme-accent", accent);
  root.style.setProperty("--theme-accent-ink", accentInk);
  root.style.setProperty("--theme-accent-soft", `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, ${resolved === "light" ? 0.11 : 0.15})`);
}

export interface ThemeState {
  mode: ThemeMode;
  preset: ThemePresetId;
  customAccent: string | null;
  density: UiDensity;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
  setPreset: (preset: ThemePresetId) => void;
  setCustomAccent: (hex: string | null) => void;
  setDensity: (density: UiDensity) => void;
}

export function useTheme(): ThemeState {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readStorage<ThemeMode>(STORAGE_MODE, "dark", ["dark", "light", "system"]),
  );
  const [preset, setPresetState] = useState<ThemePresetId>(() =>
    readStorage<ThemePresetId>(STORAGE_PRESET, "obsidian", ["obsidian", "amber", "plum", "midnight"]),
  );
  const [customAccent, setCustomAccentState] = useState<string | null>(() => {
    try {
      const v = localStorage.getItem(STORAGE_ACCENT);
      return v && hexToRgb(v) ? v : null;
    } catch {
      return null;
    }
  });
  const [density, setDensityState] = useState<UiDensity>(() =>
    readStorage<UiDensity>(STORAGE_DENSITY, "comfortable", ["comfortable", "compact"]),
  );

  useEffect(() => {
    applyThemeToDocument(mode, preset, customAccent, density);
  }, [mode, preset, customAccent, density]);

  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyThemeToDocument("system", preset, customAccent, density);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, preset, customAccent, density]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    writeStorage(STORAGE_MODE, m);
  }, []);

  const cycleMode = useCallback(() => {
    const order: ThemeMode[] = ["dark", "light", "system"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
  }, [mode, setMode]);

  const setPreset = useCallback((p: ThemePresetId) => {
    setPresetState(p);
    writeStorage(STORAGE_PRESET, p);
  }, []);

  const setCustomAccent = useCallback((hex: string | null) => {
    const clean = hex && hexToRgb(hex) ? hex : null;
    setCustomAccentState(clean);
    writeStorage(STORAGE_ACCENT, clean);
  }, []);

  const setDensity = useCallback((d: UiDensity) => {
    setDensityState(d);
    writeStorage(STORAGE_DENSITY, d);
  }, []);

  return { mode, preset, customAccent, density, setMode, cycleMode, setPreset, setCustomAccent, setDensity };
}
