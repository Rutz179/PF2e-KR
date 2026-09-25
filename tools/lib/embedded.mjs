/**
 * Embedded-item localization for actors (bestiaries, iconics …).
 *
 * The bestiary translation files only carry the NPC's own abilities/strikes.
 * Spells and inventory inside an NPC are copies of items from other packs
 * (spells-srd, equipment-srd …). Babele used to translate those at runtime by
 * looking them up in the other pack's dictionary; the native build skipped
 * that, so they stayed English — and because their _stats.compendiumSource
 * still pointed at Compendium.pf2e.*, PF2e's "새로 고침" pulled English back.
 *
 * For each untranslated embedded item whose source is a mirrored PF2e pack:
 *   1. look it up in compendium/<mode>/pf2e.<pack>.json by English name
 *      ("Augury (At Will)" falls back to "Augury" and keeps the suffix);
 *   2. take the Korean name and description;
 *   3. point its compendiumSource at the PF2e-KR mirror (same id), so a
 *      refresh from compendium stays Korean.
 * The actor's own top-level provenance is not touched.
 */
import path from "node:path";
import { ROOT, MODULE_ID, readJSON, fileExists } from "./common.mjs";

const HANGUL = /[\uAC00-\uD7A3]/;
const dictCache = new Map();

const SUFFIX_WORDS = [
  [/\bAt Will\b/gi, "자유 사용"],
  [/\bConstant\b/gi, "상시"],
  [/\bSelf Only\b/gi, "자신에게만"],
  [/\bOnly\b/g, "한정"]
];

function localizeSuffix(suffix) {
  let out = suffix;
  for (const [re, ko] of SUFFIX_WORDS) out = out.replace(re, ko);
  return out;
}

async function dictionaryFor(pack, mode) {
  if (dictCache.has(pack)) return dictCache.get(pack);
  const file = path.join(ROOT, "compendium", mode, `pf2e.${pack}.json`);
  const entries = (await fileExists(file)) ? (await readJSON(file))?.entries ?? null : null;
  dictCache.set(pack, entries);
  return entries;
}

export async function localizeEmbeddedItems(doc, { mode, mirroredPacks, rewriteSource = true } = {}) {
  let count = 0;
  // Crafting tab: known formulas are UUID references resolved at runtime.
  const formulas = doc?.system?.crafting?.formulas;
  if (Array.isArray(formulas)) {
    for (const formula of formulas) {
      const m = /^Compendium\.pf2e\.([^.]+)\.(Item\.[^.]+)$/.exec(formula?.uuid ?? "");
      if (m && mirroredPacks.has(m[1])) {
        formula.uuid = `Compendium.${MODULE_ID}.${m[1]}.${m[2]}`;
        count++;
      }
    }
  }
  if (!Array.isArray(doc?.items)) return count;
  for (const item of doc.items) {
    if (!item || item.flags?.[MODULE_ID]?.translated || HANGUL.test(item.name ?? "")) continue;
    const source = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? "";
    const m = /^Compendium\.pf2e\.([^.]+)\.(?:Item\.)?([^.]+)$/.exec(source);
    if (!m || !mirroredPacks.has(m[1])) continue;

    const entries = await dictionaryFor(m[1], mode);
    if (!entries) continue;
    let base = item.name;
    let entry = entries[base];
    if (!entry) {
      base = item.name.replace(/\s*\([^)]*\)\s*$/, "");
      entry = entries[base];
    }
    if (!entry?.name) continue;

    const originalName = item.name;
    item.name = entry.name + localizeSuffix(item.name.slice(base.length));
    if (entry.description && item.system?.description) item.system.description.value = entry.description;
    item.flags ??= {};
    item.flags[MODULE_ID] = { ...(item.flags[MODULE_ID] ?? {}), translated: true, originalName, embeddedFrom: m[1] };
    if (rewriteSource) {
      item._stats ??= {};
      item._stats.compendiumSource = `Compendium.${MODULE_ID}.${m[1]}.Item.${m[2]}`;
    }
    count++;
  }
  return count;
}
