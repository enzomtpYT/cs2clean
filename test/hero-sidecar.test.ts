import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HERO_READY,
  checkHeroRuntime,
  configureHero,
  onHeroStatus,
  scrapeCsstAtProfiles,
  unexpectedHeroFailure,
  type HeroStatus,
} from "../src/main/leetify-hero";

const ID_A = "76561198000000001";
const ID_B = "76561198000000002";
const SAMPLE_HTML = readFileSync(join(process.cwd(), "fixtures/csst-leetify-extra.html"), "utf8");

describe("browserless csst.at fallback", () => {
  afterEach(() => {
    configureHero({ fetchImpl: globalThis.fetch, origin: "https://csst.at" });
  });

  it("checkHeroRuntime reports ready immediately without an external browser", async () => {
    const seen: HeroStatus[] = [];
    const off = onHeroStatus((s) => seen.push(s));
    try {
      const status = await checkHeroRuntime();
      expect(status).toEqual(HERO_READY);
      expect(seen).toEqual([HERO_READY]);
    } finally {
      off();
    }
  });

  it("fetches csst.at/<id>/leetify-extra with HTMX headers and parses profiles", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      expect(headers["HX-Request"]).toBe("true");
      if (url.endsWith(`/${ID_A}/leetify-extra`)) {
        expect(headers["HX-Target"]).toBe(`leetify-extra-meta-${ID_A}`);
        expect(headers["Referer"]).toBe(`https://csst.at/profile/${ID_A}`);
        return new Response(SAMPLE_HTML, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    configureHero({ fetchImpl: fetchSpy as unknown as typeof fetch });
    const res = await scrapeCsstAtProfiles([ID_A, ID_B], 0);
    expect(res.status).toEqual(HERO_READY);
    expect(res.profiles.has(ID_A)).toBe(true);
    expect(res.profiles.has(ID_B)).toBe(false);
    expect(res.failed).toBeUndefined();
  });

  it("marks fallback unavailable when all players hit a Cloudflare 403 challenge", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      }),
    );

    configureHero({ fetchImpl: fetchSpy as unknown as typeof fetch });
    const res = await scrapeCsstAtProfiles([ID_A], 0);
    expect(res.profiles.size).toBe(0);
    expect(res.status.state).toBe("unavailable");
    expect(res.status.problem).toBe("site-unreachable");
    expect(res.status.reason).toContain("Cloudflare challenge");
  });

  it("returns partial results and failed map when only one player fails", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes(ID_A)) return new Response(SAMPLE_HTML, { status: 200 });
      throw new Error("ECONNRESET");
    });

    configureHero({ fetchImpl: fetchSpy as unknown as typeof fetch });
    const res = await scrapeCsstAtProfiles([ID_A, ID_B], 0);
    expect(res.status).toEqual(HERO_READY);
    expect(res.profiles.has(ID_A)).toBe(true);
    expect(res.failed?.get(ID_B)).toContain("ECONNRESET");
  });

  it("unexpectedHeroFailure turns an exception into a status instead of throwing", () => {
    const status = unexpectedHeroFailure(new Error("kaboom"));
    expect(status.state).toBe("unavailable");
    expect(status.problem).toBe("crashed");
    expect(status.reason).toContain("kaboom");
  });
});
