// Persistent disk cache for settled player lookups (player-cache.json).
// Avoids re-fetching recently checked players across app restarts while respecting TTL and entry caps.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PlayerReputation } from "../shared/reputation-types";
import type { CsrepSummary, EvidenceClass, PlayerDetail } from "../shared/types";

export interface CachedPlayerEntry {
  classification: EvidenceClass | null;
  totalMatches: number;
  name: string | null;
  detail: PlayerDetail | null;
  reputation: PlayerReputation | null;
  csrep: CsrepSummary | null;
  note: string | null;
  at: number;
  recheckAfterMs: number | null;
}

export interface PlayerCacheStore {
  load(): Map<string, CachedPlayerEntry>;
  save(entries: ReadonlyMap<string, CachedPlayerEntry>): void;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;
const STEAM64_RE = /^\d{17}$/;

function isValidEntry(v: unknown): v is CachedPlayerEntry {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.at === "number" && Number.isFinite(o.at) && typeof o.totalMatches === "number";
}

/** JSON-backed persistent player cache with TTL pruning and bounded entry count. */
export function playerCacheFileStore(
  file: string,
  opts: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): PlayerCacheStore {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = opts.now ?? Date.now;

  return {
    load(): Map<string, CachedPlayerEntry> {
      const out = new Map<string, CachedPlayerEntry>();
      if (!existsSync(file)) return out;
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
        const t = now();
        const fresh: [string, CachedPlayerEntry][] = [];
        for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
          if (!STEAM64_RE.test(id) || !isValidEntry(entry)) continue;
          const entryTtl = entry.recheckAfterMs ?? ttlMs;
          if (t - entry.at <= entryTtl) fresh.push([id, entry]);
        }
        fresh.sort((a, b) => b[1].at - a[1].at);
        for (const [id, entry] of fresh.slice(0, maxEntries)) {
          out.set(id, entry);
        }
      } catch {
        return new Map();
      }
      return out;
    },

    save(entries: ReadonlyMap<string, CachedPlayerEntry>): void {
      try {
        const sorted = [...entries.entries()]
          .filter(([id]) => STEAM64_RE.test(id))
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, maxEntries);
        const obj: Record<string, CachedPlayerEntry> = {};
        for (const [id, entry] of sorted) obj[id] = entry;
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(obj), { encoding: "utf8", mode: 0o600 });
        renameSync(tmp, file);
      } catch {
        // Cache persistence is best-effort; never crash on disk errors.
      }
    },
  };
}
