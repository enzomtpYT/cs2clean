// settings.json in the app's data folder, kept free of Electron so the tests can run it (main.ts passes in the real
// OS keychain).
//
// Two writers share the file: the settings store below (keys, siren, hotkeys...) and the update check, which notes
// when it last asked GitHub (`lastUpdateCheck`). Each one must leave the other's entries alone, so a save starts from
// what is on disk and only replaces the entries it owns.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Settings, SettingsStore } from "./controller";

/** What the file needs from the OS keychain (Electron's safeStorage in the app). */
export interface KeyCrypto {
  isAvailable(): boolean;
  /** Returns the encrypted text as base64. */
  encrypt(plain: string): string;
  decrypt(base64: string): string;
}

/** The entries `save` writes itself. Everything else in the file (lastUpdateCheck, say) belongs to someone else. */
const OWN_KEYS = new Set(["leetifyKey", "leetifyKeyEnc", "steamApiKey", "steamApiKeyEnc", "csrepApiKey", "csrepApiKeyEnc", "siren", "autoOpenFriendsList", "hotkeys"]);

/** The file's entries, or none when it is missing, unreadable or not a JSON object. */
function readRaw(file: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function decryptKey(enc: unknown, plain: unknown, keychain: KeyCrypto): string | null {
  if (typeof enc === "string" && enc && keychain.isAvailable()) {
    try {
      return keychain.decrypt(enc);
    } catch {
      // One unreadable keychain entry must not wipe out the remaining settings.
    }
  }
  return typeof plain === "string" && plain ? plain : null;
}

/** The API keys are encrypted with the OS keychain when there is one, and stored as plain text when there isn't. */
export function settingsFileStore(file: string, keychain: KeyCrypto): SettingsStore {
  return {
    load(): Settings {
      if (!existsSync(file)) return {};
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
        const leetifyKey = decryptKey(raw.leetifyKeyEnc, raw.leetifyKey, keychain);
        const steamApiKey = decryptKey(raw.steamApiKeyEnc, raw.steamApiKey, keychain);
        const csrepApiKey = decryptKey(raw.csrepApiKeyEnc, raw.csrepApiKey, keychain);
        return {
          leetifyKey,
          steamApiKey,
          csrepApiKey,
          siren: typeof raw.siren === "boolean" ? raw.siren : undefined,
          autoOpenFriendsList: typeof raw.autoOpenFriendsList === "boolean" ? raw.autoOpenFriendsList : undefined,
          hotkeys: raw.hotkeys && typeof raw.hotkeys === "object" && !Array.isArray(raw.hotkeys)
            ? (raw.hotkeys as Settings["hotkeys"])
            : undefined,
        };
      } catch {
        return {};
      }
    },
    save(s: Settings) {
      const out: Record<string, unknown> = { siren: s.siren, autoOpenFriendsList: s.autoOpenFriendsList, hotkeys: s.hotkeys };
      if (s.leetifyKey && keychain.isAvailable()) out.leetifyKeyEnc = keychain.encrypt(s.leetifyKey);
      else if (s.leetifyKey) out.leetifyKey = s.leetifyKey;
      if (s.steamApiKey && keychain.isAvailable()) out.steamApiKeyEnc = keychain.encrypt(s.steamApiKey);
      else if (s.steamApiKey) out.steamApiKey = s.steamApiKey;
      if (s.csrepApiKey && keychain.isAvailable()) out.csrepApiKeyEnc = keychain.encrypt(s.csrepApiKey);
      else if (s.csrepApiKey) out.csrepApiKey = s.csrepApiKey;
      // What this store doesn't own stays as it was.
      for (const [k, v] of Object.entries(readRaw(file))) if (!OWN_KEYS.has(k)) out[k] = v;
      writeFileSync(file, JSON.stringify(out, null, 2), { encoding: "utf8", mode: 0o600 });
    },
  };
}

/** When GitHub was last asked for a newer release (ms since the epoch), or null when it never was. */
export function readLastUpdateCheck(file: string): number | null {
  const at = readRaw(file).lastUpdateCheck;
  return typeof at === "number" ? at : null;
}

/** Notes that GitHub was asked at `at`, keeping everything else in the file. */
export function noteUpdateCheck(file: string, at: number): void {
  const raw = readRaw(file);
  raw.lastUpdateCheck = at;
  writeFileSync(file, JSON.stringify(raw, null, 2));
}
