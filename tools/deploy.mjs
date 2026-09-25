/**
 * npm run deploy
 * Copies the playable module (module.json, packs, lang, src, styles …) into
 * Foundry's Data/modules/PF2e-KR. The repo itself can live anywhere.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, DEPLOY_DIR } from "./lib/common.mjs";
const DIST_ENTRIES = ["module.json", "packs", "lang", "src", "styles", "LICENSE.md", "README.md"];

async function main() {
  if (path.resolve(DEPLOY_DIR) === path.resolve(ROOT)) {
    console.log("이 저장소가 곧 Foundry 모듈 폴더입니다. 복사할 필요가 없습니다.");
    return;
  }
  const entries = [];
  for (const entry of DIST_ENTRIES) {
    try { await fs.access(path.join(ROOT, entry)); entries.push(entry); } catch { /* optional */ }
  }
  await fs.mkdir(DEPLOY_DIR, { recursive: true });
  for (const entry of entries) {
    const target = path.join(DEPLOY_DIR, entry);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(path.join(ROOT, entry), target, { recursive: true });
  }
  console.log(`배포 완료 → ${DEPLOY_DIR}\n  ${entries.join(", ")}`);
  console.log("Foundry가 켜져 있다면 월드를 새로고침하세요. (팩이 잠겨 있으면 Foundry를 끄고 다시 실행)");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
