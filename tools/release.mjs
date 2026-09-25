/**
 * npm run release -- 2.0.1 [--keep 3]
 *
 * Everything happens on this PC; GitHub only stores the result:
 *   1. version + install/update URLs → module.base.json, regenerate module.json
 *   2. build check
 *   3. dist/module.zip (packs included) + dist/module.json
 *   4. commit & push the small text changes (module.base.json, module.json)
 *   5. create the GitHub release v2.0.1 and upload both files
 *   6. --keep N: delete releases older than the newest N (frees their storage)
 * packs/ never enters git history, so the repository stays small.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, readJSON, writeJSON, DEFAULT_MODE, LOCAL_CONFIG } from "./lib/common.mjs";
import { discoverBuiltPacks, generateManifest } from "./lib/manifest.mjs";
import { existingDistEntries, makeZip } from "./lib/dist.mjs";
import { client, repoFromUrl } from "./lib/github.mjs";

const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });

async function main() {
  const args = process.argv.slice(2);
  const version = (args.find(a => !a.startsWith("--")) ?? "").replace(/^v/, "");
  const keepIndex = args.indexOf("--keep");
  const keep = keepIndex >= 0 ? Number(args[keepIndex + 1]) : 0;
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version)) {
    console.error("사용법: npm run release -- 2.0.1   (옛 릴리스 정리: --keep 3)");
    process.exit(1);
  }
  const tag = `v${version}`;
  const token = process.env.GITHUB_TOKEN ?? LOCAL_CONFIG.githubToken;

  const basePath = path.join(ROOT, "module.base.json");
  const base = await readJSON(basePath);
  const repoInfo = repoFromUrl(base.url);
  const repoUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
  base.version = version;
  base.manifest = `${repoUrl}/releases/latest/download/module.json`;
  base.download = `${repoUrl}/releases/download/${tag}/module.zip`;
  await writeJSON(basePath, base);

  const packs = await discoverBuiltPacks();
  if (!packs.length) throw new Error("빌드된 팩이 없습니다. 먼저 빌드하세요.");
  await generateManifest(packs, process.env.PF2EKR_MODE ?? DEFAULT_MODE);
  console.log(`[1/5] module.json 생성 — 팩 ${packs.length}개, 버전 ${version}`);

  if (spawnSync("node", ["tools/check-build.mjs"], { cwd: ROOT, stdio: "inherit" }).status !== 0) {
    throw new Error("빌드 검사 실패 — 릴리스를 멈춥니다.");
  }
  console.log("[2/5] 빌드 검사 통과");

  const dist = path.join(ROOT, "dist");
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
  makeZip(path.join(dist, "module.zip"), await existingDistEntries());
  await fs.copyFile(path.join(ROOT, "module.json"), path.join(dist, "module.json"));
  const size = (await fs.stat(path.join(dist, "module.zip"))).size;
  console.log(`[3/5] dist/module.zip (${(size / 1048576).toFixed(1)} MB), dist/module.json`);

  git("add", "module.base.json", "module.json");
  git("commit", "-m", `release ${tag}`);
  const pushed = git("push");
  if (pushed.status !== 0) throw new Error(`git push 실패:\n${pushed.stderr}`);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim() || "main";
  console.log(`[4/5] 버전 커밋·푸시 (${branch})`);

  const gh = client(token, repoInfo);
  const release = await gh.createRelease(tag, branch);
  await gh.upload(release, path.join(dist, "module.json"), "application/json");
  await gh.upload(release, path.join(dist, "module.zip"), "application/zip");
  console.log(`[5/5] 릴리스 게시: ${release.html_url}`);

  if (keep > 0) {
    const all = (await gh.listReleases()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    for (const old of all.slice(keep)) {
      await gh.deleteRelease(old.id);
      console.log(`  옛 릴리스 삭제: ${old.tag_name}`);
    }
  }
  console.log(`\n설치 주소: ${base.manifest}`);
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
