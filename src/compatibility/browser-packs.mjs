/**
 * Helpers for PF2e's native Compendium Browser pack configuration.
 *
 * Intentionally does not patch PF2e's private Compendium Browser internals.
 * The user remains free to enable/disable individual upstream packs from the
 * normal PF2e Browser settings. These helpers only describe mirror pairs.
 */

export function getMirrorPackPairs(moduleId = "PF2e-KR") {
  return [...(game?.packs?.values?.() ?? [])]
    .filter((pack) => pack.collection?.startsWith(`${moduleId}.`))
    .map((mirror) => {
      const name = mirror.collection.slice(moduleId.length + 1);
      const upstreamId = `pf2e.${name}`;
      const upstream = game.packs.get(upstreamId) ?? null;

      return {
        name,
        type: mirror.documentName,
        mirror: mirror.collection,
        upstream: upstreamId,
        hasUpstream: Boolean(upstream),
        label: mirror.metadata?.label ?? mirror.title ?? name
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getBrowserPackPlan(moduleId = "PF2e-KR") {
  const pairs = getMirrorPackPairs(moduleId).filter((pair) => pair.hasUpstream);
  return {
    enable: pairs.map((pair) => pair.mirror),
    disable: pairs.map((pair) => pair.upstream),
    pairs
  };
}

export function showBrowserPackPlan(moduleId = "PF2e-KR") {
  const plan = getBrowserPackPlan(moduleId);
  console.group(`${moduleId} | Recommended PF2e Compendium Browser pack plan`);
  console.log("Use PF2e's normal Compendium Browser > Settings > Packs UI.");
  console.log("Enable the PF2e-KR mirror pack and disable its matching pf2e pack by default.");
  console.log("Nothing is deleted: any English pack can be re-enabled later.");
  console.table(plan.pairs);
  console.groupEnd();
  return plan;
}

const PF2E_NAMESPACE = "pf2e";

// The PF2e system stores which packs each Compendium Browser tab searches in
// a normal *world* setting under the "pf2e" namespace. As of recent system
// versions the key is "compendiumBrowserPacks", shaped roughly as:
//   { [tabName]: { "pf2e.some-pack": true, "PF2e-KR.some-pack": false, ... } }
// This key is not part of any documented/stable public API and can change
// between system versions, so instead of hard-coding it we (1) try the known
// key first, then (2) fall back to scanning every world-scoped "pf2e.*"
// setting for one whose stored value has the same shape. This keeps the
// feature working across most future PF2e updates without needing a patch
// release of PF2e-KR every time, and it never touches anything not exposed
// through the normal settings API (no monkey-patching of PF2e internals).
const KNOWN_SETTING_KEY = "compendiumBrowserPacks";

function looksLikeBrowserPackMap(value) {
  if (!value || typeof value !== "object") return false;
  for (const tabValue of Object.values(value)) {
    if (!tabValue || typeof tabValue !== "object") continue;
    if (Object.keys(tabValue).some((packId) => packId.startsWith(`${PF2E_NAMESPACE}.`))) {
      return true;
    }
  }
  return false;
}

/**
 * Locate the world setting the PF2e Compendium Browser uses to remember
 * which packs each of its tabs should search. Returns the setting's key
 * (without the "pf2e." namespace prefix), or null if none could be found.
 */
export function findCompendiumBrowserPackSetting() {
  const settings = game?.settings?.settings;
  if (!settings) return null;

  const candidates = [];
  if (settings.has(`${PF2E_NAMESPACE}.${KNOWN_SETTING_KEY}`)) {
    candidates.push(KNOWN_SETTING_KEY);
  }
  for (const [fullKey, setting] of settings.entries()) {
    if (!fullKey.startsWith(`${PF2E_NAMESPACE}.`)) continue;
    if (setting.scope !== "world") continue;
    const settingKey = fullKey.slice(PF2E_NAMESPACE.length + 1);
    if (!candidates.includes(settingKey)) candidates.push(settingKey);
  }

  for (const settingKey of candidates) {
    let value;
    try {
      value = game.settings.get(PF2E_NAMESPACE, settingKey);
    } catch {
      continue;
    }
    if (looksLikeBrowserPackMap(value)) return settingKey;
  }
  return null;
}

/**
 * Overwrite the Compendium Browser's per-tab pack selection so that, for
 * every mirror pair PF2e-KR has, the upstream "pf2e.*" pack is turned OFF
 * and the "PF2e-KR.*" mirror is turned ON. This is a normal write to a
 * world setting (game.settings.set) - nothing is patched or hidden, and the
 * GM can still freely re-toggle individual packs afterwards from the
 * Compendium Browser's own Settings tab.
 *
 * Returns { settingKey, tabsChanged, packsChanged } on success, or null if
 * the setting could not be located (e.g. an incompatible PF2e version).
 */
/**
 * Restore the Compendium Browser pack-filter setting to whatever default
 * PF2e registered it with. Use this to undo any bad write (including one
 * PF2e-KR itself made) before re-applying a clean set of defaults - each
 * tab bucket only ever contains the packs actually relevant to that tab,
 * exactly as PF2e itself populates it.
 */
export function resetBrowserPackSetting() {
  const settingKey = findCompendiumBrowserPackSetting();
  if (!settingKey) return null;

  const config = game.settings.settings.get(`${PF2E_NAMESPACE}.${settingKey}`);
  const defaultValue = typeof config?.default === "function" ? config.default() : config?.default;
  if (defaultValue === undefined) return null;

  game.settings.set(PF2E_NAMESPACE, settingKey, foundry.utils.deepClone(defaultValue));
  return { settingKey };
}

// A tab's per-pack entries can be a plain boolean (older PF2e versions) or
// an object shaped like {load: boolean, name, package} (current versions,
// confirmed via console: `{PF2e-KR.spells-srd: {load: true, name: ..., package: ...}}`).
// Overwriting the whole entry with a bare boolean - what an earlier version
// of this function did - corrupts that shape, and PF2e silently falls back
// to treating the corrupted entry as "load" regardless of the value. This
// only ever flips the `.load` flag in place, preserving name/package.
function setPackLoadFlag(tabValue, key, shouldLoad) {
  const entry = tabValue[key];
  if (entry === undefined) return false;
  if (typeof entry === "boolean") {
    if (entry === shouldLoad) return false;
    tabValue[key] = shouldLoad;
    return true;
  }
  if (entry && typeof entry === "object") {
    if (entry.load === shouldLoad) return false;
    entry.load = shouldLoad;
    return true;
  }
  return false;
}

export function applyRecommendedBrowserDefaults(moduleId = "PF2e-KR") {
  const settingKey = findCompendiumBrowserPackSetting();
  if (!settingKey) return null;

  const current = foundry.utils.deepClone(game.settings.get(PF2E_NAMESPACE, settingKey));
  if (!current || Object.keys(current).length === 0) {
    // PF2e only populates this setting once the GM has opened the
    // Compendium Browser's own Settings dialog and clicked Save Changes at
    // least once (confirmed: it starts out as `{}`). Nothing to edit yet.
    return { settingKey, tabsChanged: 0, packsChanged: 0, empty: true };
  }

  const pairs = getMirrorPackPairs(moduleId).filter((pair) => pair.hasUpstream);

  let tabsChanged = 0;
  let packsChanged = 0;
  for (const tabValue of Object.values(current)) {
    if (!tabValue || typeof tabValue !== "object") continue;
    let touchedThisTab = false;
    for (const pair of pairs) {
      // Only touch a key that is already present in this specific tab
      // bucket - each tab only lists the packs relevant to it, and adding
      // keys for unrelated packs pollutes/breaks other tabs (learned the
      // hard way - see git history / prior conversation).
      if (setPackLoadFlag(tabValue, pair.upstream, false)) {
        packsChanged++;
        touchedThisTab = true;
      }
      if (setPackLoadFlag(tabValue, pair.mirror, true)) {
        packsChanged++;
        touchedThisTab = true;
      }
    }
    if (touchedThisTab) tabsChanged++;
  }

  game.settings.set(PF2E_NAMESPACE, settingKey, current);
  return { settingKey, tabsChanged, packsChanged };
}
