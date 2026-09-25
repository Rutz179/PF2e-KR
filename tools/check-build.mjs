import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ROOT, readJSON, fileExists } from "./lib/common.mjs";
import { discoverBuiltPacks } from "./lib/manifest.mjs";

async function main() {
  const manifestPath = path.join(ROOT, "module.json");
  const manifest = await readJSON(manifestPath);
  const built = await discoverBuiltPacks();
  const declared = new Set((manifest.packs ?? []).map((p) => p.name));

  const problems = [];
  const stats = {
    builtPacks: built.length,
    declaredPacks: declared.size,
    reports: 0,
    sourceDocuments: 0,
    translated: 0,
    missing: 0,
    orphan: 0,
    ambiguous: 0,
    warnings: 0,
    remainingRefs: 0
  };

  for (const pack of built) {
    if (!declared.has(pack)) problems.push(`Built pack not declared in module.json: ${pack}`);
    const dir = path.join(ROOT, "packs", pack);
    const entries = await fs.readdir(dir);
    if (!entries.length) problems.push(`Empty native pack directory: ${pack}`);

    const reportPath = path.join(ROOT, "reports", `${pack}.json`);
    if (!await fileExists(reportPath)) {
      problems.push(`Missing report: ${pack}`);
      continue;
    }
    const report = await readJSON(reportPath);
    stats.reports += 1;
    stats.sourceDocuments += report.sourceDocuments ?? 0;
    stats.translated += report.translated ?? 0;
    stats.missing += report.untranslatedSource?.length ?? 0;
    stats.orphan += report.orphanTranslations?.length ?? 0;
    stats.ambiguous += report.ambiguousSourceNames?.length ?? 0;
    stats.warnings += report.warnings?.length ?? 0;
    stats.remainingRefs += report.remainingOfficialMirrorReferences?.length ?? 0;
  }

  for (const pack of declared) {
    if (!built.includes(pack)) problems.push(`Declared pack has no native pack directory: ${pack}`);
  }

  console.log("PF2e-KR build check");
  console.table(stats);
  if (problems.length) {
    console.log("\nProblems:");
    for (const problem of problems) console.log(` - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("\nStructural check passed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
