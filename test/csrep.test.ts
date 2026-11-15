import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../src/main/controller";
import { CsrepError, CsrepScraper, normalizeFlaresolverrUrl, toCsrepSummary } from "../src/main/csrep";
import { parseCsrepHtml, type CsrepProfile } from "../src/main/csrep-parse";
import type { GameSource } from "../src/main/game/source";
import { mergeCsrepReputation } from "../src/main/reputation";
import { settingsFileStore, type KeyCrypto } from "../src/main/settings-file";
import type { MatchState } from "../src/shared/types";

const STEAM_A = "76561198149190660";
const STEAM_B = "76561198000000001";

const SAMPLE_CSREP_HTML = `
<html><body>
  <h1>[FR] enzomtp</h1>
  <button><span>1 Ban</span></button>
  <button><span>0 Flags</span></button>
  <button><span>0 Bans</span></button>
  <div>Trust Score <span>99%</span></div>
  <h2>Stats Overview</h2>
  <div>Time to Damage <span>543ms</span></div>
  <div>Preaim <span>10.9°</span></div>
  <div>Aim Accuracy <span>19.4%</span></div>
  <div>Head Accuracy <span>15.4%</span></div>
  <div><span class="section-label">Playtime</span><span class="font-display text-sm">1,383 h</span></div>
  <div><span class="section-label">Inventory</span><a href="/inventory">$701</a></div>
</body></html>
`;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("parseCsrepHtml", () => {
  it("parses Trust Score, Bans, Flags, Playtime, Inventory, and fallback metrics", () => {
    const parsed = parseCsrepHtml(SAMPLE_CSREP_HTML, STEAM_A);
    expect(parsed).toEqual({
      steamId: STEAM_A,
      trustScore: 99,
      bansCount: 1,
      flagsCount: 0,
      cs2Hours: 1383,
      inventoryUsd: 701,
      reactionMs: 543,
      preaim: 10.9,
      aimAccuracy: 19.4,
      headAccuracy: 15.4,
    });
  });

  it("returns null for Cloudflare challenge pages or missing player data", () => {
    expect(parseCsrepHtml("<html><script>window._cf_chl_opt={}</script></html>", STEAM_A)).toBeNull();
    expect(parseCsrepHtml("<html><body>Player not found</body></html>", STEAM_A)).toBeNull();
  });
});

describe("normalizeFlaresolverrUrl", () => {
  it("normalizes base URLs to /v1 and rejects non-http protocols", () => {
    expect(normalizeFlaresolverrUrl("http://localhost:8191")).toBe("http://localhost:8191/v1");
    expect(normalizeFlaresolverrUrl("http://localhost:8191/v1/")).toBe("http://localhost:8191/v1");
    expect(normalizeFlaresolverrUrl("ftp://localhost:8191")).toBeNull();
    expect(normalizeFlaresolverrUrl("not a url")).toBeNull();
  });
});

describe("CsrepScraper", () => {
  it("returns empty map when no FlareSolverr URL is configured", async () => {
    const fetchSpy = vi.fn();
    const scraper = new CsrepScraper(null, fetchSpy as unknown as typeof fetch);
    expect((await scraper.fetchPlayers([STEAM_A], 0)).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses FlareSolverr on first request, caches cf_clearance + UA, and reuses net.fetch for next player", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://localhost:8191/v1") {
        const body = JSON.parse(String(init?.body)) as { cmd: string; url: string };
        expect(body.cmd).toBe("request.get");
        expect(body.url).toBe(`https://csrep.gg/player/${STEAM_A}`);
        return jsonResponse({
          status: "ok",
          solution: {
            status: 200,
            response: SAMPLE_CSREP_HTML,
            cookies: [{ name: "cf_clearance", value: "abc123" }],
            userAgent: "MockUA/1.0",
          },
        });
      }
      if (url === `https://csrep.gg/player/${STEAM_B}`) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Cookie).toBe("cf_clearance=abc123");
        expect(headers["User-Agent"]).toBe("MockUA/1.0");
        return new Response(SAMPLE_CSREP_HTML.replace("1 Ban", "0 Bans").replace("99%", "85%"), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const scraper = new CsrepScraper("http://localhost:8191", fetchSpy as unknown as typeof fetch);
    const map = await scraper.fetchPlayers([STEAM_A, STEAM_B], 0);
    expect(map.get(STEAM_A)?.trustScore).toBe(99);
    expect(map.get(STEAM_B)?.trustScore).toBe(85);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("re-solves via FlareSolverr if cached cf_clearance receives a 403 challenge", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      calls++;
      const url = String(input);
      if (url === "http://localhost:8191/v1") {
        return jsonResponse({
          status: "ok",
          solution: {
            status: 200,
            response: SAMPLE_CSREP_HTML,
            cookies: [{ name: "cf_clearance", value: `token-${calls}` }],
            userAgent: "MockUA/1.0",
          },
        });
      }
      // Cached clearance gets 403 once
      return new Response("<html>Just a moment</html>", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      });
    });

    const scraper = new CsrepScraper("http://localhost:8191", fetchSpy as unknown as typeof fetch);
    await scraper.fetchPlayer(STEAM_A);
    const second = await scraper.fetchPlayer(STEAM_B);
    expect(second?.trustScore).toBe(99);
    expect(calls).toBe(3); // FlareSolverr(A) -> direct 403(B) -> FlareSolverr(B)
  });

  it("throws proxy-unreachable when FlareSolverr cannot be reached", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const scraper = new CsrepScraper("http://localhost:8191", fetchSpy as unknown as typeof fetch);
    await expect(scraper.fetchPlayers([STEAM_A], 0)).rejects.toBeInstanceOf(CsrepError);
    await expect(scraper.fetchPlayers([STEAM_A], 0)).rejects.toMatchObject({ kind: "proxy-unreachable" });
  });
});

describe("mergeCsrepReputation & toCsrepSummary", () => {
  it("overrides non-banned reputation to BANNED when bansCount > 0", () => {
    const p: CsrepProfile = {
      steamId: STEAM_A,
      trustScore: 99,
      bansCount: 1,
      flagsCount: 0,
      cs2Hours: 1383,
      inventoryUsd: 701,
      reactionMs: 543,
      preaim: 10.9,
      aimAccuracy: 19.4,
      headAccuracy: 15.4,
    };
    expect(mergeCsrepReputation({ score: 88, tier: "TRUSTED", confidence: 0.9, reasons: [] }, p)).toEqual({
      score: 0,
      tier: "BANNED",
      confidence: 1,
      reasons: ["Ban on record (CSRep: 1 ban)"],
    });
    expect(toCsrepSummary(p)).toEqual({
      trustScore: 99,
      bansCount: 1,
      flagsCount: 0,
      cs2Hours: 1383,
      inventoryUsd: 701,
    });
  });

  it("preserves Leetify score/tier while appending flags, low hours, and low trust", () => {
    const p: CsrepProfile = {
      steamId: STEAM_A,
      trustScore: 35,
      bansCount: 0,
      flagsCount: 2,
      cs2Hours: 95,
      inventoryUsd: null,
      reactionMs: null,
      preaim: null,
      aimAccuracy: null,
      headAccuracy: null,
    };
    expect(mergeCsrepReputation({ score: 72, tier: "NORMAL", confidence: 0.8, reasons: [] }, p)).toEqual({
      score: 72,
      tier: "NORMAL",
      confidence: 0.8,
      reasons: ["CSRep flagged (2)", "Low CS2 hours (95h on CSRep)", "Low CSRep trust (35%)"],
    });
  });
});

describe("settingsFileStore flaresolverrUrl", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("persists and loads flaresolverrUrl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs2clean-csrep-"));
    dirs.push(dir);
    const keychain: KeyCrypto = {
      isAvailable: () => false,
      encrypt: (s) => s,
      decrypt: (s) => s,
    };
    const store = settingsFileStore(join(dir, "settings.json"), keychain);
    store.save({ flaresolverrUrl: "http://localhost:8191/v1" });
    expect(store.load().flaresolverrUrl).toBe("http://localhost:8191/v1");
  });
});

describe("Controller CSRep FlareSolverr integration", () => {
  function fakeSource(): { source: GameSource; emitMatch: (m: MatchState | null) => void } {
    const emitter = new EventEmitter() as GameSource;
    emitter.kind = "steam";
    emitter.start = () => {};
    emitter.stop = () => {};
    return {
      source: emitter,
      emitMatch: (m) => emitter.emit("match", m),
    };
  }

  it("enriches lobby rows via FlareSolverr and stays non-blocking when FlareSolverr is down", async () => {
    let proxyDown = false;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://localhost:8191/v1") {
        if (proxyDown) throw new Error("ECONNREFUSED");
        return jsonResponse({
          status: "ok",
          solution: {
            status: 200,
            response: SAMPLE_CSREP_HTML,
            cookies: [{ name: "cf_clearance", value: "tok" }],
            userAgent: "UA",
          },
        });
      }
      return jsonResponse({
        name: "PlayerA",
        steam64_id: STEAM_A,
        total_matches: 40,
        winrate: 0.5,
        ranks: { leetify: 1.0, premier: 15000, faceit: 6 },
        rating: { aim: 50, positioning: 50, utility: 50, clutch: 0.1, opening: 0.05 },
        stats: {
          preaim: 12,
          reaction_time_ms: 550,
          accuracy_head: 20,
          spray_accuracy: 35,
          accuracy_enemy_spotted: 34,
          counter_strafing_good_shots_ratio: 80,
          ct_opening_duel_success_percentage: 50,
          t_opening_duel_success_percentage: 50,
        },
        bans: [],
        recent_matches: [],
      });
    });

    const { source, emitMatch } = fakeSource();
    let saved: Record<string, unknown> = { flaresolverrUrl: "http://localhost:8191/v1" };
    const controller = new Controller({
      version: "1.6.1",
      source,
      store: { load: () => saved, save: (s) => { saved = s as Record<string, unknown>; } },
      overlay: { hotkey: "Shift+F2", detailHotkey: "F7", cycleHotkey: "F6", previousHotkey: "Shift+F6", mode: "none", visible: false, view: "lobby", focusSlot: null, siren: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      scrape: async () => ({ ok: false, reason: "disabled in test" }),
    });

    controller.start();
    emitMatch({
      map: "de_mirage",
      mode: "premier",
      phase: "live",
      players: [{ slot: 1, name: "PlayerA", steamId: STEAM_A, isLocal: false, side: "CT" }],
    });

    await vi.waitFor(() => expect(controller.state.lobby.rows[0]?.status).toBe("ok"));
    const row = controller.state.lobby.rows[0];
    expect(controller.state.csrep.reachable).toBe(true);
    expect(row.reputation?.tier).toBe("BANNED");
    expect(row.classification).toBe("VERY_HIGH");
    expect(row.csrep?.trustScore).toBe(99);
    expect(row.csrep?.cs2Hours).toBe(1383);

    proxyDown = true;
    expect(controller.setFlaresolverrUrl("http://localhost:8191")).toBe(true);
    await vi.waitFor(() => expect(controller.state.csrep.reachable).toBe(false));
    expect(controller.state.notice).toContain("FlareSolverr");
    expect(controller.state.lobby.rows[0]?.status).toBe("ok");

    controller.clearFlaresolverrUrl();
    expect(controller.state.csrep.hasProxy).toBe(false);
    controller.stop();
  });
});
