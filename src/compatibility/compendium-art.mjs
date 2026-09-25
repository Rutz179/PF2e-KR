/**
 * PF2e-KR Compendium Art bridge for Foundry V14.
 *
 * PF2e-KR mirrors the upstream PF2e packs while preserving document IDs.
 * Core CompendiumArt providers (including premium token modules) normally
 * register art against `pf2e.<pack>`.  When a PF2e-KR document is initialized,
 * this bridge asks the core CompendiumArt manager to resolve the same document
 * as though it came from the matching upstream PF2e pack.
 *
 * No token/portrait paths are copied, no provider module is modified, and no
 * actor data is persisted.  Art remains owned and selected by Foundry's normal
 * CompendiumArt configuration.
 *
 * There are actually two separate code paths inside Foundry that resolve
 * compendium art, and they behave differently for mirror packs:
 *
 *   1. `CompendiumArt#applyArt(documentClass, source, packId)` runs whenever a
 *      full Document is initialized from a compendium (drag & drop, opening
 *      an Actor sheet from the sidebar, importing, etc). We patch this method
 *      below so it looks up art under the matching `pf2e.<pack>` id instead.
 *
 *   2. `CompendiumArt` itself *is* a `Map` (keyed by Document UUID, e.g.
 *      "Compendium.pf2e.pathfinder-bestiary.Actor.<id>"). Lightweight index
 *      thumbnails - which is what the PF2e Compendium Browser's preview list
 *      renders, since it can't afford to instantiate a full Document for
 *      every entry - read straight from this Map with `.get(uuid)`, bypassing
 *      `applyArt` entirely. Patching `applyArt` alone therefore fixes drag
 *      & drop and the Actors sidebar, but *not* the Compendium Browser
 *      preview thumbnails, which is exactly the symptom reported for the
 *      Korean-named mirror entries. To fix that too, we also duplicate every
 *      existing "Compendium.pf2e.<pack>...." entry in the Map onto the
 *      matching "Compendium.PF2e-KR.<pack>...." key, so any code (core index
 *      building, or a third-party art module reading the Map directly) that
 *      does a raw lookup resolves for mirror packs as well.
 */

const PATCH_MARKER = Symbol.for("PF2e-KR.compendiumArtBridge");

export function installCompendiumArtBridge({ moduleId = "PF2e-KR", log = true } = {}) {
  const manager = game?.compendiumArt;
  if (!manager || typeof manager.applyArt !== "function") {
    if (log) console.warn(`${moduleId} | Foundry CompendiumArt manager is not available yet.`);
    return false;
  }

  if (manager[PATCH_MARKER]) {
    // Already installed once (e.g. re-run from "ready" after "setup").
    // Still re-mirror the Map, since providers can register art lazily
    // and new mirror packs' art may not have been present the first time.
    const added = mirrorArtMapEntries(manager, moduleId);
    if (log && added) {
      console.log(`${moduleId} | CompendiumArt bridge: mirrored ${added} additional index-level art entries.`);
    }
    return true;
  }

  const originalApplyArt = manager.applyArt.bind(manager);

  Object.defineProperty(manager, PATCH_MARKER, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: {
      originalApplyArt,
      moduleId
    }
  });

  manager.applyArt = function pf2eKrApplyArtBridge(documentClass, source, packId) {
    const upstreamPackId = getUpstreamPackId(packId, moduleId);
    return originalApplyArt(documentClass, source, upstreamPackId ?? packId);
  };

  const mirroredCount = mirrorArtMapEntries(manager, moduleId);

  if (log) {
    console.log(
      `${moduleId} | CompendiumArt bridge enabled. Mirror Actor packs will reuse art mapped to matching ` +
      `pf2e packs (${mirroredCount} index-level entries mirrored for Compendium Browser thumbnails).`
    );
  }

  return true;
}

/**
 * CompendiumArt extends Map, keyed by Document UUID. For every key that
 * points at an upstream `pf2e.<pack>` document, add a matching key pointing
 * at the same art descriptor under the corresponding `PF2e-KR.<pack>` mirror
 * pack, if that mirror pack exists. This is what makes index-level (browser
 * thumbnail) lookups work, since those bypass `applyArt` and call `.get()`
 * on the manager directly.
 */
function mirrorArtMapEntries(manager, moduleId = "PF2e-KR") {
  const additions = [];
  const uuidPattern = new RegExp(`^Compendium\\.pf2e\\.([A-Za-z0-9_-]+)\\.(.+)$`);

  for (const [uuid, art] of manager.entries()) {
    const match = uuidPattern.exec(uuid);
    if (!match) continue;
    const [, pack, rest] = match;
    const mirrorPackId = `${moduleId}.${pack}`;
    if (!game?.packs?.has?.(mirrorPackId)) continue;

    const mirrorUuid = `Compendium.${mirrorPackId}.${rest}`;
    if (manager.has(mirrorUuid)) continue;
    additions.push([mirrorUuid, art]);
  }

  for (const [uuid, art] of additions) manager.set(uuid, art);
  return additions.length;
}

export function getUpstreamPackId(packId, moduleId = "PF2e-KR") {
  if (typeof packId !== "string") return null;

  const prefix = `${moduleId}.`;
  if (!packId.startsWith(prefix)) return null;

  const packName = packId.slice(prefix.length);
  if (!packName) return null;

  const upstreamPackId = `pf2e.${packName}`;

  // Only redirect real mirror pairs. This prevents custom PF2e-KR-only packs
  // from accidentally borrowing art from an unrelated collection name.
  if (!game?.packs?.has?.(packId) || !game?.packs?.has?.(upstreamPackId)) return null;

  return upstreamPackId;
}

export function diagnoseCompendiumArtBridge({ moduleId = "PF2e-KR", log = true } = {}) {
  const manager = game?.compendiumArt;
  const providers = typeof manager?.getPackages === "function"
    ? manager.getPackages().map((provider) => ({
        packageId: provider.packageId,
        title: provider.title,
        priority: provider.priority,
        mapping: provider.mapping
      }))
    : [];

  const mirrorActorPacks = [...(game?.packs?.values?.() ?? [])]
    .filter((pack) => pack.collection?.startsWith(`${moduleId}.`))
    .filter((pack) => pack.documentName === "Actor")
    .map((pack) => {
      const upstream = getUpstreamPackId(pack.collection, moduleId);
      return {
        mirror: pack.collection,
        upstream,
        bridged: Boolean(upstream)
      };
    });

  const mirroredIndexEntries = manager
    ? [...manager.keys()].filter((uuid) => uuid.startsWith(`Compendium.${moduleId}.`)).length
    : 0;

  const result = {
    installed: Boolean(manager?.[PATCH_MARKER]),
    enabled: manager?.enabled ?? null,
    providers,
    mirrorActorPacks,
    bridgedActorPacks: mirrorActorPacks.filter((p) => p.bridged).length,
    mirroredIndexEntries
  };

  if (log) {
    console.group(`${moduleId} | CompendiumArt bridge diagnostics`);
    console.log(`Bridge installed: ${result.installed}`);
    console.log(`Foundry CompendiumArt enabled: ${result.enabled}`);
    console.log(`Active art providers: ${providers.length}`);
    console.log(`Bridged mirror Actor packs: ${result.bridgedActorPacks}/${mirrorActorPacks.length}`);
    console.log(`Mirrored index-level (Compendium Browser thumbnail) art entries: ${mirroredIndexEntries}`);
    if (providers.length) console.table(providers);
    console.table(mirrorActorPacks);
    console.groupEnd();
  }

  return result;
}

/**
 * Diagnostic helper: load the same Actor from the KR mirror and the upstream
 * pack and compare their resolved image/token paths. This does not modify them.
 */
export async function compareActorArt(packName, documentId, { moduleId = "PF2e-KR", log = true } = {}) {
  const mirrorPack = game?.packs?.get?.(`${moduleId}.${packName}`);
  const upstreamPack = game?.packs?.get?.(`pf2e.${packName}`);

  if (!mirrorPack || !upstreamPack) {
    throw new Error(`${moduleId} | Missing mirror pair for pack: ${packName}`);
  }
  if (mirrorPack.documentName !== "Actor" || upstreamPack.documentName !== "Actor") {
    throw new Error(`${moduleId} | ${packName} is not an Actor pack.`);
  }

  const [mirror, upstream] = await Promise.all([
    mirrorPack.getDocument(documentId),
    upstreamPack.getDocument(documentId)
  ]);

  const summarize = (actor) => actor
    ? {
        name: actor.name,
        img: actor.img,
        token: actor.prototypeToken?.texture?.src ?? null,
        sourceId: actor._stats?.compendiumSource ?? null
      }
    : null;

  const result = {
    mirror: summarize(mirror),
    upstream: summarize(upstream)
  };

  if (log) console.table(result);
  return result;
}
