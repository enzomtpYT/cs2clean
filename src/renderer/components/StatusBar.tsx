import type { AppState } from "../../shared/types";

export function StatusBar({ s }: { s: AppState }) {
  const rows = s.lobby.rows;
  const loadingCount = rows.filter((r) => r.status === "loading").length;
  const loadedCount = rows.filter((r) => r.status === "ok").length;
  const flaggedCount = rows.filter(
    (r) => !r.isLocal && (r.classification === "HIGH" || r.classification === "VERY_HIGH"),
  ).length;

  const leetifyTone =
    s.leetify.reachable === null ? "" : s.leetify.reachable ? "ok" : "bad";
  const leetifyLabel =
    s.leetify.reachable === null ? "Leetify: idle" : s.leetify.reachable ? "Leetify: online" : "Leetify: unreachable";

  const fallbackTone =
    s.leetify.fallback.working === null ? "" : s.leetify.fallback.working ? "ok" : "warn";
  const fallbackLabel =
    s.leetify.fallback.working === null
      ? "csst.at: standby"
      : s.leetify.fallback.working
        ? "csst.at: ready"
        : "csst.at: unavailable";

  const csrepTone = !s.csrep.hasKey
    ? ""
    : s.csrep.reachable === false
      ? "bad"
      : s.csrep.reachable === true
        ? "ok"
        : "";
  const csrepLabel = !s.csrep.hasKey
    ? "CSRep: no key"
    : s.csrep.reachable === false
      ? "CSRep: error"
      : s.csrep.reachable === true
        ? "CSRep: online"
        : "CSRep: ready";

  return (
    <footer className="statusbar" aria-label="Application status">
      <div className="statusbar-group">
        <span
          className={`status-pill ${s.game.running ? "ok" : "pulse"}`}
          title={`Game source: ${s.game.source}`}
        >
          <span className="status-dot" />
          <span>{s.game.running ? `CS2 Running (${s.game.source})` : `Waiting for CS2 (${s.game.source})`}</span>
        </span>

        {rows.length > 0 && (
          <span className="status-pill tabular-nums">
            <span>
              {loadedCount}/{rows.length} loaded
              {loadingCount > 0 ? ` · ${loadingCount} loading` : ""}
              {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
            </span>
          </span>
        )}
      </div>

      <div className="statusbar-group">
        <span
          className={`status-pill ${leetifyTone}`}
          title={s.leetify.hasKey ? "Leetify API key configured" : "No Leetify API key (stricter rate limits)"}
        >
          <span className="status-dot" />
          <span>{leetifyLabel}</span>
        </span>

        <span
          className={`status-pill ${fallbackTone}`}
          title={s.leetify.fallback.reason ?? "Fallback for players without a Leetify profile"}
        >
          <span className="status-dot" />
          <span>{fallbackLabel}</span>
        </span>

        <span className={`status-pill ${csrepTone}`} title="CSRep.GG enrichment status">
          <span className="status-dot" />
          <span>{csrepLabel}</span>
        </span>

        <span
          className={`status-pill ${s.steam.hasKey ? "ok" : ""}`}
          title={s.steam.hasKey ? "Steam Web API key configured" : "Optional Steam Web API key for friend grouping"}
        >
          <span className="status-dot" />
          <span>{s.steam.hasKey ? "Steam: key set" : "Steam: no key"}</span>
        </span>
      </div>
    </footer>
  );
}
