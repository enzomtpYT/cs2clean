// The csst.at fallback: fetches a player's Leetify stats from csst.at in-process (using Electron's net.fetch
// in the app, which carries Chromium's TLS/HTTP2 stack) when Leetify's public API has no profile for them.

import type { LeetifyProfile } from "./leetify";
import { parseCsstAtHtml } from "./csst-parse";
import { debug, warn } from "./logger";

export { parseCsstAtHtml } from "./csst-parse";

export type HeroProblem =
  | "site-unreachable"
  | "timeout"
  | "crashed";

export interface HeroStatus {
  state: "ready" | "unavailable";
  problem: HeroProblem | null;
  /** What happened, in plain words, for the window. Null when ready. */
  reason: string | null;
  /** The raw error text behind it, for the log. */
  detail: string | null;
}

export const HERO_READY: HeroStatus = { state: "ready", problem: null, reason: null, detail: null };

export interface HeroScrape {
  profiles: Map<string, LeetifyProfile>;
  status: HeroStatus;
  /**
   * Players csst.at failed to answer for (a request that threw, or an HTTP error other than "not found") while it did
   * answer for others, with what went wrong. Not the same as having no data on them: they are worth asking again.
   */
  failed?: ReadonlyMap<string, string>;
}

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_ORIGIN = "https://csst.at";
const REQUEST_TIMEOUT_MS = 20_000;
/** The pause between one player's request to csst.at and the next, in ms. csst.at is a website, not an API: go easy on it. */
export const SCRAPE_DELAY_MS = 1200;
const SCRAPE_CONCURRENCY = 2;

let fetchOverride: FetchImpl | null = null;
let originOverride: string | null = null;
const statusListeners = new Set<(s: HeroStatus) => void>();

/** Configures the in-process csst.at scraper (main.ts passes Electron's net.fetch). */
export function configureHero(o: { fetchImpl?: FetchImpl; origin?: string; dataDir?: string }): void {
  if (o.fetchImpl !== undefined) fetchOverride = o.fetchImpl;
  if (o.origin !== undefined) originOverride = o.origin;
}

/** Subscribes to fallback status updates; returns an unsubscribe function. */
export function onHeroStatus(fn: (s: HeroStatus) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function unavailable(problem: HeroProblem, reason: string, detail: string | null = null): HeroStatus {
  return { state: "unavailable", problem, reason, detail };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() || text;
}

function reported(s: HeroStatus): HeroStatus {
  if (s.state === "unavailable") warn("hero", `${s.problem}:`, s.reason, s.detail ?? "");
  for (const fn of statusListeners) fn(s);
  return s;
}

/** The fallback failed in a way nobody planned for (a bug here). Still a status, never an exception. */
export function unexpectedHeroFailure(e: unknown): HeroStatus {
  const text = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return reported(unavailable("crashed", `The csst.at fallback hit an unexpected error: ${firstLine(text)}`, text));
}

/** Reports readiness immediately: no external browser or native sidecar is required. */
export async function checkHeroRuntime(): Promise<HeroStatus> {
  return reported(HERO_READY);
}

function csstOrigin(): string {
  return (originOverride ?? process.env.CS2CLEAN_CSST_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function isCloudflareChallenge(res: Response, body: string): boolean {
  if (res.headers.get("cf-mitigated") === "challenge") return true;
  return body.includes("challenges.cloudflare.com") || body.includes("_cf_chl_opt");
}

/**
 * Fetches csst.at for the given players, pausing `delayMs` between two players. Always resolves: `profiles` holds the
 * players it found, `status` says whether the fallback itself worked, and when it didn't, why.
 */
export async function scrapeCsstAtProfiles(steamIds: string[], delayMs = SCRAPE_DELAY_MS): Promise<HeroScrape> {
  const profiles = new Map<string, LeetifyProfile>();
  if (steamIds.length === 0) return { profiles, status: HERO_READY };

  const fetchImpl = fetchOverride ?? globalThis.fetch;
  const origin = csstOrigin();
  const errors = new Map<string, string>();

  try {
    let next = 0;
    let cloudflareBlocked = false;

    const worker = async () => {
      while (next < steamIds.length && !cloudflareBlocked) {
        const i = next++;
        const sid = steamIds[i];
        const profileUrl = `${origin}/profile/${sid}`;
        const elementId = `leetify-extra-meta-${sid}`;
        try {
          debug("hero", "Fetching", sid);
          const res = await fetchImpl(`${origin}/${sid}/leetify-extra`, {
            headers: {
              "HX-Request": "true",
              "HX-Trigger": elementId,
              "HX-Target": elementId,
              "HX-Current-URL": profileUrl,
              Referer: profileUrl,
              Accept: "*/*",
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          debug("hero", sid, "→ status", res.status);
          if (res.status === 200) {
            const profile = parseCsstAtHtml(await res.text(), sid);
            debug("hero", sid, "→ parsed:", profile ? "profile" : "null");
            if (profile) profiles.set(sid, profile);
          } else if (res.status !== 404) {
            const body = res.status === 403 ? await res.text().catch(() => "") : "";
            const cf = res.status === 403 && isCloudflareChallenge(res, body);
            const msg = cf ? "Cloudflare challenge (HTTP 403)" : `HTTP ${res.status}`;
            errors.set(sid, msg);
            if (cf) cloudflareBlocked = true;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          debug("hero", sid, "→ fetch error:", msg);
          errors.set(sid, msg);
        }

        if (next < steamIds.length && !cloudflareBlocked && delayMs > 0) {
          const jitter = Math.floor(Math.random() * 400);
          await new Promise((r) => setTimeout(r, delayMs + jitter));
        }
      }
    };

    const workers = Math.max(1, Math.min(SCRAPE_CONCURRENCY, steamIds.length));
    await Promise.all(Array.from({ length: workers }, worker));

    if (errors.size > 0 && (errors.size === steamIds.length || cloudflareBlocked)) {
      const firstErr = errors.values().next().value ?? "Unknown error";
      const problem: HeroProblem = firstErr.toLowerCase().includes("timeout") || firstErr.toLowerCase().includes("aborted")
        ? "timeout"
        : "site-unreachable";
      const detail = Array.from(errors.entries()).map(([id, m]) => `${id}: ${m}`).join("\n");
      return { profiles, status: reported(unavailable(problem, `csst.at didn't answer: ${firstLine(firstErr)}`, detail)) };
    }

    return {
      profiles,
      status: reported(HERO_READY),
      failed: errors.size > 0 ? errors : undefined,
    };
  } catch (e) {
    return { profiles, status: unexpectedHeroFailure(e) };
  }
}
