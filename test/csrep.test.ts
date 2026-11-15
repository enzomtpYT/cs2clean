import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Controller } from "../src/main/controller";
import { CsrepClient, CsrepError, toCsrepSummary, type CsrepPlayer } from "../src/main/csrep";
import type { GameSource } from "../src/main/game/source";
import { mergeCsrepReputation } from "../src/main/reputation";
import { settingsFileStore, type KeyCrypto } from "../src/main/settings-file";
import type { MatchState } from "../src/shared/types";

const STEAM_A = "76561198149190660";
const STEAM_B = "76561198000000001";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("CsrepClient", () => {
  it("returns empty map when apiKey is missing or no valid Steam64 IDs are given", async () => {
    const fetchSpy = vi.fn();
    const noKey = new CsrepClient(null, fetchSpy as unknown as typeof fetch);
    expect((await noKey.fetchPlayers([STEAM_A])).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const withKey = new CsrepClient("secret", fetchSpy as unknown as typeof fetch);
    expect((await withKey.fetchPlayers(["not-a-steam-id"])).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batch-fetches valid Steam64 IDs with X-API-Key header", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(`https://csrep.gg/api/players?ids=${encodeURIComponent(`${STEAM_A},${STEAM_B}`)}`);
      expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("my-key");
      return jsonResponse({
        status: "OK",
        result: [{ id: STEAM_A, cs2_hours: 1200, autoflag: null, bans: [] }],
      });
    });

    const client = new CsrepClient("my-key", fetchSpy as unknown as typeof fetch);
    const res = await client.fetchPlayers([STEAM_A, STEAM_A, "bad", STEAM_B]);
    expect(res.size).toBe(1);
    expect(res.get(STEAM_A)?.cs2_hours).toBe(1200);
  });

  it("distinguishes Cloudflare 403 challenge from API key 401/403 errors", async () => {
    const cfFetch = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      }),
    );
    const cfClient = new CsrepClient("k", cfFetch as unknown as typeof fetch);
    await expect(cfClient.fetchPlayers([STEAM_A])).rejects.toMatchObject({
      name: "CsrepError",
      kind: "cloudflare-blocked",
    });

    const authFetch = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    const authClient = new CsrepClient("bad", authFetch as unknown as typeof fetch);
    await expect(authClient.fetchPlayers([STEAM_A])).rejects.toBeInstanceOf(CsrepError);
    await expect(authClient.fetchPlayers([STEAM_A])).rejects.toMatchObject({ kind: "invalid-key" });
  });

  it("maps 429 and network errors", async () => {
    const rateFetch = vi.fn(async () => jsonResponse({}, 429));
    await expect(new CsrepClient("k", rateFetch as unknown as typeof fetch).fetchPlayers([STEAM_A])).rejects.toMatchObject({
      kind: "rate-limit",
    });

    const netFetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(new CsrepClient("k", netFetch as unknown as typeof fetch).fetchPlayers([STEAM_A])).rejects.toMatchObject({
      kind: "network",
    });
  });
});

describe("mergeCsrepReputation & toCsrepSummary", () => {
  it("overrides non-banned or UNKNOWN reputation to BANNED when CSRep has a ban", () => {
    const csrep: CsrepPlayer = {
      id: STEAM_A,
      bans: [{ source: "STEAM", type: "VAC", starts_at: "2026-01-15T00:00:00Z" }],
    };
    const merged = mergeCsrepReputation({ score: 88, tier: "TRUSTED", confidence: 0.9, reasons: [] }, csrep);
    expect(merged).toEqual({
      score: 0,
      tier: "BANNED",
      confidence: 1,
      reasons: ["Ban on record (CSRep: STEAM VAC) since 2026-01-15"],
    });
  });

  it("preserves Leetify score/tier while appending autoflag and low CS2 hours", () => {
    const csrep: CsrepPlayer = {
      id: STEAM_A,
      cs2_hours: 95,
      autoflag: { id: "flag-1", has_snapshot: true },
      bans: [],
    };
    const merged = mergeCsrepReputation({ score: 72, tier: "NORMAL", confidence: 0.8, reasons: [] }, csrep);
    expect(merged).toEqual({
      score: 72,
      tier: "NORMAL",
      confidence: 0.8,
      reasons: ["CSRep autoflagged", "Low CS2 hours (95h on CSRep)"],
    });

    const summary = toCsrepSummary(csrep);
    expect(summary.autoflagged).toBe(true);
    expect(summary.cs2Hours).toBe(95);
    expect(summary.bans).toEqual([]);
  });
});

describe("settingsFileStore csrepApiKey", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("encrypts and decrypts csrepApiKey using keychain", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs2clean-csrep-"));
    dirs.push(dir);
    const keychain: KeyCrypto = {
      isAvailable: () => true,
      encrypt: (s) => Buffer.from(s, "utf8").toString("base64"),
      decrypt: (b) => Buffer.from(b, "base64").toString("utf8"),
    };
    const store = settingsFileStore(join(dir, "settings.json"), keychain);
    store.save({ csrepApiKey: "csrep-secret-123" });
    expect(store.load().csrepApiKey).toBe("csrep-secret-123");
  });
});

describe("Controller CSRep integration", () => {
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

  it("enriches lobby rows in parallel and stays non-blocking on Cloudflare 403", async () => {
    let csrepStatus = 200;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://csrep.gg/api/players")) {
        if (csrepStatus === 403) {
          return new Response("<html>Just a moment...</html>", {
            status: 403,
            headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
          });
        }
        return jsonResponse({
          status: "OK",
          result: [
            {
              id: STEAM_A,
              cs2_hours: 140,
              autoflag: { id: "af-1" },
              bans: [{ source: "STEAM", type: "VAC", starts_at: "2026-05-01T00:00:00Z" }],
            },
          ],
        });
      }
      // Leetify profile lookup returns a minimal clean profile
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
    let saved: Record<string, unknown> = { csrepApiKey: "csrep-key" };
    const controller = new Controller({
      version: "1.6.1",
      source,
      store: { load: () => saved, save: (s) => { saved = s as Record<string, unknown>; } },
      overlay: { hotkey: "Shift+F2", detailHotkey: "F7", cycleHotkey: "F6", previousHotkey: "Shift+F6", mode: "none", visible: false, view: "lobby", focusSlot: null, siren: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      scrape: async () => ({ ok: false, reason: "disabled in test" }),
    });

    expect(controller.csrepPlayerUrl(STEAM_A)).toBe(`https://csrep.gg/player/${STEAM_A}`);
    expect(controller.csrepPlayerUrl("invalid")).toBeNull();

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
    expect(row.csrep?.autoflagged).toBe(true);
    expect(row.csrep?.cs2Hours).toBe(140);

    // Now simulate Cloudflare 403 and re-clear cache
    csrepStatus = 403;
    controller.setCsrepKey("csrep-key-2");
    await vi.waitFor(() => expect(controller.state.csrep.reachable).toBe(false));
    expect(controller.state.notice).toContain("Cloudflare");
    expect(controller.state.lobby.rows[0]?.status).toBe("ok");

    controller.clearCsrepKey();
    expect(controller.state.csrep.hasKey).toBe(false);
    controller.stop();
  });
});
