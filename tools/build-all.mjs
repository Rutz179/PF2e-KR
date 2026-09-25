import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { buildPack } from "./lib/builder.mjs";
import {
  ROOT,
  DEFAULT_MODE,
  discoverTranslatedPacks,
  getPf2eManifest,
  parseArgs,
  writeJSON
} from "./lib/common.mjs";
import { generateManifest } from "./lib/manifest.mjs";

const CORE_PACKS = new Set([
  "action-macros",
  "actionspf2e",
  "ancestries",
  "ancestryfeatures",
  "backgrounds",
  "bestiary-effects",
  "boons-and-curses",
  "campaign-effects",
  "classes",
  "classfeatures",
  "conditionitems",
  "deities",
  "equipment-effects",
  "equipment-srd",
  "familiar-abilities",
  "feat-effects",
  "feats-srd",
  "heritages",
  "other-effects",
  "pathfinder-society-boons",
  "spell-effects",
  "spells-srd"
]);

async function hasUsablePack(pack) {
  const dir = path.join(ROOT, "packs", pack);
  try {
    const entries = await fs.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function loadExistingReport(pack) {
  const reportPath = path.join(ROOT, "reports", `${pack}.json`);
  try {
    return JSON.parse(await fs.readFile(reportPath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? DEFAULT_MODE;
  const uuidMode = args.uuidMode ?? "all";
  const continueOnError = Boolean(args.continue);
  const resume = Boolean(args.resume);

  if (!["all", "text", "none"].includes(uuidMode)) {
    throw new Error(`Invalid --uuid-mode '${uuidMode}'. Use all, text, or none.`);
  }
  if (!args.all && !args.core) {
    throw new Error("Choose either --core or --all.");
  }

  const manifest = await getPf2eManifest();
  const systemPackNames = new Set((manifest.packs ?? []).map((p) => p.name));
  const translated = await discoverTranslatedPacks(mode);
  const missingUpstream = [...translated].filter((p) => !systemPackNames.has(p)).sort();

  let selected = [...translated].filter((p) => systemPackNames.has(p));
  if (args.core) selected = selected.filter((p) => CORE_PACKS.has(p));
  selected.sort();

  if (!selected.length) throw new Error(`No buildable ${mode} packs were found.`);
  const mirroredPacks = new Set(selected);

  await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });

  console.log("PF2e-KR v2 native mirror builder");
  console.log(`PF2e version     : ${manifest.version ?? "unknown"}`);
  console.log(`Translation mode : ${mode}`);
  console.log(`UUID mode        : ${uuidMode}`);
  console.log(`Build set        : ${args.all ? "ALL" : "CORE"} (${selected.length} packs)`);
  console.log(`Resume           : ${resume ? "yes" : "no"}`);
  if (missingUpstream.length) {
    console.log(`Skipped translation files not present in this PF2e version: ${missingUpstream.join(", ")}`);
  }
  console.log("");

  const reports = [];
  const failures = [];
  let aborted = false;

  for (let i = 0; i < selected.length; i++) {
    const pack = selected[i];
    console.log(`[${i + 1}/${selected.length}] ${pack}`);

    if (resume && await hasUsablePack(pack)) {
      const existing = await loadExistingReport(pack);
      if (existing) {
        reports.push(existing);
        console.log(`  SKIP (resume)   ${existing.translated}/${existing.sourceDocuments} translated`);
        continue;
      }
    }

    try {
      const report = await buildPack(pack, {
        mode,
        uuidMode,
        mirroredPacks,
        manifest
      });
      reports.push(report);
      console.log(`  -> ${report.translated}/${report.sourceDocuments} translated, ${report.warnings.length} warnings`);
      if (report.duplicateEmbeddedDocuments?.length) {
        console.log(`     deduped ${report.duplicateEmbeddedDocuments.length} duplicate embedded document(s)`);
      }
    } catch (error) {
      failures.push({ pack, message: error?.stack ?? String(error) });
      console.error(`  FAILED: ${error?.message ?? error}`);
      if (!continueOnError) {
        aborted = true;
        break;
      }
    }
  }

  const successfulPacks = reports.map((r) => r.pack).sort();
  await generateManifest(successfulPacks, mode);

  const summary = {
    generatedAt: new Date().toISOString(),
    upstreamSystemVersion: manifest.version ?? null,
    mode,
    uuidMode,
    requestedPacks: selected.length,
    builtPacks: successfulPacks.length,
    failedPacks: failures.length,
    aborted,
    skippedTranslationFilesNotInUpstream: missingUpstream,
    totals: {
      sourceDocuments: reports.reduce((n, r) => n + r.sourceDocuments, 0),
      translated: reports.reduce((n, r) => n + r.translated, 0),
      missingTranslations: reports.reduce((n, r) => n + r.untranslatedSource.length, 0),
      orphanTranslations: reports.reduce((n, r) => n + r.orphanTranslations.length, 0),
      ambiguousNames: reports.reduce((n, r) => n + r.ambiguousSourceNames.length, 0),
      warnings: reports.reduce((n, r) => n + r.warnings.length, 0),
      duplicateEmbeddedDocuments: reports.reduce((n, r) => n + (r.duplicateEmbeddedDocuments?.length ?? 0), 0),
      remainingOfficialMirrorReferenceDocuments: reports.reduce((n, r) => n + r.remainingOfficialMirrorReferences.length, 0)
    },
    failures
  };

  await writeJSON(path.join(ROOT, "reports", "build-summary.json"), summary);

  console.log("");
  console.log("========== BUILD SUMMARY ==========");
  console.log(`Built packs       : ${summary.builtPacks}/${summary.requestedPacks}`);
  console.log(`Documents         : ${summary.totals.sourceDocuments}`);
  console.log(`Translated        : ${summary.totals.translated}`);
  console.log(`Missing           : ${summary.totals.missingTranslations}`);
  console.log(`Orphans           : ${summary.totals.orphanTranslations}`);
  console.log(`Ambiguous         : ${summary.totals.ambiguousNames}`);
  console.log(`Warnings          : ${summary.totals.warnings}`);
  console.log(`Deduped embedded  : ${summary.totals.duplicateEmbeddedDocuments}`);
  console.log(`Remaining refs    : ${summary.totals.remainingOfficialMirrorReferenceDocuments}`);
  console.log(`Failures          : ${summary.failedPacks}`);
  console.log("module.json has been regenerated for the successfully built packs.");
  if (aborted) console.log("Build stopped at the first failure. Re-run with --resume after fixing it.");

  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("PF2e-KR bulk build failed:");
  console.error(error);
  process.exit(1);
});
