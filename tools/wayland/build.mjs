// Builds the native Wayland wlr-layer-shell overlay helper (dist/wayland-overlay) on Linux.
// Exits silently on Windows/macOS so cross-platform builds remain unaffected.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const genDir = join(here, ".gen");
const outBin = join(root, "dist", "wayland-overlay");
const layerXml = join(here, "wlr-layer-shell-unstable-v1.xml");
const xdgXml = "/usr/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml";

function hasCommand(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasCommand("wayland-scanner") || !hasCommand("gcc") || !existsSync(xdgXml)) {
  console.warn("wayland-overlay: skipping native build (missing wayland-scanner, gcc, or wayland-protocols)");
  process.exit(0);
}

mkdirSync(genDir, { recursive: true });
mkdirSync(dirname(outBin), { recursive: true });

const xdgHeader = join(genDir, "xdg-shell-client-protocol.h");
const xdgCode = join(genDir, "xdg-shell-protocol.c");
const layerHeader = join(genDir, "wlr-layer-shell-unstable-v1-client-protocol.h");
const layerCode = join(genDir, "wlr-layer-shell-unstable-v1-protocol.c");

execFileSync("wayland-scanner", ["client-header", xdgXml, xdgHeader]);
execFileSync("wayland-scanner", ["private-code", xdgXml, xdgCode]);
execFileSync("wayland-scanner", ["client-header", layerXml, layerHeader]);
execFileSync("wayland-scanner", ["private-code", layerXml, layerCode]);

const cflags = execFileSync("pkg-config", ["--cflags", "wayland-client"], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
const libs = execFileSync("pkg-config", ["--libs", "wayland-client"], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);

execFileSync("gcc", [
  "-O2", "-Wall", "-Wextra",
  "-I", genDir,
  ...cflags,
  join(here, "wayland-overlay.c"),
  xdgCode,
  layerCode,
  "-o", outBin,
  ...libs,
], { stdio: "inherit" });

console.log(`Built ${outBin}`);
