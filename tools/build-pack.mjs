import process from "node:process";
import { buildPack } from "./lib/builder.mjs";
import { DEFAULT_MODE, discoverTranslatedPacks, getPf2eManifest, parseArgs } from "./lib/common.mjs";
import { discoverBuiltPacks, generateManifest } from "./lib/manifest.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pack = args.positional[0];
  const mode = args.mode ?? DEFAULT_MODE;
  const uuidMode = args.uuidMode ?? "all";

  if (!pack) {
    console.error("Usage: npm run build:pack -- <pack-name> [--mode ko-en] [--uuid-mode all|text|none]");
    process.exit(2);
  }
  if (!["all", "text", "none"].includes(uuidMode)) {
    throw new Error(`Invalid --uuid-mode '${uuidMode}'. Use all, text, or none.`);
  }

  const manifest = await getPf2eManifest();
  const translated = await discoverTranslatedPacks(mode);
  if (!translated.has(pack)) throw new Error(`No ${mode} translation file exists for '${pack}'.`);

  // For an individual build, redirect only to mirrors already built plus this pack.
  // build:all knows the whole target set in advance and can therefore redirect all
  // cross-pack references in one pass.
  const built = new Set(await discoverBuiltPacks());
  built.add(pack);

  console.log(`PF2e-KR v2 builder`);
  console.log(`Pack             : ${pack}`);
  console.log(`Translation mode : ${mode}`);
  console.log(`UUID mode        : ${uuidMode}`);

  const report = await buildPack(pack, {
    mode,
    uuidMode,
    mirroredPacks: built,
    manifest
  });

  const selected = await discoverBuiltPacks();
  await generateManifest(selected, mode);

  console.log("");
  console.log(`Done             : ${report.translated}/${report.sourceDocuments} translated`);
  console.log(`Missing          : ${report.untranslatedSource.length}`);
  console.log(`Orphans          : ${report.orphanTranslations.length}`);
  console.log(`Ambiguous        : ${report.ambiguousSourceNames.length}`);
  console.log(`Warnings         : ${report.warnings.length}`);
  console.log(`Remaining mirrors: ${report.remainingOfficialMirrorReferences.length}`);
  console.log(`Manifest packs   : ${selected.length}`);
}

main().catch((error) => {
  console.error("PF2e-KR build failed:");
  console.error(error);
  process.exit(1);
});
