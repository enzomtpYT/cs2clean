// FACEIT Data API v4 client for looking up CS2 skill level and Elo by Steam64 ID.

import type { FaceitRankInfo } from "../shared/types";

const BASE_URL = "https://open.faceit.com/data/v4";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 4;

export class FaceitError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FaceitError";
  }
}

interface FaceitGameStats {
  skill_level?: unknown;
  faceit_elo?: unknown;
}

interface FaceitPlayerResponse {
  games?: {
    cs2?: FaceitGameStats | null;
  } | null;
}

function validLevel(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 && n <= 10 ? n : null;
}

function validElo(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

/** Parses `games.cs2` from a FACEIT Data API v4 player payload; returns null if neither level nor Elo is usable. */
export function parseFaceitPlayer(data: unknown): FaceitRankInfo | null {
  if (!data || typeof data !== "object") return null;
  const cs2 = (data as FaceitPlayerResponse).games?.cs2;
  if (!cs2 || typeof cs2 !== "object") return null;
  const level = validLevel(cs2.skill_level);
  const elo = validElo(cs2.faceit_elo);
  if (level === null && elo === null) return null;
  return { level, elo };
}

/** Queries FACEIT Data API v4 for CS2 skill levels and Elo using a server-side Bearer API key. */
export class FaceitClient {
  constructor(
    public apiKey: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Looks up a single Steam64 ID. Returns null when the player has no CS2 FACEIT profile (404). */
  async fetchPlayer(steamId: string): Promise<FaceitRankInfo | null> {
    const key = this.apiKey?.trim();
    if (!key) return null;

    const url = `${BASE_URL}/players?game=cs2&game_player_id=${encodeURIComponent(steamId)}`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new FaceitError("FACEIT rejected the API key.", res.status);
    }
    if (res.status === 429) {
      throw new FaceitError("FACEIT rate limit reached.", 429);
    }
    if (!res.ok) {
      throw new FaceitError(`FACEIT returned HTTP ${res.status}.`, res.status);
    }

    const body = (await res.json()) as unknown;
    return parseFaceitPlayer(body);
  }

  /**
   * Looks up multiple Steam64 IDs with bounded concurrency.
   * Re-throws auth errors (401/403); swallows per-player 404s; throws if every request fails with a transport/server error.
   */
  async fetchPlayers(steamIds: string[], concurrency = DEFAULT_CONCURRENCY): Promise<Map<string, FaceitRankInfo>> {
    const out = new Map<string, FaceitRankInfo>();
    if (!this.apiKey?.trim() || steamIds.length === 0) return out;

    const unique = [...new Set(steamIds)];
    let idx = 0;
    let firstErr: unknown = null;
    let anySettled = false;
    let aborted = false;

    const worker = async (): Promise<void> => {
      while (!aborted) {
        const i = idx++;
        if (i >= unique.length) return;
        const id = unique[i];
        try {
          const info = await this.fetchPlayer(id);
          anySettled = true;
          if (info) out.set(id, info);
        } catch (e) {
          if (e instanceof FaceitError && (e.status === 401 || e.status === 403)) {
            aborted = true;
            firstErr = e;
            return;
          }
          firstErr ??= e;
        }
      }
    };

    const count = Math.min(Math.max(1, concurrency), unique.length);
    await Promise.all(Array.from({ length: count }, () => worker()));

    if (aborted && firstErr) throw firstErr;
    if (!anySettled && firstErr) throw firstErr;
    return out;
  }
}
