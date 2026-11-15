import { memo, useMemo, useState } from "react";
import { AlertTriangle, Crosshair, ExternalLink, Info, Loader2, Search, Trash2, UserPlus } from "lucide-react";
import type { AppState, LobbyRow } from "../../shared/types";
import { DISCLAIMER, mapName, SideEmblem } from "../brand";
import { bridge } from "../bridge";
import { groupColor } from "../group-color";
import { GroupStack } from "../group-stack";
import { PlayerClass } from "../parts";
import { PlayerRanks } from "../ranks";
import { PlayerDetailsModal } from "./PlayerDetailsModal";

const modeName = (m: string | null) =>
  m ? m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ") : null;

export function MatchView({ s }: { s: AppState }) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const rows = s.lobby.rows;
  const selectedPlayer = useMemo(
    () => (selectedSlot !== null ? rows.find((r) => r.slot === selectedSlot) ?? null : null),
    [rows, selectedSlot],
  );
  const checkedOnly = !s.match && rows.length > 0;
  const title = checkedOnly
    ? "Checked players"
    : s.match
      ? [mapName(s.match.map), modeName(s.match.mode)].filter(Boolean).join(" · ") || "Current match"
      : "Current match";

  const loadingCount = rows.filter((r) => r.status === "loading").length;
  const settledCount = rows.length - loadingCount;
  const progressPct = rows.length > 0 ? Math.round((settledCount / rows.length) * 100) : 0;

  return (
    <>
      <section className="panel">
        <div className="match-summary">
          <div className="match-title-row">
            <h2 className="match-title">{title}</h2>
            {s.match?.phase && <span className="pill-tag accent">{modeName(s.match.phase)}</span>}
            {s.game.source === "replay" && (
              <span className="pill-tag" title="Playing a recorded session, not live data">
                Replay
              </span>
            )}
          </div>

          {rows.length > 0 && (
            <span className="xs muted tabular-nums">
              {settledCount}/{rows.length} checked
              {loadingCount > 0 ? ` (${loadingCount} loading…)` : ""}
            </span>
          )}
        </div>

        {rows.length > 0 && loadingCount > 0 && (
          <div className="lookup-progress" aria-label="Player lookup progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="xs muted tabular-nums">{progressPct}%</span>
          </div>
        )}

        {s.game.problem && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            <div className="banner-body">
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{s.game.problem}</span>
            </div>
          </div>
        )}

        {s.game.rosterUnavailable && (
          <div className="banner info" style={{ marginTop: 12 }}>
            <div className="banner-body">
              <span>
                <strong>Community server or offline match:</strong> Steam doesn't list players for these, so CS2Clean
                can't discover them automatically. Add players manually below.
              </span>
            </div>
          </div>
        )}

        {s.lobby.error && (
          <div className="banner error" style={{ marginTop: 12 }}>
            <div className="banner-body">{s.lobby.error}</div>
          </div>
        )}

        {s.game.hint && (
          <p className="small muted" style={{ margin: "10px 0 0" }}>
            {s.game.hint}
          </p>
        )}

        {rows.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <LobbyTable rows={rows} onInspect={setSelectedSlot} />
            {s.game.source === "steam" && !checkedOnly && (
              <p className="xs muted" style={{ margin: "12px 0 0", lineHeight: 1.45 }}>
                Players come from Steam's recently played list, so teams aren't known. Only the first 10 players of a
                lobby are looked up automatically; manually added players are always checked.
              </p>
            )}
          </div>
        ) : !s.game.problem ? (
          <div className="empty-state">
            <div className="empty-icon">
              {s.game.running ? <Loader2 size={18} /> : <Crosshair size={18} />}
            </div>
            <div style={{ fontWeight: 500, color: "var(--theme-text-main)" }}>
              {s.game.rosterUnavailable
                ? "No players added yet"
                : s.game.running
                  ? "CS2 is running — waiting for a match"
                  : "Waiting for CS2 to start"}
            </div>
            <div className="small muted">
              {s.game.source === "steam"
                ? "Players appear automatically when a match loads, or you can look up a player manually below."
                : "Players appear automatically when a match loads."}
            </div>
          </div>
        ) : null}

        {s.game.source === "steam" && (
          <>
            <hr className="divider" />
            <AddPlayerForm />
          </>
        )}
      </section>

      <p className="xs dim" style={{ margin: 0, lineHeight: 1.5 }}>
        {DISCLAIMER}
      </p>

      {selectedPlayer && <PlayerDetailsModal player={selectedPlayer} onClose={() => setSelectedSlot(null)} />}
    </>
  );
}

function AddPlayerForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      if (await bridge.addPlayer(text)) setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <div className="input-wrap">
        <input
          className="input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Check a player: SteamID64, SteamID2/3, or Steam / Leetify profile URL"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
      </div>
      <button type="button" className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => void add()}>
        {busy ? <Loader2 size={14} /> : <UserPlus size={14} />}
        <span>{busy ? "Adding…" : "Add player"}</span>
      </button>
    </div>
  );
}

function LobbyTable({ rows, onInspect }: { rows: LobbyRow[]; onInspect: (slot: number) => void }) {
  const { groupSizes, teams } = useMemo(() => {
    const sizes = new Map<string, number>();
    const ct: LobbyRow[] = [];
    const t: LobbyRow[] = [];
    const other: LobbyRow[] = [];
    let hasSide = false;
    for (const r of rows) {
      if (r.groupId) sizes.set(r.groupId, (sizes.get(r.groupId) ?? 0) + 1);
      if (r.side === "CT") {
        hasSide = true;
        ct.push(r);
      } else if (r.side === "T") {
        hasSide = true;
        t.push(r);
      } else {
        other.push(r);
      }
    }
    const grouped: [string, LobbyRow[]][] = [
      ["Counter-Terrorists", ct],
      ["Terrorists", t],
      [hasSide ? "Other" : "Players", other],
    ];
    return { groupSizes: sizes, teams: grouped.filter(([, list]) => list.length > 0) };
  }, [rows]);

  return (
    <div className="lobby">
      {teams.map(([label, list]) => (
        <div key={label} className="team">
          <div className="team-label">
            <span>{label}</span>
            <span className="tabular-nums">{list.length}</span>
          </div>
          {list.map((r) => (
            <LobbyLine
              key={r.slot}
              r={r}
              groupSize={r.groupId ? (groupSizes.get(r.groupId) ?? 0) : 0}
              onInspect={onInspect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const LobbyLine = memo(function LobbyLine({
  r,
  groupSize,
  onInspect,
}: {
  r: LobbyRow;
  groupSize: number;
  onInspect: (slot: number) => void;
}) {
  const groupStyle = r.groupId ? { borderLeftColor: groupColor(r.groupId) } : undefined;
  return (
    <div className={`player${r.isLocal ? " is-local" : ""}`} style={groupStyle}>
      {r.side && <SideEmblem side={r.side} />}
      <GroupStack size={groupSize} label={r.groupName} />
      <button
        type="button"
        className="player-name"
        title="View player details & data sources"
        onClick={() => onInspect(r.slot)}
      >
        {r.name}
      </button>
      <PlayerRanks m={r.detail?.metrics} faceit={r.faceit} />
      {(r.isLocal || r.via) && (
        <span className="player-tags">
          {r.isLocal && <span className="you">you</span>}
          {r.via === "profile" && (
            <span
              className="group-badge"
              title="Found from Steam's profile page, which can be ten minutes out of date: this friend may not be in your match"
            >
              maybe
            </span>
          )}
          {r.via === "manual" && (
            <span className="group-badge" title="Added manually">
              added
            </span>
          )}
        </span>
      )}
      <span className="row-spacer" />
      <PlayerClass r={r} />
      {r.csrep && (
        <span className="player-tags">
          {r.csrep.trustScore !== null && (
            <span className="group-badge tabular-nums" title="CSRep.GG Trust Score">
              {Math.round(r.csrep.trustScore)}% trust
            </span>
          )}
          {r.csrep.flagsCount > 0 && (
            <span className="group-badge tabular-nums" title="Account flags on CSRep.GG">
              {r.csrep.flagsCount} flag{r.csrep.flagsCount === 1 ? "" : "s"}
            </span>
          )}
          {r.csrep.cs2Hours !== null && (
            <span className="group-badge tabular-nums" title="CS2 hours reported by CSRep.GG">
              {Math.round(r.csrep.cs2Hours)}h
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        className="icon-btn"
        onClick={() => onInspect(r.slot)}
        title="View detailed stats & data sources"
        aria-label="View detailed stats & data sources"
      >
        <Info size={14} />
      </button>
      {r.steamId && r.status !== "skipped" && (
        <>
          <button
            type="button"
            className="leetify-link"
            onClick={() => bridge.openPlayer(r.steamId!)}
            title="View on Leetify"
          >
            Leetify
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => bridge.openCsrepPlayer(r.steamId!)}
            title="View on CSRep.GG"
            aria-label="View on CSRep.GG"
          >
            <ExternalLink size={13} />
          </button>
        </>
      )}
      {r.via === "manual" && r.steamId && (
        <button
          type="button"
          className="icon-btn danger"
          title="Remove player from list"
          aria-label="Remove player"
          onClick={() => void bridge.removePlayer(r.steamId!)}
        >
          <Trash2 size={14} />
        </button>
      )}
      {!r.steamId && r.status === "no-steam-id" && (
        <span title="No SteamID available">
          <Search size={13} className="dim" />
        </span>
      )}
    </div>
  );
});
