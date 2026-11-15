import { useEffect, useState } from "react";
import { Check, Copy, Database, ExternalLink, ShieldAlert, X } from "lucide-react";
import type { AxisLevel, LobbyRow } from "../../shared/types";
import { ClassBadge, mapName, SideEmblem, TIER_LABELS } from "../brand";
import { bridge } from "../bridge";
import {
  ago,
  clutchDisplay,
  cspLevel,
  headshotFact,
  matchesFact,
  ratingDisplay,
  show,
  sprayAccuracyLevel,
  spottedAccuracyLevel,
  ttdLevel,
  winrateDisplay,
} from "../parts";
import { PlayerRanks } from "../ranks";

interface PlayerDetailsModalProps {
  player: LobbyRow;
  onClose: () => void;
}

export function PlayerDetailsModal({ player: r, onClose }: PlayerDetailsModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = r.detail;
  const m = d?.metrics ?? null;
  const matches = d?.matches ?? null;
  const hs = m ? headshotFact(m) : null;
  const rep = r.reputation && r.reputation.score !== null ? r.reputation : null;

  const copySteamId = async () => {
    if (!r.steamId) return;
    try {
      await navigator.clipboard.writeText(r.steamId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const statsSourceLabel = d
    ? d.source === "leetify"
      ? "Leetify Public API"
      : "csst.at (fallback)"
    : r.status === "loading"
      ? "Fetching from Leetify…"
      : "No stats available";

  const profileCoverage = d
    ? matches
      ? `Public match history (${matches.count} recent)`
      : "Lifetime aggregates only (private or no recent matches)"
    : r.note ?? "—";

  const discoverySource =
    r.via === "manual"
      ? "Added manually"
      : r.via === "profile"
        ? "Steam mini-profile (friend)"
        : "Match roster / Steam coplay";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title-group">
            {r.side && <SideEmblem side={r.side} />}
            <h2 id="player-modal-title" className="modal-title">
              {r.name}
            </h2>
            {r.isLocal && <span className="you">you</span>}
            {r.groupName && <span className="group-badge">{r.groupName}</span>}
            {r.via === "manual" && <span className="group-badge">added</span>}
            {r.via === "profile" && <span className="group-badge">maybe</span>}
            <PlayerRanks m={m} faceit={r.faceit} />
          </div>

          <div className="modal-head-actions">
            {r.classification && <ClassBadge value={r.classification} />}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {/* Scores & Findings */}
          {(rep || d) && (
            <div className="detail-score-grid">
              {rep && (
                <div className="detail-score-box">
                  <div className="xs muted">Reputation Score</div>
                  <div className="detail-score-val tabular-nums">
                    <strong>{rep.score}</strong>
                    <span className="muted"> / 100</span>
                  </div>
                  <div className="xs muted">
                    {TIER_LABELS[rep.tier]} · {Math.round(rep.confidence * 100)}% confidence
                  </div>
                </div>
              )}

              {d && (
                <div className="detail-score-box">
                  <div className="xs muted">Performance Score</div>
                  <div className="detail-score-val tabular-nums">
                    <strong>{d.score}</strong>
                    <span className="muted"> / 100</span>
                  </div>
                  <div className="xs muted">Outlier index: {Math.round(d.outlier)} / 100</div>
                </div>
              )}
            </div>
          )}

          {rep && rep.reasons.length > 0 && (
            <div className="detail-section">
              <div className="section-label">Flagged Findings</div>
              <ul className="detail-reasons">
                {rep.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {!d && !rep && (
            <div className="banner info">
              <div className="banner-body">
                <span>{r.note ?? "No detailed stats available for this player yet."}</span>
              </div>
            </div>
          )}

          {/* Data Sources & Provenance */}
          <div className="detail-section">
            <div className="section-label">
              <Database size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} />
              Data Sources & Provenance
            </div>
            <dl className="detail-kv-grid">
              <dt>Stats provider</dt>
              <dd>{statsSourceLabel}</dd>
              <dt>Profile coverage</dt>
              <dd>{profileCoverage}</dd>
              <dt>Found via</dt>
              <dd>{discoverySource}</dd>
              <dt>CSRep.GG</dt>
              <dd>{r.csrep ? "Enriched" : "Not enriched (no proxy or unavailable)"}</dd>
              {d?.firstMatchDate && (
                <>
                  <dt>First Leetify match</dt>
                  <dd>{new Date(d.firstMatchDate).toLocaleDateString()}</dd>
                </>
              )}
              {r.steamId && (
                <>
                  <dt>SteamID64</dt>
                  <dd className="detail-steamid">
                    <span className="tabular-nums">{r.steamId}</span>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => void copySteamId()}
                      title="Copy SteamID64"
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </dd>
                </>
              )}
            </dl>
          </div>

          {/* Performance & Aim Metrics */}
          {d && m && (
            <div className="detail-section">
              <div className="section-label">Player Metrics</div>
              <dl className="detail-metrics-grid">
                <MetricItem label="Leetify rating" value={ratingDisplay(m.leetify)} level={d.levels.rating} />
                <MetricItem label="Aim" value={show(m.aim)} level={d.levels.aim} />
                <MetricItem label="Clutch" value={clutchDisplay(m.clutch)} level={d.levels.clutch} />
                <MetricItem label="Positioning" value={show(m.positioning)} />
                <MetricItem label="Utility" value={show(m.utility)} />
                <MetricItem label="Opening" value={show(m.opening)} />
                {m.ctOpeningDuel !== null && <MetricItem label="CT opening duel" value={show(m.ctOpeningDuel, 1, "%")} />}
                {m.tOpeningDuel !== null && <MetricItem label="T opening duel" value={show(m.tOpeningDuel, 1, "%")} />}
                {hs && <MetricItem label={hs.label} value={hs.value} level={hs.level as AxisLevel} />}
                <MetricItem
                  label="Spray accuracy"
                  value={show(m.sprayAccuracy, 1, "%")}
                  level={sprayAccuracyLevel(m.sprayAccuracy) as AxisLevel}
                />
                <MetricItem
                  label="Spotted accuracy"
                  value={show(m.spottedAccuracy, 1, "%")}
                  level={spottedAccuracyLevel(m.spottedAccuracy) as AxisLevel}
                />
                <MetricItem
                  label="Time to damage"
                  value={show(m.reactionMs, 0, " ms")}
                  level={ttdLevel(m.reactionMs) as AxisLevel}
                />
                <MetricItem label="Preaim" value={show(m.preaim, 1, "°")} level={cspLevel(m.preaim) as AxisLevel} />
                <MetricItem label="Counter-strafing" value={show(m.counterStrafing, 1, "%")} />
                <MetricItem label={matchesFact(d).label} value={matchesFact(d).value} />
                <MetricItem label="Win rate" value={winrateDisplay(m.winrate)} />
                {matches && (
                  <>
                    <MetricItem label="Avg match rating" value={show(matches.avgRating, 1)} />
                    <MetricItem
                      label="Strong matches (3.0+)"
                      value={`${Math.round(matches.strongShare * 100)}%`}
                    />
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Recent Matches */}
          {matches && matches.recent.length > 0 && (
            <div className="detail-section">
              <div className="section-label">Latest Matches ({matches.recent.length})</div>
              <div className="detail-recent-list">
                {matches.recent.slice(0, 6).map((x, i) => (
                  <div key={i} className="detail-recent-row">
                    <span>{mapName(x.map) ?? "Unknown map"}</span>
                    <span className="tabular-nums">{show(x.rating, 1)}</span>
                    <span className="muted">{ago(x.playedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leetify Bans (if any) */}
          {d?.bans && d.bans.length > 0 && (
            <div className="detail-section">
              <div className="section-label">
                <ShieldAlert size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                Leetify Ban Records ({d.bans.length})
              </div>
              <ul className="detail-reasons">
                {d.bans.map((b, i) => (
                  <li key={i}>
                    <strong>{b.platform ?? "Unknown platform"}</strong>
                    {b.nickname ? ` (${b.nickname})` : ""}
                    {b.bannedSince ? ` — since ${new Date(b.bannedSince).toLocaleDateString()}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CSRep.GG Enrichment */}
          {r.csrep && (
            <div className="detail-section">
              <div className="section-label">
                <ShieldAlert size={12} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                CSRep.GG Account & Trust Breakdown
              </div>
              <dl className="detail-kv-grid">
                <dt>CSRep Trust Score</dt>
                <dd className="tabular-nums">{r.csrep.trustScore !== null ? `${r.csrep.trustScore}%` : "—"}</dd>
                {r.csrep.statisticalTrust != null && (
                  <>
                    <dt>Statistical Trust</dt>
                    <dd className="tabular-nums">{r.csrep.statisticalTrust}</dd>
                  </>
                )}
                {r.csrep.accountFlagsScore != null && (
                  <>
                    <dt>Account Flags Score</dt>
                    <dd className="tabular-nums">{r.csrep.accountFlagsScore}</dd>
                  </>
                )}
                {r.csrep.anomaliesScore != null && (
                  <>
                    <dt>Anomalies Score</dt>
                    <dd className="tabular-nums">{r.csrep.anomaliesScore}</dd>
                  </>
                )}
                {r.csrep.accountBonusPct != null && (
                  <>
                    <dt>Account Bonus</dt>
                    <dd className="tabular-nums">
                      {r.csrep.accountBonusPct >= 0 ? `+${r.csrep.accountBonusPct}%` : `${r.csrep.accountBonusPct}%`}
                    </dd>
                  </>
                )}
                <dt>CS2 hours</dt>
                <dd className="tabular-nums">{r.csrep.cs2Hours !== null ? `${Math.round(r.csrep.cs2Hours)}h` : "—"}</dd>
                <dt>Bans</dt>
                <dd className="tabular-nums">{r.csrep.bansCount}</dd>
                <dt>Flags</dt>
                <dd className="tabular-nums">{r.csrep.flagsCount}</dd>
                <dt>Inventory value</dt>
                <dd className="tabular-nums">
                  {r.csrep.inventoryUsd !== null ? `$${r.csrep.inventoryUsd.toFixed(2)}` : "—"}
                </dd>
              </dl>

              {(r.csrep.hltvRating != null ||
                r.csrep.kdRatio != null ||
                r.csrep.adr != null ||
                r.csrep.kastPct != null ||
                r.csrep.reactionMs != null ||
                r.csrep.preaim != null ||
                r.csrep.aimAccuracy != null ||
                r.csrep.headAccuracy != null ||
                r.csrep.wallbangKillPct != null ||
                r.csrep.smokeKillPct != null) && (
                <>
                  <div className="section-label" style={{ marginTop: 10 }}>
                    CSRep.GG Stats Overview
                  </div>
                  <dl className="detail-metrics-grid">
                    {r.csrep.hltvRating != null && (
                      <MetricItem label="HLTV Rating 2.0" value={r.csrep.hltvRating.toFixed(2)} />
                    )}
                    {r.csrep.kdRatio != null && <MetricItem label="K/D Ratio" value={r.csrep.kdRatio.toFixed(2)} />}
                    {r.csrep.adr != null && <MetricItem label="ADR" value={r.csrep.adr.toFixed(1)} />}
                    {r.csrep.kastPct != null && <MetricItem label="KAST" value={`${r.csrep.kastPct.toFixed(1)}%`} />}
                    {r.csrep.reactionMs != null && (
                      <MetricItem label="Reaction Time" value={`${Math.round(r.csrep.reactionMs)} ms`} />
                    )}
                    {r.csrep.preaim != null && (
                      <MetricItem label="Crosshair / Preaim" value={`${r.csrep.preaim.toFixed(1)}°`} />
                    )}
                    {r.csrep.aimAccuracy != null && (
                      <MetricItem label="Aim Accuracy" value={`${r.csrep.aimAccuracy.toFixed(1)}%`} />
                    )}
                    {r.csrep.headAccuracy != null && (
                      <MetricItem label="Head Accuracy" value={`${r.csrep.headAccuracy.toFixed(1)}%`} />
                    )}
                    {r.csrep.wallbangKillPct != null && (
                      <MetricItem label="Wallbang Kill %" value={`${r.csrep.wallbangKillPct.toFixed(1)}%`} />
                    )}
                    {r.csrep.smokeKillPct != null && (
                      <MetricItem label="Smoke Kill %" value={`${r.csrep.smokeKillPct.toFixed(1)}%`} />
                    )}
                  </dl>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {r.steamId && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => void bridge.openPlayer(r.steamId!)}>
                <ExternalLink size={13} />
                <span>Open on Leetify</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void bridge.openCsrepPlayer(r.steamId!)}>
                <ExternalLink size={13} />
                <span>Open on CSRep.GG</span>
              </button>
            </>
          )}
          <span className="row-spacer" />
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, value, level }: { label: string; value: string; level?: AxisLevel }) {
  const showLevel = level && level !== "LOW";
  return (
    <div className="detail-metric-item">
      <dt>{label}</dt>
      <dd className="tabular-nums">
        <span>{value}</span>
        {showLevel && <span className={`lvl lvl-${level.toLowerCase()}`}>{level}</span>}
      </dd>
    </div>
  );
}
