import process from "node:process";
import { DEFAULT_MODE, parseArgs } from "./lib/common.mjs";
import { discoverBuiltPacks, generateManifest } from "./lib/manifest.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? DEFAULT_MODE;
  const packs = await discoverBuiltPacks();
  const manifest = await generateManifest(packs, mode);
  console.log(`Generated module.json with ${manifest.packs.length} native packs (${mode}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
