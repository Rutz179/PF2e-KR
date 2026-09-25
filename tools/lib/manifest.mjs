import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, PF2E_ROOT, readJSON, writeJSON, fileExists } from "./common.mjs";

function sanitizePackMeta(source, translationLabel) {
  const out = {
    name: source.name,
    label: `PF2e-KR | ${translationLabel ?? source.label ?? source.name}`,
    path: `packs/${source.name}`,
    type: source.type,
    system: source.system ?? "pf2e"
  };

  // Keep PF2e's access model and browser-facing metadata. The path/package
  // namespace is the only part that intentionally changes.
  if (source.banner) out.banner = source.banner;
  if (source.ownership) out.ownership = structuredClone(source.ownership);
  if (source.flags) out.flags = structuredClone(source.flags);

  return out;
}

function filterFolderNode(folder, selectedSet) {
  const packs = (folder.packs ?? []).filter((name) => selectedSet.has(name));
  const folders = (folder.folders ?? [])
    .map((child) => filterFolderNode(child, selectedSet))
    .filter(Boolean);

  if (!packs.length && !folders.length) return null;

  const out = {
    name: `KR • ${folder.name}`,
    sorting: folder.sorting ?? "m",
    packs
  };
  if (folder.color) out.color = folder.color;
  if (folders.length) out.folders = folders;
  return out;
}

function filterPackFolders(folders, selectedSet) {
  const out = (folders ?? [])
    .map((folder) => filterFolderNode(folder, selectedSet))
    .filter(Boolean);

  const claimed = new Set();
  function collect(nodes) {
    for (const node of nodes) {
      for (const pack of node.packs ?? []) claimed.add(pack);
      collect(node.folders ?? []);
    }
  }
  collect(out);

  const unclaimed = [...selectedSet].filter((name) => !claimed.has(name)).sort();
  if (unclaimed.length) {
    out.push({ name: "PF2e-KR • 기타", sorting: "a", packs: unclaimed });
  }
  return out;
}

export async function generateManifest(selectedPacks, mode = "ko-en") {
  const base = await readJSON(path.join(ROOT, "module.base.json"));
  const systemManifest = await readJSON(path.join(PF2E_ROOT, "system.json"));
  const selectedSet = new Set(selectedPacks);
  const sourceByName = new Map((systemManifest.packs ?? []).map((p) => [p.name, p]));
  const packs = [];

  for (const name of [...selectedSet].sort()) {
    const source = sourceByName.get(name);
    if (!source) continue;
    const translationPath = path.join(ROOT, "compendium", mode, `pf2e.${name}.json`);
    let label = source.label ?? name;
    if (await fileExists(translationPath)) {
      const t = await readJSON(translationPath);
      label = t.label ?? label;
    }
    packs.push(sanitizePackMeta(source, label));
  }

  base.packs = packs;
  base.packFolders = filterPackFolders(systemManifest.packFolders, new Set(packs.map((p) => p.name)));
  base.flags = {
    ...(base.flags ?? {}),
    "PF2e-KR": {
      buildMode: mode,
      packCount: packs.length,
      upstreamSystemVersion: systemManifest.version ?? null
    }
  };

  await writeJSON(path.join(ROOT, "module.json"), base);
  return base;
}

export async function discoverBuiltPacks() {
  const packsDir = path.join(ROOT, "packs");
  try {
    const result = [];
    for (const entry of await fs.readdir(packsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const contents = await fs.readdir(path.join(packsDir, entry.name));
      if (contents.length > 0) result.push(entry.name);
    }
    return result.sort();
  } catch {
    return [];
  }
}
