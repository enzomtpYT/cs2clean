import { useState } from "react";
import {
  Crosshair,
  KeyRound,
  Keyboard,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import type { AppState } from "../../shared/types";
import { Logo } from "../brand";
import { bridge } from "../bridge";
import type { ThemeMode } from "../theme";
import leetifyBadge from "../../../assets/Leetify-Badge-White-Small.png";

export type NavTab = "match" | "keys" | "keybinds" | "settings";

const COLLAPSE_KEY = "cs2clean.sidebarCollapsed";

interface SidebarProps {
  s: AppState;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
}

export function Sidebar({ s, activeTab, onSelectTab, themeMode, onCycleTheme }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const hasHighPlayer = s.lobby.rows.some(
    (r) => !r.isLocal && (r.classification === "HIGH" || r.classification === "VERY_HIGH"),
  );
  const keyCount = (s.leetify.hasKey ? 1 : 0) + (s.steam.hasKey ? 1 : 0) + (s.csrep.hasProxy ? 1 : 0);

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Crosshair;
    badge?: string | number;
    alertDot?: boolean;
  }> = [
    {
      id: "match",
      label: "Match",
      icon: Crosshair,
      badge: s.lobby.rows.length > 0 ? s.lobby.rows.length : undefined,
      alertDot: hasHighPlayer,
    },
    {
      id: "keys",
      label: "Keys & APIs",
      icon: KeyRound,
      badge: `${keyCount}/3`,
    },
    {
      id: "keybinds",
      label: "Keybinds & Overlay",
      icon: Keyboard,
      badge: s.overlay.mode !== "none" ? (s.overlay.visible ? "On" : "Off") : undefined,
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      alertDot: s.update.available,
    },
  ];

  const ThemeIcon = themeMode === "dark" ? Moon : themeMode === "light" ? Sun : Monitor;
  const themeLabel = themeMode === "dark" ? "Theme: Dark" : themeMode === "light" ? "Theme: Light" : "Theme: System";

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-head">
        {!collapsed ? (
          <div className="sidebar-brand">
            <Logo size={22} />
            <span className="sidebar-title">CS2Clean</span>
            <span className="version-pill">{s.version}</span>
          </div>
        ) : (
          <button
            type="button"
            className="icon-btn"
            onClick={toggleCollapsed}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}

        {!collapsed && (
          <button
            type="button"
            className="icon-btn"
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${isActive ? " active" : ""}`}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">
                <Icon size={16} />
                {item.alertDot && <span className="nav-alert-dot" aria-hidden="true" />}
              </span>
              {!collapsed && (
                <>
                  <span className="nav-label">{item.label}</span>
                  {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
                </>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <button
          type="button"
          className="nav-item"
          onClick={onCycleTheme}
          title={collapsed ? `${themeLabel} (click to cycle)` : "Cycle Dark / Light / System"}
        >
          <span className="nav-icon">
            <ThemeIcon size={16} />
          </span>
          {!collapsed && <span className="nav-label">{themeLabel}</span>}
        </button>

        {!collapsed && (
          <button
            type="button"
            className="sidebar-leetify"
            onClick={() => bridge.openLeetify()}
            title="Data Provided by Leetify"
          >
            <img src={leetifyBadge} alt="Data Provided by Leetify" />
          </button>
        )}
      </div>
    </aside>
  );
}
