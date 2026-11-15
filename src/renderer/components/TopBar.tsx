import { Bell, BellOff, Layers, Volume2 } from "lucide-react";
import type { AppState } from "../../shared/types";
import { mapName } from "../brand";
import { bridge } from "../bridge";
import type { NavTab } from "./Sidebar";

const TAB_TITLES: Record<NavTab, string> = {
  match: "Match & Lobby",
  keys: "Keys & APIs",
  keybinds: "Keybinds & Overlay",
  settings: "Settings",
};

const modeName = (m: string | null) =>
  m ? m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ") : null;

export function TopBar({ s, activeTab }: { s: AppState; activeTab: NavTab }) {
  const matchContext = s.match
    ? [mapName(s.match.map), modeName(s.match.mode), modeName(s.match.phase)].filter(Boolean).join(" · ")
    : s.game.running
      ? "CS2 running — waiting for match"
      : "Waiting for CS2";

  const overlayCanToggle = s.overlay.mode === "window";
  const overlayOn = s.overlay.visible;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">{TAB_TITLES[activeTab]}</h1>
        <span className="topbar-divider" aria-hidden="true" />
        <span className="topbar-sub">{matchContext}</span>
      </div>

      <div className="topbar-actions">
        <div className="btn-group" role="group" aria-label="Siren controls">
          <button
            type="button"
            className={`btn-group-item${s.overlay.siren ? "" : " muted-state"}`}
            onClick={() => void bridge.setSiren(!s.overlay.siren)}
            title={s.overlay.siren ? "Siren armed — click to mute" : "Siren muted — click to arm"}
          >
            {s.overlay.siren ? <Bell size={13} /> : <BellOff size={13} />}
            <span>{s.overlay.siren ? "Siren On" : "Siren Muted"}</span>
          </button>

          <button
            type="button"
            className="btn-group-item btn-group-icon"
            onClick={() => void bridge.testSiren()}
            title="Test siren sound"
            aria-label="Test siren sound"
          >
            <Volume2 size={14} />
          </button>
        </div>

        {s.overlay.mode !== "none" && (
          <button
            type="button"
            className={`overlay-toggle-btn${overlayOn ? " on" : ""}`}
            disabled={!overlayCanToggle}
            onClick={() => overlayCanToggle && void bridge.toggleOverlay()}
            title={
              overlayCanToggle
                ? `Click or press ${s.overlay.hotkey} to ${overlayOn ? "hide" : "show"} the in-game overlay`
                : `In-game Overwolf overlay (${s.overlay.hotkey})`
            }
          >
            <Layers size={14} />
            <span>{overlayOn ? "Overlay On" : "Overlay Off"}</span>
            <kbd>{s.overlay.hotkey}</kbd>
          </button>
        )}
      </div>
    </header>
  );
}
