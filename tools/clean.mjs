import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, readJSON, writeJSON } from "./lib/common.mjs";

for (const dir of [".build", "packs", "reports"]) {
  await fs.rm(path.join(ROOT, dir), { recursive: true, force: true });
  await fs.mkdir(path.join(ROOT, dir), { recursive: true });
}
await fs.writeFile(path.join(ROOT, "packs", ".gitkeep"), "", "utf8");

const base = await readJSON(path.join(ROOT, "module.base.json"));
base.packs = [];
base.packFolders = [];
await writeJSON(path.join(ROOT, "module.json"), base);
console.log("Removed generated native packs, temporary extraction files, and reports.");
