import { useState } from "react";
import {
  Bell,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Sun,
  Volume2,
} from "lucide-react";
import type { AppState, SirenThreshold } from "../../shared/types";
import { bridge } from "../bridge";
import { THEME_PRESETS, type ThemeMode, type ThemePresetId, type ThemeState } from "../theme";

interface SettingsViewProps {
  s: AppState;
  theme: ThemeState;
}

export function SettingsView({ s, theme }: SettingsViewProps) {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  const handleCheckUpdates = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      const result = await bridge.updateCheck();
      if (result.status === "current") {
        setUpdateMsg({ tone: "ok", text: `You are on the latest version (${s.version}).` });
      } else if (result.status === "available") {
        setUpdateMsg({ tone: "info", text: `Update available: ${result.remoteVersion}` });
      } else {
        setUpdateMsg({ tone: "error", text: `Could not check for updates: ${result.reason}.` });
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const activePreset = THEME_PRESETS[theme.preset];
  const effectiveAccent = theme.customAccent ?? activePreset.accent;

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              <Palette size={15} />
              <span>Appearance</span>
            </h2>
            <p className="panel-desc">Customize the desktop app theme, accent color, and layout density.</p>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Color Mode</div>
            <div className="setting-hint">Switch between dark, light, or follow your OS preference.</div>
          </div>
          <div className="segmented" role="group" aria-label="Color mode">
            {(
              [
                { id: "dark", label: "Dark", icon: Moon },
                { id: "light", label: "Light", icon: Sun },
                { id: "system", label: "System", icon: Monitor },
              ] as Array<{ id: ThemeMode; label: string; icon: typeof Moon }>
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`segmented-btn${theme.mode === id ? " active" : ""}`}
                onClick={() => theme.setMode(id)}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <div className="setting-info">
            <div className="setting-label">Theme Preset</div>
            <div className="setting-hint">Choose a surface & accent palette.</div>
          </div>
          <div className="preset-grid">
            {(Object.keys(THEME_PRESETS) as ThemePresetId[]).map((id) => {
              const p = THEME_PRESETS[id];
              const isSelected = theme.preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`preset-card${isSelected ? " active" : ""}`}
                  onClick={() => theme.setPreset(id)}
                >
                  <span className="preset-swatch" style={{ background: p.accent }} />
                  <span className="preset-name">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Custom Accent Color</div>
            <div className="setting-hint">Override the active preset's accent color.</div>
          </div>
          <div className="row">
            <input
              type="color"
              value={effectiveAccent}
              onChange={(e) => theme.setCustomAccent(e.target.value)}
              aria-label="Custom accent color"
              style={{ width: 34, height: 28, padding: 2, borderRadius: 6, border: "1px solid var(--theme-border-strong)", background: "var(--theme-bg-base)", cursor: "pointer" }}
            />
            <span className="xs muted tabular-nums" style={{ fontFamily: "ui-monospace, monospace" }}>
              {effectiveAccent.toUpperCase()}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!theme.customAccent}
              onClick={() => theme.setCustomAccent(null)}
              title="Reset to preset accent"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Layout Density</div>
            <div className="setting-hint">Compact tightens padding in the lobby list and settings panels.</div>
          </div>
          <div className="segmented" role="group" aria-label="Layout density">
            <button
              type="button"
              className={`segmented-btn${theme.density === "comfortable" ? " active" : ""}`}
              onClick={() => theme.setDensity("comfortable")}
            >
              Comfortable
            </button>
            <button
              type="button"
              className={`segmented-btn${theme.density === "compact" ? " active" : ""}`}
              onClick={() => theme.setDensity("compact")}
            >
              Compact
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              <Bell size={15} />
              <span>Siren & Alerts</span>
            </h2>
            <p className="panel-desc">Audio alert when a flagged player is detected in your match.</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => void bridge.testSiren()}>
              <Volume2 size={13} />
              <span>Test Siren</span>
            </button>
            <button
              type="button"
              className="btn btn-sm"
              title="Players listed in siren-ignore.txt never trigger the siren (one SteamID per line)"
              onClick={() => void bridge.openSirenIgnoreList()}
            >
              <FileText size={13} />
              <span>Ignore List</span>
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Enable Match Siren</div>
            <div className="setting-hint">Plays a short two-tone alert once per flagged player per match.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.overlay.siren}
            className="switch"
            onClick={() => void bridge.setSiren(!s.overlay.siren)}
          >
            <span className="switch-thumb" />
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Siren Volume</div>
            <div className="setting-hint">Adjusts playback gain for both alerts and the test button.</div>
          </div>
          <div className="slider-wrap">
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={2}
              value={Math.round(s.overlay.sirenVolume * 100)}
              onChange={(e) => void bridge.setSirenVolume(Number(e.target.value) / 100)}
            />
            <span className="slider-val">{Math.round(s.overlay.sirenVolume * 100)}%</span>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Alert Threshold</div>
            <div className="setting-hint">Choose which evidence classes trigger the siren.</div>
          </div>
          <div className="segmented" role="group" aria-label="Siren threshold">
            {(
              [
                { id: "high", label: "High & Very High" },
                { id: "very_high", label: "Very High Only" },
              ] as Array<{ id: SirenThreshold; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`segmented-btn${s.overlay.sirenThreshold === opt.id ? " active" : ""}`}
                onClick={() => void bridge.setSirenThreshold(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {(s.startWithWindows !== null || s.game.source === "steam") && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">System & Steam Integration</h2>
              <p className="panel-desc">Startup and lobby discovery behavior.</p>
            </div>
          </div>

          {s.startWithWindows !== null && (
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-label">Start automatically with Windows</div>
                <div className="setting-hint">Launches CS2Clean minimized to the taskbar on sign-in.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.startWithWindows}
                className="switch"
                onClick={() => void bridge.setStartWithWindows(!s.startWithWindows)}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          )}

          {s.game.source === "steam" && (
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-label">Auto-open Steam friends list</div>
                <div className="setting-hint">
                  Opens Steam's friends list when closed so friends in your match can be detected (requires Steam debug
                  port).
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.autoOpenFriendsList}
                className="switch"
                onClick={() => void bridge.setAutoOpenFriendsList(!s.autoOpenFriendsList)}
              >
                <span className="switch-thumb" />
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Updates & About</h2>
            <p className="panel-desc">
              CS2Clean version <strong className="tabular-nums">{s.version}</strong>
            </p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={checkingUpdate}
              onClick={() => void handleCheckUpdates()}
            >
              {checkingUpdate ? <Loader2 size={13} /> : <RefreshCw size={13} />}
              <span>{checkingUpdate ? "Checking…" : "Check for updates"}</span>
            </button>
            {s.update.available && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void bridge.openReleases()}>
                <Download size={13} />
                <span>Download {s.update.remoteVersion}</span>
              </button>
            )}
          </div>
        </div>

        {updateMsg && (
          <div className={`banner ${updateMsg.tone}`} style={{ marginTop: 8 }}>
            <div className="banner-body">
              {updateMsg.tone === "ok" ? (
                <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              ) : (
                <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              )}
              <span>{updateMsg.text}</span>
            </div>
            {updateMsg.tone === "info" && (
              <button type="button" className="btn btn-xs btn-primary" onClick={() => void bridge.openReleases()}>
                <ExternalLink size={12} />
                <span>Releases</span>
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
