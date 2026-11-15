import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { playerCacheFileStore, type CachedPlayerEntry } from "../src/main/player-cache";

const dirs: string[] = [];
function tempFile(name = "player-cache.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "cs2clean-cache-"));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function entry(at: number, overrides: Partial<CachedPlayerEntry> = {}): CachedPlayerEntry {
  return {
    classification: "NORMAL",
    totalMatches: 42,
    name: "Player",
    detail: null,
    reputation: null,
    csrep: null,
    note: null,
    at,
    recheckAfterMs: null,
    ...overrides,
  };
}

describe("playerCacheFileStore", () => {
  it("persists and reloads fresh entries, pruning expired ones", () => {
    const file = tempFile();
    let now = 1_000_000;
    const store = playerCacheFileStore(file, { ttlMs: 10_000, now: () => now });

    const map = new Map<string, CachedPlayerEntry>([
      ["76561198000000001", entry(995_000, { name: "Fresh" })],
      ["76561198000000002", entry(980_000, { name: "Expired" })],
      ["76561198000000003", entry(999_000, { name: "ShortTtlExpired", recheckAfterMs: 500 })],
    ]);
    store.save(map);

    const loaded = store.load();
    expect(loaded.size).toBe(1);
    expect(loaded.get("76561198000000001")?.name).toBe("Fresh");
  });

  it("caps stored entries to maxEntries keeping the newest", () => {
    const file = tempFile();
    const store = playerCacheFileStore(file, { ttlMs: 60_000, maxEntries: 2, now: () => 10_000 });
    store.save(new Map([
      ["76561198000000001", entry(5_000, { name: "Oldest" })],
      ["76561198000000002", entry(8_000, { name: "Middle" })],
      ["76561198000000003", entry(9_000, { name: "Newest" })],
    ]));

    const loaded = store.load();
    expect([...loaded.keys()]).toEqual(["76561198000000003", "76561198000000002"]);
  });

  it("recovers cleanly from corrupted JSON", () => {
    const file = tempFile();
    writeFileSync(file, "{not valid json", "utf8");
    const store = playerCacheFileStore(file);
    expect(store.load().size).toBe(0);
  });
});
