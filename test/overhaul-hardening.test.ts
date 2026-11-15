import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCsstAtHtml } from "../src/main/csst-parse";
import { settingsFileStore, type KeyCrypto } from "../src/main/settings-file";
import { parseMiniprofileName } from "../src/main/steam/miniprofile";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("security & parser hardening", () => {
  it("does not throw on out-of-range numeric HTML entities in miniprofile", () => {
    const html = `<span class="persona online">Bad&#99999999;&#x110000;Name</span>`;
    expect(parseMiniprofileName(html)).toBe("Bad&#99999999;&#x110000;Name");
  });

  it("parses csst.at HTML in linear time even with unclosed quotes/tags", () => {
    const junk = `<div id="leetify-aim-76561198000000001"><span data-x="1>2">84.5</span></div>` + "<div ".repeat(500);
    const parsed = parseCsstAtHtml(junk, "76561198000000001");
    expect(parsed?.rating?.aim).toBe(84.5);
  });

  it("keeps remaining settings when one encrypted key fails to decrypt", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs2clean-settings-"));
    dirs.push(dir);
    const file = join(dir, "settings.json");
    writeFileSync(file, JSON.stringify({
      leetifyKeyEnc: "corrupt",
      steamApiKeyEnc: "good",
      siren: false,
      autoOpenFriendsList: false,
    }), "utf8");

    const keychain: KeyCrypto = {
      isAvailable: () => true,
      encrypt: (s) => s,
      decrypt: (b) => {
        if (b === "corrupt") throw new Error("bad keychain entry");
        return "steam-ok";
      },
    };
    const loaded = settingsFileStore(file, keychain).load();
    expect(loaded.leetifyKey).toBeNull();
    expect(loaded.steamApiKey).toBe("steam-ok");
    expect(loaded.siren).toBe(false);
    expect(loaded.autoOpenFriendsList).toBe(false);
  });
});
