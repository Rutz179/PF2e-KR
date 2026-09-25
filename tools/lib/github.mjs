/**
 * Minimal GitHub REST client (no GitHub CLI needed).
 * Token: tools/local.config.json → "githubToken", or env GITHUB_TOKEN.
 * Create one at https://github.com/settings/tokens (fine-grained, this repo,
 * permission "Contents: Read and write").
 */
import fs from "node:fs/promises";
import path from "node:path";

export function repoFromUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/.exec(String(url ?? ""));
  if (!m) throw new Error("module.base.json의 url이 https://github.com/<계정>/<저장소> 형식이어야 합니다.");
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

export function client(token, { owner, repo }) {
  if (!token) throw new Error("GitHub 토큰이 없습니다. tools/local.config.json 에 \"githubToken\"을 넣어 주세요.");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const api = async (method, url, body) => {
    const res = await fetch(url.startsWith("http") ? url : `https://api.github.com/repos/${owner}/${repo}${url}`, {
      method, headers: body && !(body instanceof Uint8Array) ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body && !(body instanceof Uint8Array) ? JSON.stringify(body) : body
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${url} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    createRelease: (tag, target) => api("POST", "/releases", { tag_name: tag, name: tag, target_commitish: target, generate_release_notes: true }),
    async upload(release, file, contentType) {
      const data = await fs.readFile(file);
      const name = path.basename(file);
      const url = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
      const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": contentType, "Content-Length": String(data.length) }, body: data });
      if (!res.ok) throw new Error(`업로드 실패 ${name}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    listReleases: () => api("GET", "/releases?per_page=100"),
    deleteRelease: id => api("DELETE", `/releases/${id}`)
  };
}
