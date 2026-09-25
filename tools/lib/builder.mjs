import fs from "node:fs/promises";
import path from "node:path";
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import {
  ROOT,
  PF2E_ROOT,
  readJSON,
  writeJSON,
  emptyDir,
  fileExists,
  getPf2eManifest
} from "./common.mjs";
import {
  applyTranslation,
  rewriteMirroredUuids,
  countOfficialMirrorReferences
} from "./overlay.mjs";
import { localizeEmbeddedItems } from "./embedded.mjs";
import { normalizeNames } from "./names.mjs";

async function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(full, base));
    else out.push({ full, relative: path.relative(base, full) });
  }
  return out;
}

async function copyNonJsonFiles(sourceDir, outputDir) {
  for (const { full, relative } of await walkFiles(sourceDir)) {
    if (relative.toLowerCase().endsWith(".json")) continue;
    const dest = path.join(outputDir, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(full, dest);
  }
}

function isDocumentLike(data) {
  return !!data && typeof data === "object" && typeof data._id === "string" && typeof data.name === "string";
}

function deepJsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Foundry LevelDB requires every embedded Document _id to be unique within
 * its parent collection. A handful of upstream PF2e packs can unpack with
 * duplicate embedded entries, which the CLI refuses to repack because both
 * entries would map to the same LevelDB key.
 *
 * Keep the first occurrence, drop later duplicates, and record exactly what
 * was removed in the build report. Mechanical data is otherwise untouched.
 */
function dedupeEmbeddedDocumentArrays(value, report, owner, trail = []) {
  if (Array.isArray(value)) {
    const seen = new Map();
    const next = [];

    for (const entry of value) {
      if (entry && typeof entry === "object" && typeof entry._id === "string") {
        const previous = seen.get(entry._id);
        if (previous) {
          const detail = {
            parentId: owner?._id ?? null,
            parentName: owner?.name ?? null,
            path: trail.join("."),
            embeddedId: entry._id,
            embeddedName: entry.name ?? null,
            identical: deepJsonEqual(previous, entry)
          };
          report.duplicateEmbeddedDocuments.push(detail);
          report.warnings.push({ type: "duplicate-embedded-document-id", ...detail });
          continue;
        }
        seen.set(entry._id, entry);
      }
      next.push(entry);
    }

    if (next.length !== value.length) {
      value.splice(0, value.length, ...next);
    }

    for (let i = 0; i < value.length; i++) {
      dedupeEmbeddedDocumentArrays(value[i], report, owner, [...trail, String(i)]);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      dedupeEmbeddedDocumentArrays(entry, report, owner, [...trail, key]);
    }
  }
}

export async function getPackMeta(pack, manifest = null) {
  const systemManifest = manifest ?? await getPf2eManifest();
  const meta = (systemManifest.packs ?? []).find((p) => p.name === pack);
  if (!meta) throw new Error(`Pack '${pack}' not found in ${path.join(PF2E_ROOT, "system.json")}`);
  return meta;
}

export async function buildPack(pack, options = {}) {
  const mode = options.mode ?? "ko-en";
  const mirroredPacks = options.mirroredPacks ?? new Set([pack]);
  const uuidMode = options.uuidMode ?? "all";
  const manifest = options.manifest ?? await getPf2eManifest();
  const config = options.config ?? await readJSON(path.join(ROOT, "compendium", "config.json"));
  const meta = await getPackMeta(pack, manifest);
  const translationPath = path.join(ROOT, "compendium", mode, `pf2e.${pack}.json`);

  if (!await fileExists(translationPath)) {
    throw new Error(`Translation file not found: ${translationPath}`);
  }

  const translationFile = await readJSON(translationPath);
  const translations = translationFile.entries ?? {};
  const fileMapping = translationFile.mapping ?? {};

  const sourceDir = path.join(ROOT, ".build", "source", pack);
  const outputSourceDir = path.join(ROOT, ".build", "translated", pack);
  const outputPackDir = path.join(ROOT, "packs", pack);
  const reportPath = path.join(ROOT, "reports", `${pack}.json`);
  const sourcePackPath = path.resolve(PF2E_ROOT, meta.path ?? path.join("packs", pack));

  await emptyDir(sourceDir);
  await emptyDir(outputSourceDir);
  await fs.rm(outputPackDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(outputPackDir), { recursive: true });

  console.log(`  Extracting        ${pack}`);
  await extractPack(sourcePackPath, sourceDir, { log: false });
  await copyNonJsonFiles(sourceDir, outputSourceDir);

  const jsonFiles = (await walkFiles(sourceDir)).filter((f) => f.relative.toLowerCase().endsWith(".json"));
  const documents = [];
  const passthrough = [];
  const byName = new Map();

  for (const file of jsonFiles) {
    const data = await readJSON(file.full);
    if (!isDocumentLike(data)) {
      passthrough.push({ ...file, data });
      continue;
    }
    const entry = { ...file, doc: data };
    documents.push(entry);
    const sameName = byName.get(data.name) ?? [];
    sameName.push(entry);
    byName.set(data.name, sameName);
  }

  const report = {
    pack,
    label: translationFile.label ?? meta.label ?? pack,
    mode,
    type: meta.type,
    sourcePackPath,
    translationPath,
    sourceDocuments: documents.length,
    translationEntries: Object.keys(translations).length,
    translated: 0,
    untranslatedSource: [],
    orphanTranslations: [],
    ambiguousSourceNames: [],
    warnings: [],
    uuidMode,
    remainingOfficialMirrorReferences: [],
    duplicateEmbeddedDocuments: []
  };

  const usedTranslationKeys = new Set();

  for (const { relative, doc } of documents) {
    const translation = translations[doc.name];
    const duplicates = byName.get(doc.name) ?? [];
    let out = structuredClone(doc);

    if (translation && duplicates.length > 1) {
      report.ambiguousSourceNames.push({ name: doc.name, ids: duplicates.map((d) => d.doc._id) });
      report.untranslatedSource.push({ id: doc._id, name: doc.name, reason: "ambiguous-name" });
    } else if (translation) {
      out = applyTranslation(doc, translation, fileMapping, config, {
        pack,
        mode,
        warnings: report.warnings
      });
      usedTranslationKeys.add(doc.name);
      report.translated += 1;
    } else {
      report.untranslatedSource.push({ id: doc._id, name: doc.name, reason: "missing-translation" });
    }

    // Spells/inventory inside actors come from other packs: translate them from
    // those packs' dictionaries (must run before the UUID rewrite below).
    report.embeddedLocalized = (report.embeddedLocalized ?? 0)
      + await localizeEmbeddedItems(out, { mode, mirroredPacks });

    // 영문 병기: every translated name ends up "한글(English)" (or plain Korean when off).
    if (mode === "ko-en") normalizeNames(out, doc);

    rewriteMirroredUuids(out, mirroredPacks, uuidMode);
    dedupeEmbeddedDocumentArrays(out, report, out);
    const remaining = countOfficialMirrorReferences(out, mirroredPacks, uuidMode);
    if (remaining.length) {
      report.remainingOfficialMirrorReferences.push({
        id: out._id,
        name: out.name,
        references: remaining.slice(0, 50)
      });
    }

    const dest = path.join(outputSourceDir, relative);
    await writeJSON(dest, out);
  }

  for (const { relative, data } of passthrough) {
    await writeJSON(path.join(outputSourceDir, relative), data);
  }

  for (const key of Object.keys(translations)) {
    if (!usedTranslationKeys.has(key)) report.orphanTranslations.push({ name: key });
  }

  await writeJSON(reportPath, report);

  console.log(`  Compiling         ${pack}`);
  try {
    await compilePack(outputSourceDir, outputPackDir, { log: false });
  } catch (error) {
    // Do not leave an empty/partial pack behind. This also makes --resume safe.
    await fs.rm(outputPackDir, { recursive: true, force: true });
    throw error;
  }

  return report;
}
