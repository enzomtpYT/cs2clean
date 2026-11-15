// CSRep.GG web scraper backed by a user-configured FlareSolverr proxy.
// Caches cf_clearance + User-Agent from FlareSolverr so subsequent player pages can be fetched
// directly via Electron's net.fetch until the clearance expires or is re-challenged.

import type { CsrepSummary } from "../shared/types";
import { parseCsrepHtml, type CsrepProfile } from "./csrep-parse";

export type { CsrepProfile } from "./csrep-parse";

export const CSREP_PLAYER_ORIGIN = "https://csrep.gg/player";
const CLEARANCE_TTL_MS = 25 * 60_000;
const FLARESOLVERR_TIMEOUT_MS = 35_000;
const DIRECT_TIMEOUT_MS = 15_000;
export const CSREP_SCRAPE_DELAY_MS = 1000;
const CSREP_CONCURRENCY = 2;

export type CsrepErrorKind = "proxy-unreachable" | "cloudflare-blocked" | "rate-limit" | "http" | "network";

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

interface CachedClearance {
  cookieHeader: string;
  userAgent: string;
  obtainedAt: number;
}

interface FlareSolverrCookie {
  name?: string;
  value?: string;
}

interface FlareSolverrResponse {
  status?: string;
  message?: string;
  solution?: {
    url?: string;
    status?: number;
    response?: string;
    cookies?: FlareSolverrCookie[];
    userAgent?: string;
  };
}

const STEAM64_RE = /^\d{17}$/;

/** Normalizes a FlareSolverr base URL (e.g. "http://localhost:8191" -> "http://localhost:8191/v1"); null if invalid. */
export function normalizeFlaresolverrUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = cleanPath.endsWith("/v1") ? cleanPath : `${cleanPath}/v1`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function isCloudflareChallenge(res: Response, bodyText: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  return bodyText.includes("challenges.cloudflare.com") || bodyText.includes("_cf_chl_opt");
}

/** Scrapes https://csrep.gg/player/<steamId> using a FlareSolverr proxy and cached cf_clearance cookies. */
export class CsrepScraper {
  private clearance: CachedClearance | null = null;
  public flaresolverrUrl: string | null;

  constructor(
    flaresolverrUrl: string | null = null,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
    private readonly playerOrigin: string = CSREP_PLAYER_ORIGIN,
  ) {
    this.flaresolverrUrl = flaresolverrUrl ? normalizeFlaresolverrUrl(flaresolverrUrl) : null;
  }

  /** Clears cached cf_clearance cookies (e.g. when the proxy URL changes). */
  resetClearance(): void {
    this.clearance = null;
  }

  private activeClearance(): CachedClearance | null {
    if (!this.clearance) return null;
    if (Date.now() - this.clearance.obtainedAt > CLEARANCE_TTL_MS) {
      this.clearance = null;
      return null;
    }
    return this.clearance;
  }

  private async fetchDirect(steamId: string, c: CachedClearance): Promise<{ profile: CsrepProfile | null; challenged: boolean }> {
    const url = `${this.playerOrigin}/${steamId}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          Cookie: c.cookieHeader,
          "User-Agent": c.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      });
    } catch (e) {
      throw new CsrepError("network", `CSRep request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (res.status === 404) return { profile: null, challenged: false };
    if (res.status === 429) throw new CsrepError("rate-limit", "CSRep rate limit reached (429).", 429);

    const body = await res.text().catch(() => "");
    if (res.status === 403 || isCloudflareChallenge(res, body)) {
      this.clearance = null;
      return { profile: null, challenged: true };
    }
    if (!res.ok) throw new CsrepError("http", `CSRep returned HTTP ${res.status}.`, res.status);
    return { profile: parseCsrepHtml(body, steamId), challenged: false };
  }

  private async fetchViaFlaresolverr(steamId: string): Promise<CsrepProfile | null> {
    if (!this.flaresolverrUrl) return null;
    const targetUrl = `${this.playerOrigin}/${steamId}`;
    let res: Response;
    try {
      res = await this.fetchImpl(this.flaresolverrUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "request.get",
          url: targetUrl,
          maxTimeout: 30_000,
        }),
        signal: AbortSignal.timeout(FLARESOLVERR_TIMEOUT_MS),
      });
    } catch (e) {
      throw new CsrepError(
        "proxy-unreachable",
        `Could not reach FlareSolverr: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!res.ok) {
      throw new CsrepError("proxy-unreachable", `FlareSolverr returned HTTP ${res.status}.`, res.status);
    }

    const data = (await res.json()) as FlareSolverrResponse;
    if (data.status !== "ok" || !data.solution) {
      throw new CsrepError("cloudflare-blocked", data.message || "FlareSolverr failed to solve challenge.");
    }

    const cookies = (data.solution.cookies ?? [])
      .filter((c): c is { name: string; value: string } => !!c.name && typeof c.value === "string")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    if (cookies && data.solution.userAgent) {
      this.clearance = {
        cookieHeader: cookies,
        userAgent: data.solution.userAgent,
        obtainedAt: Date.now(),
      };
    }

    if (data.solution.status === 404) return null;
    if (data.solution.status === 429) throw new CsrepError("rate-limit", "CSRep rate limit reached (429).", 429);
    return parseCsrepHtml(data.solution.response ?? "", steamId);
  }

  /** Fetches and parses a single player page, reusing cached cf_clearance when valid. */
  async fetchPlayer(steamId: string): Promise<CsrepProfile | null> {
    if (!this.flaresolverrUrl || !STEAM64_RE.test(steamId)) return null;
    const cached = this.activeClearance();
    if (cached) {
      const direct = await this.fetchDirect(steamId, cached);
      if (!direct.challenged) return direct.profile;
    }
    return this.fetchViaFlaresolverr(steamId);
  }

  /**
   * Scrapes a lobby batch of Steam64 IDs. Warms up cf_clearance on the first ID if needed,
   * then fetches the rest at low concurrency with `delayMs` pacing.
   */
  async fetchPlayers(steamIds: string[], delayMs = CSREP_SCRAPE_DELAY_MS): Promise<Map<string, CsrepProfile>> {
    const out = new Map<string, CsrepProfile>();
    if (!this.flaresolverrUrl) return out;
    const valid = Array.from(new Set(steamIds.filter((id) => STEAM64_RE.test(id))));
    if (valid.length === 0) return out;

    const first = valid[0];
    const firstProfile = await this.fetchPlayer(first);
    if (firstProfile) out.set(first, firstProfile);

    const rest = valid.slice(1);
    if (rest.length === 0) return out;

    let cursor = 0;
    const workerCount = Math.min(CSREP_CONCURRENCY, rest.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < rest.length) {
        const sid = rest[cursor++];
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        try {
          const p = await this.fetchPlayer(sid);
          if (p) out.set(sid, p);
        } catch (e) {
          // Individual player failures in a batch don't discard already-fetched players.
          if (e instanceof CsrepError && e.kind === "proxy-unreachable") throw e;
        }
      }
    });
    await Promise.all(workers);
    return out;
  }
}

/** Converts a parsed CSRep profile into the slim UI summary stored on a LobbyRow. */
export function toCsrepSummary(p: CsrepProfile): CsrepSummary {
  return {
    trustScore: p.trustScore,
    bansCount: p.bansCount,
    flagsCount: p.flagsCount,
    cs2Hours: p.cs2Hours,
    inventoryUsd: p.inventoryUsd,
  };
}
