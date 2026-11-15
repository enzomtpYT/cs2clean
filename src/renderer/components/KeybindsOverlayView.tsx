import { useState } from "react";
import { AlertCircle, Info, Keyboard, Layers, RotateCcw } from "lucide-react";
import { DEFAULT_HOTKEYS, hotkeyFromEvent, hotkeyProblem, type HotkeyName } from "../../shared/hotkeys";
import type { AppState } from "../../shared/types";
import { bridge } from "../bridge";

const HOTKEY_META: Array<{ which: HotkeyName; label: string; description: string }> = [
  {
    which: "lobby",
    label: "Toggle player list",
    description: "Show or hide the main lobby overlay in-game.",
  },
  {
    which: "detail",
    label: "Flagged player details",
    description: "Show extended stat cards for High / Very High players.",
  },
  {
    which: "cycle",
    label: "Next player card",
    description: "Step forward through every player's card one at a time.",
  },
  {
    which: "previous",
    label: "Previous player card",
    description: "Step backward through player cards.",
  },
];

const SCALE_OPTIONS = [
  { label: "85%", value: 0.85 },
  { label: "100%", value: 1 },
  { label: "110%", value: 1.1 },
  { label: "125%", value: 1.25 },
];

export function KeybindsOverlayView({ s }: { s: AppState }) {
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  const values: Record<HotkeyName, string> = {
    lobby: s.overlay.hotkey,
    detail: s.overlay.detailHotkey,
    cycle: s.overlay.cycleHotkey,
    previous: s.overlay.previousHotkey,
  };

  const anyModified = HOTKEY_META.some(({ which }) => values[which] !== DEFAULT_HOTKEYS[which]);

  const handleAssign = async (which: HotkeyName, hotkey: string) => {
    const problem = hotkeyProblem(hotkey);
    if (problem) {
      setHotkeyError(problem);
      return;
    }
    const ok = await bridge.setHotkey(which, hotkey);
    if (!ok) {
      setHotkeyError(`Could not bind ${hotkey} — it may already be used by another action or application.`);
    } else {
      setHotkeyError(null);
    }
  };

  const handleResetOne = async (which: HotkeyName) => {
    const ok = await bridge.setHotkey(which, DEFAULT_HOTKEYS[which]);
    if (!ok) {
      setHotkeyError(`Could not reset to ${DEFAULT_HOTKEYS[which]} because another action is currently using it.`);
    } else {
      setHotkeyError(null);
    }
  };

  const handleResetAll = async () => {
    setHotkeyError(null);
    await bridge.resetHotkeys();
  };

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              <Keyboard size={15} />
              <span>Overlay Keybinds</span>
            </h2>
            <p className="panel-desc">
              {s.hotkeysEditable
                ? "Click any keybind and press a new key combination (Esc cancels). While CS2Clean runs, these keys are captured globally."
                : "Hotkeys are managed by Overwolf in this mode."}
            </p>
          </div>

          {s.hotkeysEditable && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={!anyModified}
              onClick={() => void handleResetAll()}
              title="Reset all keybinds to defaults"
            >
              <RotateCcw size={13} />
              <span>Reset all</span>
            </button>
          )}
        </div>

        {hotkeyError && (
          <div className="banner error" style={{ marginBottom: 10 }}>
            <div className="banner-body">
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{hotkeyError}</span>
            </div>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => setHotkeyError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="hotkey-list">
          {HOTKEY_META.map(({ which, label, description }) => (
            <HotkeyRow
              key={which}
              label={label}
              description={description}
              value={values[which]}
              defaultValue={DEFAULT_HOTKEYS[which]}
              editable={s.hotkeysEditable}
              onAssign={(hk) => void handleAssign(which, hk)}
              onReset={() => void handleResetOne(which)}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">
              <Layers size={15} />
              <span>Overlay Appearance & Behavior</span>
            </h2>
            <p className="panel-desc">
              Customize how the in-game overlay looks and when it automatically hides.
            </p>
          </div>

          {s.overlay.mode === "window" && (
            <button
              type="button"
              className={`btn btn-sm ${s.overlay.visible ? "btn-primary" : ""}`}
              onClick={() => void bridge.toggleOverlay()}
            >
              <Layers size={13} />
              <span>{s.overlay.visible ? "Hide Overlay" : "Show Overlay"}</span>
            </button>
          )}
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Overlay Opacity</div>
            <div className="setting-hint">Adjust background transparency of the in-game overlay window.</div>
          </div>
          <div className="slider-wrap">
            <input
              className="slider"
              type="range"
              min={55}
              max={100}
              step={1}
              value={Math.round(s.overlay.opacity * 100)}
              onChange={(e) => void bridge.setOverlayOpacity(Number(e.target.value) / 100)}
            />
            <span className="slider-val">{Math.round(s.overlay.opacity * 100)}%</span>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Overlay UI Scale</div>
            <div className="setting-hint">Scale text, badges, and player cards inside the overlay.</div>
          </div>
          <div className="segmented" role="group" aria-label="Overlay UI scale">
            {SCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`segmented-btn${Math.abs(s.overlay.scale - opt.value) < 0.02 ? " active" : ""}`}
                onClick={() => void bridge.setOverlayScale(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <div className="setting-label">Auto-hide when match goes live</div>
            <div className="setting-hint">
              Automatically dismisses the overlay when warm-up ends. You can always bring it back with{" "}
              <kbd>{s.overlay.hotkey}</kbd>.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.overlay.autoHideOnLive}
            className="switch"
            onClick={() => void bridge.setAutoHideOnLive(!s.overlay.autoHideOnLive)}
          >
            <span className="switch-thumb" />
          </button>
        </div>

        {s.overlay.mode === "window" && (
          <div className="banner info" style={{ marginTop: 12 }}>
            <div className="banner-body">
              <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                The overlay sits on top of CS2 when the game's display mode is <strong>Fullscreen Windowed</strong>{" "}
                (Video settings). In exclusive Fullscreen, the OS draws the game over it.
              </span>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

interface HotkeyRowProps {
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  editable: boolean;
  onAssign: (hotkey: string) => void;
  onReset: () => void;
}

function HotkeyRow({ label, description, value, defaultValue, editable, onAssign, onReset }: HotkeyRowProps) {
  const [listening, setListening] = useState(false);
  const isModified = value !== defaultValue;

  const stop = () => {
    setListening(false);
    void bridge.pauseHotkeys(false);
  };

  return (
    <div className="hotkey-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        <div className="setting-hint">
          {description} Default: <kbd>{defaultValue}</kbd>
        </div>
      </div>

      <div className="hotkey-controls">
        {editable ? (
          <>
            <button
              type="button"
              className={`hotkey-btn${listening ? " listening" : ""}`}
              onClick={() => {
                if (listening) return stop();
                setListening(true);
                void bridge.pauseHotkeys(true);
              }}
              onBlur={() => listening && stop()}
              onKeyDown={(e) => {
                if (!listening) return;
                e.preventDefault();
                if (e.key === "Escape") return stop();
                const hotkey = hotkeyFromEvent(e);
                if (!hotkey) return;
                setListening(false);
                void bridge.pauseHotkeys(false);
                onAssign(hotkey);
              }}
              title="Click to record a new keybind"
            >
              {listening ? "Press a key…" : <kbd>{value}</kbd>}
            </button>

            <button
              type="button"
              className="btn btn-sm"
              disabled={!isModified}
              onClick={onReset}
              title={isModified ? `Reset to ${defaultValue}` : "Already at default"}
              aria-label={`Reset ${label} to ${defaultValue}`}
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </>
        ) : (
          <kbd>{value}</kbd>
        )}
      </div>
    </div>
  );
}
