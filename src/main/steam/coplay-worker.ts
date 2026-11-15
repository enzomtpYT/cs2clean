// Runs in its own utility process (see main.ts): reads Steam's players list and reports back.
// Kept out of the app's main process so a Steam client quirk can't take the app down, and reused across scans
// so koffi native bindings are loaded only once.

import { readCoplay } from "./coplay";

const port = (process as unknown as { parentPort: { on(e: "message", f: (m: { data?: unknown }) => void): void; postMessage(m: unknown): void } }).parentPort;

port.on("message", (m) => {
  const data = m?.data as { id?: number; localSteamId?: string | null } | string | undefined;
  const id = typeof data === "object" && data !== null ? data.id : undefined;
  const localSteamId = typeof data === "object" && data !== null ? data.localSteamId : null;
  try {
    port.postMessage({ id, ok: true, result: readCoplay(localSteamId) });
  } catch (e) {
    port.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
