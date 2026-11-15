import { describe, expect, it, vi } from "vitest";
import { Controller, type Settings } from "../src/main/controller";
import { FaceitClient, FaceitError, parseFaceitPlayer } from "../src/main/faceit";
import { GameSource } from "../src/main/game/source";
import { HERO_READY } from "../src/main/leetify-hero";
import type { MatchState } from "../src/shared/types";
import { AVERAGE } from "./profiles";

class FakeSource extends GameSource {
  readonly kind = "steam" as const;
  start() {}
  stop() {}
  emitMatch(m: MatchState | null) {
    this.emit("match", m);
  }
}

const memStore = (initial: Settings = {}) => {
  let saved = { ...initial };
  return {
    load: () => saved,
    save: (s: Settings) => { saved = { ...s }; },
  };
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parseFaceitPlayer", () => {
  it("extracts CS2 skill_level and rounded faceit_elo", () => {
    expect(parseFaceitPlayer({ games: { cs2: { skill_level: 8, faceit_elo: 1742.6 } } })).toEqual({
      level: 8,
      elo: 1743,
    });
  });

  it("ignores out-of-range levels and non-positive elo", () => {
    expect(parseFaceitPlayer({ games: { cs2: { skill_level: 11, faceit_elo: 0 } } })).toBeNull();
    expect(parseFaceitPlayer({ games: { cs2: { skill_level: 0, faceit_elo: 1500 } } })).toEqual({
      level: null,
      elo: 1500,
    });
  });

  it("returns null when games.cs2 is missing", () => {
    expect(parseFaceitPlayer({ games: { csgo: { skill_level: 10, faceit_elo: 2500 } } })).toBeNull();
    expect(parseFaceitPlayer(null)).toBeNull();
  });
});

describe("FaceitClient", () => {
  it("sends Bearer authorization and returns rank info", async () => {
    let seenAuth: string | null = null;
    let seenUrl = "";
    const client = new FaceitClient("secret-key", (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get("Authorization");
      return jsonResponse(200, { games: { cs2: { skill_level: 9, faceit_elo: 1920 } } });
    }) as typeof fetch);

    const res = await client.fetchPlayer("76561198000000001");
    expect(seenUrl).toBe("https://open.faceit.com/data/v4/players?game=cs2&game_player_id=76561198000000001");
    expect(seenAuth).toBe("Bearer secret-key");
    expect(res).toEqual({ level: 9, elo: 1920 });
  });

  it("returns null on 404 and throws FaceitError on 401/403", async () => {
    const client404 = new FaceitClient("k", (async () => jsonResponse(404, {})) as typeof fetch);
    expect(await client404.fetchPlayer("76561198000000001")).toBeNull();

    const client401 = new FaceitClient("bad", (async () => jsonResponse(401, {})) as typeof fetch);
    await expect(client401.fetchPlayer("76561198000000001")).rejects.toBeInstanceOf(FaceitError);
  });

  it("fetchPlayers skips 404s and collects found players", async () => {
    const client = new FaceitClient("k", (async (url: string) => {
      if (url.includes("001")) return jsonResponse(200, { games: { cs2: { skill_level: 7, faceit_elo: 1600 } } });
      return jsonResponse(404, {});
    }) as typeof fetch);

    const map = await client.fetchPlayers(["76561198000000001", "76561198000000002"]);
    expect(map.size).toBe(1);
    expect(map.get("76561198000000001")).toEqual({ level: 7, elo: 1600 });
  });
});

describe("Controller FACEIT fallback", () => {
  it("enriches Leetify players missing FACEIT data and NO_DATA players, while skipping players Leetify already ranked", async () => {
    const faceitLookups: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      if (u.hostname === "open.faceit.com") {
        const id = u.searchParams.get("game_player_id") ?? "";
        faceitLookups.push(id);
        if (id === "76561198000000002") {
          return jsonResponse(200, { games: { cs2: { skill_level: 8, faceit_elo: 1780 } } });
        }
        if (id === "76561198000000003") {
          return jsonResponse(200, { games: { cs2: { skill_level: 10, faceit_elo: 2450 } } });
        }
        return jsonResponse(404, {});
      }

      const id = u.searchParams.get("steam64_id") ?? "";
      if (id === "76561198000000001") {
        const p = AVERAGE();
        p.ranks = { ...p.ranks, faceit: 6, faceit_elo: 1410 };
        return jsonResponse(200, p);
      }
      if (id === "76561198000000002") {
        const p = AVERAGE();
        p.ranks = { leetify: 0.5, premier: 15000, faceit: null, faceit_elo: null };
        return jsonResponse(200, p);
      }
      return jsonResponse(404, { error: "not found" });
    }) as typeof fetch;

    const source = new FakeSource();
    const controller = new Controller({
      version: "1.0.0",
      source,
      store: memStore({ faceitKey: "faceit-key" }),
      fetchImpl,
      scrape: async () => ({ profiles: new Map(), failed: new Map(), status: HERO_READY }),
      lobby: { debounceMs: 0 },
      overlay: { hotkey: "Shift+F2", detailHotkey: "F7", cycleHotkey: "F6", previousHotkey: "Shift+F6", mode: "none", visible: false, view: "lobby", focusSlot: null },
    });
    controller.start();

    source.emitMatch({
      map: "de_mirage",
      mode: "premier",
      phase: "live",
      players: [
        { slot: 0, name: "HasLeetifyFaceit", steamId: "76561198000000001", isLocal: false, side: "CT" },
        { slot: 1, name: "MissingFaceit", steamId: "76561198000000002", isLocal: false, side: "CT" },
        { slot: 2, name: "NoLeetifyData", steamId: "76561198000000003", isLocal: false, side: "T" },
      ],
    });

    await vi.waitFor(() => {
      expect(controller.state.lobby.rows.every((r) => r.status === "ok")).toBe(true);
    });

    expect(faceitLookups).not.toContain("76561198000000001");
    expect(faceitLookups).toContain("76561198000000002");
    expect(faceitLookups).toContain("76561198000000003");

    const row1 = controller.state.lobby.rows[0];
    expect(row1.detail?.metrics.faceit).toBe(6);
    expect(row1.detail?.metrics.faceitElo).toBe(1410);

    const row2 = controller.state.lobby.rows[1];
    expect(row2.detail?.metrics.faceit).toBe(8);
    expect(row2.detail?.metrics.faceitElo).toBe(1780);
    expect(row2.faceit).toEqual({ level: 8, elo: 1780 });

    const row3 = controller.state.lobby.rows[2];
    expect(row3.detail).toBeNull();
    expect(row3.faceit).toEqual({ level: 10, elo: 2450 });
    expect(controller.state.faceit).toEqual({ hasKey: true, reachable: true });

    controller.stop();
  });

  it("updates state.faceit on setFaceitApiKey and clearFaceitApiKey", async () => {
    const source = new FakeSource();
    const controller = new Controller({
      version: "1.0.0",
      source,
      store: memStore(),
      fetchImpl: (async () => jsonResponse(404, {})) as typeof fetch,
      overlay: { hotkey: "Shift+F2", detailHotkey: "F7", cycleHotkey: "F6", previousHotkey: "Shift+F6", mode: "none", visible: false, view: "lobby", focusSlot: null },
    });

    expect(controller.state.faceit).toEqual({ hasKey: false, reachable: null });
    expect(await controller.setFaceitApiKey("   ")).toBe(false);
    expect(await controller.setFaceitApiKey("my-faceit-key")).toBe(true);
    expect(controller.state.faceit).toEqual({ hasKey: true, reachable: null });

    controller.clearFaceitApiKey();
    expect(controller.state.faceit).toEqual({ hasKey: false, reachable: null });
  });
});
