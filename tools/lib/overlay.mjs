const MODULE_ID = "PF2e-KR";

export function deepClone(value) {
  return structuredClone(value);
}

export function getByPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((cur, key) => cur?.[key], obj);
}

export function setByPath(obj, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts.at(-1)] = value;
}

function overlayRuleText(source, translated) {
  if (!source || !translated || typeof source !== "object" || typeof translated !== "object") return;

  for (const key of ["label", "prompt", "text"]) {
    if (translated[key] !== undefined && source[key] !== undefined) {
      source[key] = deepClone(translated[key]);
    }
  }

  for (const [key, translatedValue] of Object.entries(translated)) {
    const sourceValue = source[key];
    if (Array.isArray(sourceValue) && Array.isArray(translatedValue)) {
      for (let i = 0; i < Math.min(sourceValue.length, translatedValue.length); i++) {
        overlayRuleText(sourceValue[i], translatedValue[i]);
      }
    } else if (
      sourceValue && translatedValue &&
      typeof sourceValue === "object" && typeof translatedValue === "object"
    ) {
      overlayRuleText(sourceValue, translatedValue);
    }
  }
}

function applyRules(targetRules, translatedRules, warnings, doc) {
  if (!Array.isArray(targetRules) || !Array.isArray(translatedRules)) return;
  if (targetRules.length !== translatedRules.length) {
    warnings.push({
      type: "rule-count-mismatch",
      id: doc?._id,
      name: doc?.name,
      sourceRules: targetRules.length,
      translatedRules: translatedRules.length
    });
  }
  for (let i = 0; i < Math.min(targetRules.length, translatedRules.length); i++) {
    overlayRuleText(targetRules[i], translatedRules[i]);
  }
}

function applyItemFields(item, translation, itemMapping, warnings) {
  if (!item || !translation) return;
  if (translation.name !== undefined) item.name = translation.name;

  for (const [key, target] of Object.entries(itemMapping ?? {})) {
    if (translation[key] === undefined) continue;
    if (key === "rules") {
      applyRules(getByPath(item, target), translation[key], warnings, item);
      continue;
    }
    if (key === "traits") continue; // Mechanical slugs: preserve PF2e source.
    setByPath(item, target, deepClone(translation[key]));
  }
}

function translateActorItems(items, translations, config, warnings) {
  if (!Array.isArray(items) || !translations || typeof translations !== "object") return;
  const itemMapping = config?.mappings?.item?.mappingEntries ?? {};
  for (const item of items) {
    const translation = translations[item?._id];
    if (!translation) continue;
    const originalName = item.name;
    applyItemFields(item, translation, itemMapping, warnings);
    item.flags ??= {};
    item.flags[MODULE_ID] = {
      ...(item.flags[MODULE_ID] ?? {}),
      translated: true,
      originalName
    };
  }
}

function translateSkillVariants(target, translations) {
  if (!target || !translations || typeof translations !== "object") return;

  if (Array.isArray(target)) {
    for (const [key, translated] of Object.entries(translations)) {
      const index = Number(key);
      if (!Number.isInteger(index) || !target[index] || !translated) continue;
      if (translated.label !== undefined) target[index].label = translated.label;
    }
    return;
  }

  if (typeof target === "object") {
    for (const [key, translated] of Object.entries(translations)) {
      if (!target[key] || !translated) continue;
      if (translated.label !== undefined) target[key].label = translated.label;
    }
  }
}

function translateHeightening(target, translations) {
  if (!target || !translations || typeof translations !== "object") return;
  for (const [level, translated] of Object.entries(translations)) {
    const source = target[level];
    if (!source || !translated) continue;
    for (const field of ["target", "range"]) {
      if (translated[field] === undefined) continue;
      if (source[field] && typeof source[field] === "object" && "value" in source[field]) {
        source[field].value = deepClone(translated[field]?.value ?? translated[field]);
      } else if (field in source) {
        source[field] = deepClone(translated[field]?.value ?? translated[field]);
      }
    }
  }
}

function translateSpellVariants(target, translations, config, warnings) {
  if (!target || !translations || typeof translations !== "object") return;
  const itemMapping = config?.mappings?.item?.mappingEntries ?? {};
  for (const [id, translated] of Object.entries(translations)) {
    const source = target[id];
    if (!source || !translated) continue;
    applyItemFields(source, translated, itemMapping, warnings);
  }
}

function applyJournalPages(doc, translations, warnings) {
  if (!translations || !Array.isArray(doc?.pages)) return;

  const byName = new Map();
  for (const page of doc.pages) {
    const list = byName.get(page.name) ?? [];
    list.push(page);
    byName.set(page.name, list);
  }

  for (const [key, translated] of Object.entries(translations)) {
    const directById = doc.pages.find((p) => p._id === key);
    const byNameMatches = byName.get(key) ?? [];
    const page = directById ?? (byNameMatches.length === 1 ? byNameMatches[0] : null);
    if (!page) {
      warnings.push({ type: "journal-page-unmatched", document: doc.name, page: key });
      continue;
    }
    if (translated.name !== undefined) page.name = translated.name;
    if (translated.text !== undefined) {
      page.text ??= {};
      if ("content" in page.text || !("markdown" in page.text)) page.text.content = translated.text;
      else page.text.markdown = translated.text;
    }
  }
}

function dispatchConverter({ converter, target, translated, config, warnings, doc }) {
  switch (converter) {
    case "translateActorItems":
      return translateActorItems(target, translated, config, warnings);
    case "translateSkillVariants":
      return translateSkillVariants(target, translated);
    case "translateHeightening":
      return translateHeightening(target, translated);
    case "translateSpellVariants":
    case "translateSpellVariant":
      return translateSpellVariants(target, translated, config, warnings);
    case "translateRules":
      return applyRules(target, translated, warnings, doc);
    default:
      warnings.push({ type: "unknown-converter", converter, id: doc?._id, name: doc?.name });
  }
}

export function applyTranslation(doc, translation, fileMapping, config, context = {}) {
  const out = deepClone(doc);
  const warnings = context.warnings ?? [];
  const originalName = doc.name;

  if (translation?.name !== undefined) out.name = translation.name;

  for (const [translationKey, mappingSpec] of Object.entries(fileMapping ?? {})) {
    if (translation?.[translationKey] === undefined) continue;

    if (typeof mappingSpec === "string") {
      if (translationKey === "rules") {
        applyRules(getByPath(out, mappingSpec), translation[translationKey], warnings, out);
      } else if (translationKey === "traits") {
        // Preserve mechanical trait slugs. Korean trait labels come from lang files.
      } else {
        setByPath(out, mappingSpec, deepClone(translation[translationKey]));
      }
      continue;
    }

    if (mappingSpec && typeof mappingSpec === "object") {
      const target = getByPath(out, mappingSpec.path);
      dispatchConverter({
        converter: mappingSpec.converter,
        target,
        translated: translation[translationKey],
        config,
        warnings,
        doc: out
      });
    }
  }

  // Structures that Babele handled outside the ordinary field mapping.
  if (translation?.pages) applyJournalPages(out, translation.pages, warnings);
  if (translation?.command !== undefined && "command" in out) out.command = translation.command;

  out.flags ??= {};
  out.flags[MODULE_ID] = {
    ...(out.flags[MODULE_ID] ?? {}),
    translated: true,
    originalName,
    sourcePack: `pf2e.${context.pack}`,
    sourceId: doc._id,
    buildMode: context.mode
  };

  return out;
}

/**
 * Packs whose UUIDs must stay official inside rule elements. PF2e validates an
 * in-memory GrantItem by the literal prefix "Compendium.pf2e.conditionitems."
 * ("an in-memory-only grant must be a condition"); rewriting it to the mirror
 * silently broke e.g. Haste → Quickened. Display links may still be rewritten.
 */
const KEEP_OFFICIAL_IN_RULES = new Set(["conditionitems"]);

function isRulePath(path) {
  return path.includes("rules");
}

function rewriteString(value, mirroredPacks, path = []) {
  const inRules = isRulePath(path);
  return value.replace(/Compendium\.pf2e\.([A-Za-z0-9_-]+)\./g, (match, pack) => {
    if (inRules && KEEP_OFFICIAL_IN_RULES.has(pack)) return match;
    return mirroredPacks.has(pack) ? `Compendium.${MODULE_ID}.${pack}.` : match;
  });
}

function isCanonicalProvenancePath(path) {
  const joined = path.join(".");
  return joined.endsWith("_stats.compendiumSource") || joined.includes("flags.core.sourceId");
}

function isDisplayTextPath(path) {
  const joined = path.join(".").toLowerCase();
  return [
    "description", "publicnotes", "privatenotes", "blurb", "text.content",
    "text.markdown", "journal", "pages", "label", "prompt"
  ].some((needle) => joined.includes(needle));
}

/**
 * Rewrite upstream PF2e UUIDs to the PF2e-KR mirror namespace.
 *
 * mode = "all"  : rewrite display links AND mechanical GrantItem/ChoiceSet UUIDs.
 *                  This is the mode required for translated grant chains.
 * mode = "text" : rewrite only user-facing text links.
 * mode = "none" : preserve every upstream UUID.
 *
 * Canonical provenance (_stats.compendiumSource) is always preserved.
 */
export function rewriteMirroredUuids(value, mirroredPacks, mode = "all", path = []) {
  if (mode === "none") return value;

  if (typeof value === "string") {
    if (isCanonicalProvenancePath(path)) return value;
    if (mode === "text" && !isDisplayTextPath(path)) return value;
    return rewriteString(value, mirroredPacks, path);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = rewriteMirroredUuids(value[i], mirroredPacks, mode, [...path, String(i)]);
    }
    return value;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      value[key] = rewriteMirroredUuids(entry, mirroredPacks, mode, [...path, key]);
    }
  }
  return value;
}

export function countOfficialMirrorReferences(value, mirroredPacks, mode = "all", path = [], result = []) {
  if (typeof value === "string") {
    if (isCanonicalProvenancePath(path)) return result;
    if (mode === "text" && !isDisplayTextPath(path)) return result;
    for (const match of value.matchAll(/Compendium\.pf2e\.([A-Za-z0-9_-]+)\./g)) {
      if (isRulePath(path) && KEEP_OFFICIAL_IN_RULES.has(match[1])) continue; // intentional, see above
      if (mirroredPacks.has(match[1])) result.push({ path: path.join("."), pack: match[1] });
    }
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => countOfficialMirrorReferences(entry, mirroredPacks, mode, [...path, String(i)], result));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => countOfficialMirrorReferences(entry, mirroredPacks, mode, [...path, key], result));
  }
  return result;
}
