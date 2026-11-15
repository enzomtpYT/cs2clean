import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Download, Info } from "lucide-react";
import { bridge } from "./bridge";
import { KeybindsOverlayView } from "./components/KeybindsOverlayView";
import { KeysView } from "./components/KeysView";
import { MatchView } from "./components/MatchView";
import { Sidebar, type NavTab } from "./components/Sidebar";
import { SettingsView } from "./components/SettingsView";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useTheme } from "./theme";
import { useAppState } from "./useAppState";
import "./style.css";

function App() {
  const s = useAppState();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<NavTab>("match");

  if (!s) return null;

  return (
    <div className="app-shell">
      <Sidebar
        s={s}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        themeMode={theme.mode}
        onCycleTheme={theme.cycleMode}
      />

      <div className="main-col">
        <TopBar s={s} activeTab={activeTab} />

        <main className="view-scroll">
          <div className="view-container">
            {s.update.available && (
              <div className="banner info">
                <div className="banner-body">
                  <Download size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    A new version of CS2Clean (<strong>{s.update.remoteVersion}</strong>) is available.
                  </span>
                </div>
                <button type="button" className="btn btn-xs btn-primary" onClick={() => void bridge.openReleases()}>
                  Download
                </button>
              </div>
            )}

            {s.notice && (
              <div className="banner warn">
                <div className="banner-body">
                  <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{s.notice}</span>
                </div>
              </div>
            )}

            {s.leetify.fallback.working === false && (
              <div className="banner warn">
                <div className="banner-body">
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <strong>csst.at fallback unavailable.</strong> Players Leetify has no profile for cannot be looked
                    up there.{s.leetify.fallback.reason ? ` ${s.leetify.fallback.reason}` : ""}
                  </span>
                </div>
              </div>
            )}

            {activeTab === "match" && <MatchView s={s} />}
            {activeTab === "keys" && <KeysView s={s} />}
            {activeTab === "keybinds" && <KeybindsOverlayView s={s} />}
            {activeTab === "settings" && <SettingsView s={s} theme={theme} />}
          </div>
        </main>

        <StatusBar s={s} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
