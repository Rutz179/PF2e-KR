import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, rmSync } from "node:fs";
import { ROOT } from "./common.mjs";

/** Exactly what a player needs. */
export const DIST_ENTRIES = ["module.json", "packs", "lang", "src", "styles", "LICENSE.md", "README.md"];

export async function existingDistEntries() {
  const out = [];
  for (const entry of DIST_ENTRIES) {
    try { await fs.access(path.join(ROOT, entry)); out.push(entry); } catch { /* optional */ }
  }
  return out;
}

/** Windows 10+: built-in tar; macOS/Linux: zip. Verified by the "PK" signature. */
export function makeZip(zipPath, entries) {
  const tar = ["tar", ["-a", "-c", "-f", zipPath, "--exclude=LOCK", "--exclude=LOG", "--exclude=LOG.old", "--exclude=.gitkeep", ...entries]];
  const zip = ["zip", ["-r", "-q", zipPath, ...entries, "-x", "*/LOCK", "*/LOG", "*/LOG.old", "*/.gitkeep"]];
  for (const [cmd, args] of process.platform === "win32" ? [tar, zip] : [zip, tar]) {
    rmSync(zipPath, { force: true });
    const run = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
    if (run.status === 0 && isZip(zipPath)) return cmd;
  }
  throw new Error("zip을 만들 수 없습니다 (Windows 10 이상 또는 zip 필요).");
}

function isZip(file) {
  try {
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return buf.toString("latin1") === "PK";
  } catch {
    return false;
  }
}
