/**
 * PF2e-KR | Late localization for items PF2e creates from its own packs.
 *
 * Without Babele, anything the *system* pulls straight from an English pack
 * stays English: conditions applied by PF2e (Dying → Unconscious → Blinded,
 * Off-Guard, Prone …), effects dropped from English chat links, and so on.
 *
 * At creation time (preCreateItem, on the creating client) we look the item
 * up in the matching PF2e-KR mirror pack — by compendium source id, or by
 * slug for conditions — and swap in the Korean name and description.
 *
 * Safety:
 *  - The slug is pinned first, so renaming never changes rules behaviour
 *    (PF2e falls back to sluggify(name) when system.slug is empty).
 *  - A name that already contains Hangul is left alone (user edits win).
 *  - Only name and description change; rules, traits, flags are untouched.
 */

const MIRRORED_PACKS = [
  "conditionitems", "bestiary-effects", "campaign-effects",
  "feat-effects", "other-effects", "spell-effects"
];

const HANGUL = /[\u3130-\u318F\uAC00-\uD7A3]/;
const bySource = new Map();   // "pf2e.<pack>.<id>" -> { name, description }
const conditionBySlug = new Map();
let ready = false;

function sourceKey(source) {
  const uuid = source?._stats?.compendiumSource ?? source?.flags?.core?.sourceId ?? "";
  const m = /^Compendium\.pf2e\.([^.]+)\.(?:Item\.)?([^.]+)$/.exec(uuid);
  return m ? `pf2e.${m[1]}.${m[2]}` : null;
}

export async function buildLateLocalizationCache(moduleId = "PF2e-KR") {
  for (const pack of MIRRORED_PACKS) {
    const mirror = game.packs.get(`${moduleId}.${pack}`);
    if (!mirror) continue;
    try {
      const index = await mirror.getIndex({ fields: ["system.description.value", "system.slug"] });
      for (const entry of index) {
        const record = {
          name: entry.name,
          description: foundry.utils.getProperty(entry, "system.description.value") ?? null
        };
        bySource.set(`pf2e.${pack}.${entry._id}`, record);
        const slug = foundry.utils.getProperty(entry, "system.slug");
        if (pack === "conditionitems" && slug) conditionBySlug.set(slug, record);
      }
    } catch (err) {
      console.warn(`${moduleId} | late localization: could not index ${pack}`, err);
    }
  }
  ready = true;
  return { entries: bySource.size, conditions: conditionBySlug.size };
}

function recordFor(item) {
  const key = sourceKey(item._source);
  const hit = key ? bySource.get(key) : null;
  if (hit) return hit;
  if (item.type === "condition") return conditionBySlug.get(item._source?.system?.slug ?? item.slug) ?? null;
  return null;
}

function localizedChanges(item) {
  const record = recordFor(item);
  if (!record) return null;
  const changes = {};
  if (record.name && !HANGUL.test(item.name ?? "")) {
    // Pin the slug before renaming, so rules keep matching the English slug.
    if (!item._source?.system?.slug && item.slug) changes["system.slug"] = item.slug;
    changes.name = record.name;
  }
  const desc = item._source?.system?.description?.value ?? "";
  if (record.description && !HANGUL.test(desc)) changes["system.description.value"] = record.description;
  return Object.keys(changes).length ? changes : null;
}

/**
 * PF2e only accepts an in-memory GrantItem whose UUID starts with
 * "Compendium.pf2e.conditionitems." — older PF2e-KR builds pointed those at
 * the mirror, which silently broke Haste → Quickened and similar effects.
 * Returns the fixed rules array, or null if nothing needed fixing.
 */
function fixedConditionRules(rules, moduleId = "PF2e-KR") {
  if (!Array.isArray(rules)) return null;
  const from = `Compendium.${moduleId}.conditionitems.`;
  let changed = false;
  const out = rules.map(rule => {
    if (typeof rule?.uuid !== "string" || !rule.uuid.startsWith(from)) return rule;
    changed = true;
    return { ...rule, uuid: rule.uuid.replace(from, "Compendium.pf2e.conditionitems.") };
  });
  return changed ? out : null;
}

export function installLateLocalization() {
  Hooks.on("preCreateItem", item => {
    const rules = fixedConditionRules(item._source?.system?.rules);
    if (rules) item.updateSource({ "system.rules": rules });
    if (!ready) return;
    const changes = localizedChanges(item);
    if (changes) item.updateSource(changes);
  });
}

/** GM: repair condition grants on items already in the world (effects on actors, world items). */
export async function fixConditionGrants(moduleId = "PF2e-KR") {
  if (!game.user.isGM) return 0;
  let count = 0;
  const worldUpdates = game.items.contents
    .map(i => ({ i, rules: fixedConditionRules(i._source.system?.rules, moduleId) }))
    .filter(x => x.rules).map(x => ({ _id: x.i.id, "system.rules": x.rules }));
  if (worldUpdates.length) {
    await Item.updateDocuments(worldUpdates);
    count += worldUpdates.length;
  }
  const actors = [...game.actors, ...game.scenes.contents.flatMap(s => s.tokens.contents.filter(t => !t.actorLink).map(t => t.actor))].filter(Boolean);
  for (const actor of actors) {
    const updates = actor.items.contents
      .map(i => ({ i, rules: fixedConditionRules(i._source.system?.rules, moduleId) }))
      .filter(x => x.rules).map(x => ({ _id: x.i.id, "system.rules": x.rules }));
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
      count += updates.length;
    }
  }
  ui.notifications.info(`PF2e-KR | 상태 부여 규칙 ${count}개를 고쳤습니다 (신속 등).`);
  return count;
}

/** GM console helper: translate condition/effect items that already exist on world actors. */
export async function localizeExistingItems() {
  if (!game.user.isGM) return 0;
  let count = 0;
  const actors = [...game.actors, ...game.scenes.contents.flatMap(s => s.tokens.contents.filter(t => !t.actorLink).map(t => t.actor))].filter(Boolean);
  for (const actor of actors) {
    const updates = [];
    for (const item of actor.items) {
      if (!["condition", "effect"].includes(item.type)) continue;
      const changes = localizedChanges(item);
      if (changes) updates.push({ _id: item.id, ...changes });
    }
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
      count += updates.length;
    }
  }
  ui.notifications.info(`PF2e-KR | 기존 상태/효과 ${count}개를 한글로 바꿨습니다.`);
  return count;
}

/* ------------------------------------------------------------------------ *
 * Actors already in a world (imported before the embedded-item build fix):
 * translate their spells/inventory from the PF2e-KR mirror packs, keeping
 * suffixes like "(At Will)", and point the item's source at the mirror so
 * PF2e's "새로 고침" stays Korean.
 *
 *   game.PF2eKR.localizeActorItems()          → selected tokens' actors
 *   game.PF2eKR.localizeActorItems("world")   → every world actor
 * ------------------------------------------------------------------------ */

const SUFFIX_WORDS = [[/\bAt Will\b/gi, "자유 사용"], [/\bConstant\b/gi, "상시"], [/\bSelf Only\b/gi, "자신에게만"], [/\bOnly\b/g, "한정"]];

function allWorldActors() {
  const unlinked = game.scenes.contents.flatMap(scene => scene.tokens.contents.filter(t => !t.actorLink).map(t => t.actor));
  return [...game.actors, ...unlinked].filter(Boolean);
}

const HANGUL_RE = /[\uAC00-\uD7A3]/;

/**
 * What an existing world still has in English / broken — counted without
 * loading anything, so it is cheap enough to run on every GM login.
 */
export function scanWorld(moduleId = "PF2e-KR") {
  const result = { actors: 0, items: 0, formulas: 0, effects: 0, grants: 0 };
  for (const actor of allWorldActors()) {
    let touched = false;
    for (const item of actor.items) {
      const src = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? "";
      const m = /^Compendium\.pf2e\.([^.]+)\./.exec(src);
      if (m && game.packs.get(`${moduleId}.${m[1]}`) && !HANGUL_RE.test(item.name ?? "")) {
        if (["condition", "effect"].includes(item.type)) result.effects++;
        else result.items++;
        touched = true;
      }
      if (fixedConditionRules(item._source?.system?.rules, moduleId)) { result.grants++; touched = true; }
    }
    for (const f of actor.system?.crafting?.formulas ?? []) {
      const m = /^Compendium\.pf2e\.([^.]+)\./.exec(f?.uuid ?? "");
      if (m && game.packs.get(`${moduleId}.${m[1]}`)) { result.formulas++; touched = true; }
    }
    if (touched) result.actors++;
  }
  for (const item of game.items) if (fixedConditionRules(item._source?.system?.rules, moduleId)) result.grants++;
  result.total = result.items + result.formulas + result.effects + result.grants;
  return result;
}

function mirrorFormulaUuid(uuid, moduleId) {
  const m = /^Compendium\.pf2e\.([^.]+)\.(Item\.[^.]+)$/.exec(uuid ?? "");
  return m && game.packs.get(`${moduleId}.${m[1]}`) ? `Compendium.${moduleId}.${m[1]}.${m[2]}` : uuid;
}

export async function localizeActorItems(target, moduleId = "PF2e-KR") {
  if (!game.user.isGM) return 0;
  const actors = target === "world"
    ? allWorldActors()
    : (canvas?.tokens?.controlled ?? []).map(t => t.actor).filter(Boolean);
  if (!actors.length) {
    ui.notifications.warn("PF2e-KR | 토큰을 선택하거나 localizeActorItems(\"world\")로 실행하세요.");
    return 0;
  }
  let total = 0;
  for (const actor of actors) {
    const updates = [];
    for (const item of actor.items) {
      if (HANGUL.test(item.name ?? "")) continue;
      const uuid = item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? "";
      const m = /^Compendium\.pf2e\.([^.]+)\.(?:Item\.)?([^.]+)$/.exec(uuid);
      if (!m || !game.packs.get(`${moduleId}.${m[1]}`)) continue;
      const mirrorUuid = `Compendium.${moduleId}.${m[1]}.Item.${m[2]}`;
      const mirror = await fromUuid(mirrorUuid).catch(() => null);
      if (!mirror) continue;
      const english = mirror.getFlag?.(moduleId, "originalName") ?? "";
      let suffix = english && item.name.startsWith(english) ? item.name.slice(english.length) : "";
      for (const [re, ko] of SUFFIX_WORDS) suffix = suffix.replace(re, ko);
      const update = {
        _id: item.id,
        name: mirror.name + suffix,
        "_stats.compendiumSource": mirrorUuid,
        [`flags.${moduleId}.originalName`]: item.name
      };
      const desc = mirror.system?.description?.value;
      if (desc) update["system.description.value"] = desc;
      updates.push(update);
    }
    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
      total += updates.length;
    }
    // Known formulas (crafting tab) are UUID references, resolved on the fly.
    const formulas = actor.system?.crafting?.formulas;
    if (Array.isArray(formulas) && formulas.some(f => mirrorFormulaUuid(f?.uuid, moduleId) !== f?.uuid)) {
      const next = formulas.map(f => ({ ...f, uuid: mirrorFormulaUuid(f?.uuid, moduleId) }));
      await actor.update({ "system.crafting.formulas": next });
      total += next.length;
    }
  }
  ui.notifications.info(`PF2e-KR | 액터 ${actors.length}명의 주문·아이템·제작 공식 ${total}개를 한글로 바꿨습니다.`);
  return total;
}
