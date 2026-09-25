import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

export const MODULE_ID = "PF2e-KR";
export const ROOT = process.cwd();
/*
 * Where Foundry's Data folder is. Machine-specific, so it is NOT in git:
 *   1. env FOUNDRY_DATA (or legacy PF2E_SYSTEM = .../Data/systems/pf2e)
 *   2. tools/local.config.json  { "foundryData": "C:/.../Data" }   ← recommended
 *   3. ../../  (this repo sitting in Data/modules/PF2e-KR)
 */
function readLocalConfig() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "tools", "local.config.json"), "utf8"));
  } catch {
    return {};
  }
}
const LOCAL = readLocalConfig();
export const LOCAL_CONFIG = LOCAL;
export const FOUNDRY_DATA = path.resolve(
  process.env.FOUNDRY_DATA
  ?? (process.env.PF2E_SYSTEM ? path.join(process.env.PF2E_SYSTEM, "..", "..") : null)
  ?? LOCAL.foundryData
  ?? path.join(ROOT, "..", "..")
);
export const PF2E_ROOT = path.resolve(process.env.PF2E_SYSTEM ?? path.join(FOUNDRY_DATA, "systems", "pf2e"));
/** Where `npm run deploy` copies the playable module. */
export const DEPLOY_DIR = path.resolve(process.env.PF2EKR_DEPLOY ?? LOCAL.deployDir ?? path.join(FOUNDRY_DATA, "modules", MODULE_ID));
export const DEFAULT_MODE = process.env.PF2EKR_MODE ?? "ko-en";

export async function readJSON(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJSON(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function emptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getPf2eManifest() {
  return readJSON(path.join(PF2E_ROOT, "system.json"));
}

export async function discoverTranslatedPacks(mode = DEFAULT_MODE) {
  const dir = path.join(ROOT, "compendium", mode);
  const files = await fs.readdir(dir, { withFileTypes: true });
  return new Set(
    files
      .filter((entry) => entry.isFile() && /^pf2e\..+\.json$/i.test(entry.name))
      .map((entry) => entry.name.replace(/^pf2e\./, "").replace(/\.json$/i, ""))
  );
}

export function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args.positional.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inlineValue !== undefined) args[key] = inlineValue;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[key] = argv[++i];
    else args[key] = true;
  }
  return args;
}
