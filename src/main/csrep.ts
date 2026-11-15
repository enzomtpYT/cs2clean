// CSRep.GG v2 API client (https://csrep.gg/api).
// Used as a parallel enrichment and fallback source alongside Leetify and csst.at.

import type { CsrepBanSummary, CsrepSummary } from "../shared/types";

export const CSREP_BASE = "https://csrep.gg/api";
export const CSREP_DOCS_URL = "https://csrep.gg/docs/api-reference#description/introduction";

export interface CsrepBan {
  id?: string;
  player_id?: string;
  source?: string | null;
  source_id?: string | null;
  type?: string | null;
  reason?: string | null;
  amount?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface CsrepAutoflag {
  id?: string;
  created_at?: string | null;
  has_snapshot?: boolean;
}

export interface CsrepRankEntry {
  current?: number | string | null;
  peak?: number | string | null;
}

export interface CsrepPlayer {
  id: string;
  redacted?: boolean;
  name?: string | null;
  avatar?: string | null;
  steam_level?: number | null;
  steam_privacy?: number | null;
  steam_created_at?: string | null;
  cs2_hours?: number | null;
  inventory_value?: number | null;
  faceit_id?: string | null;
  faceit_url?: string | null;
  faceit_latest_match_date?: string | null;
  gamersclub_id?: string | null;
  gamersclub_url?: string | null;
  ranks?: Record<string, CsrepRankEntry> | null;
  reputation?: Record<string, unknown> | null;
  autoflag?: CsrepAutoflag | null;
  medals?: number[] | null;
  bans?: CsrepBan[] | null;
}

export type CsrepErrorKind = "invalid-key" | "cloudflare-blocked" | "rate-limit" | "http" | "network";

export class CsrepError extends Error {
  constructor(
    public readonly kind: CsrepErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CsrepError";
  }
}

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const STEAM64_RE = /^\d{17}$/;

/** Checks whether a 403 response looks like a Cloudflare browser challenge rather than an API JSON error. */
function isCloudflareChallenge(res: Response, bodyText: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) return true;
  return bodyText.includes("challenges.cloudflare.com") || bodyText.includes("_cf_chl_opt");
}

/** Client for the CSRep.GG v2 API (batch player lookups via X-API-Key). */
export class CsrepClient {
  constructor(
    public apiKey: string | null = null,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly baseUrl: string = CSREP_BASE,
  ) {}

  /** Batch-fetches players by SteamID64 via GET /players?ids=...; returns an empty map when no key or valid IDs. */
  async fetchPlayers(steamIds: string[]): Promise<Map<string, CsrepPlayer>> {
    const out = new Map<string, CsrepPlayer>();
    if (!this.apiKey) return out;
    const valid = Array.from(new Set(steamIds.filter((id) => STEAM64_RE.test(id))));
    if (valid.length === 0) return out;

    const url = `${this.baseUrl}/players?ids=${encodeURIComponent(valid.join(","))}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12_000),
      });
    } catch (e) {
      throw new CsrepError("network", `CSRep request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) throw new CsrepError("invalid-key", "CSRep rejected the API key (401).", 401);
      if (res.status === 403) {
        if (isCloudflareChallenge(res, body)) {
          throw new CsrepError("cloudflare-blocked", "CSRep API is blocked by a Cloudflare challenge (403).", 403);
        }
        throw new CsrepError("invalid-key", "CSRep rejected the API key (403).", 403);
      }
      if (res.status === 429) throw new CsrepError("rate-limit", "CSRep rate limit reached (429).", 429);
      throw new CsrepError("http", `CSRep returned HTTP ${res.status}.`, res.status);
    }

    const data = (await res.json()) as { status?: string; result?: CsrepPlayer[] | null };
    for (const p of data.result ?? []) {
      if (p && typeof p.id === "string" && STEAM64_RE.test(p.id)) out.set(p.id, p);
    }
    return out;
  }
}

/** Converts a raw CSRep player record into the slim UI summary stored on a LobbyRow. */
export function toCsrepSummary(p: CsrepPlayer): CsrepSummary {
  const bans: CsrepBanSummary[] = (p.bans ?? [])
    .filter((b): b is CsrepBan => !!b)
    .map((b) => ({
      source: b.source ?? "UNKNOWN",
      type: b.type ?? "BAN",
      reason: b.reason ?? null,
      startsAt: b.starts_at ?? null,
    }));

  return {
    cs2Hours: typeof p.cs2_hours === "number" && Number.isFinite(p.cs2_hours) ? p.cs2_hours : null,
    steamLevel: typeof p.steam_level === "number" && Number.isFinite(p.steam_level) ? p.steam_level : null,
    steamCreatedAt: p.steam_created_at ?? null,
    autoflagged: !!p.autoflag?.id,
    bans,
    faceitUrl: p.faceit_url ?? null,
  };
}
