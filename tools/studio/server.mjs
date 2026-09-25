/**
 * PF2e-KR 스튜디오 — 번역 유지보수를 창 하나에서.
 *   npm run studio   (또는 저장소의 "스튜디오 열기.bat" 더블클릭)
 * Local only: listens on 127.0.0.1, never on the network.
 */
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, PF2E_ROOT, DEFAULT_MODE, DEPLOY_DIR } from "../lib/common.mjs";
import { formatName } from "../lib/names.mjs";

const PORT = Number(process.env.STUDIO_PORT ?? 5178);
const MODE = process.env.PF2EKR_MODE ?? DEFAULT_MODE;
const DICT_DIR = path.join(ROOT, "compendium", MODE);
const LANG_DIR = path.join(ROOT, "lang");
const HANGUL = /[\uAC00-\uD7A3]/;
const LATIN = /[A-Za-z]{2,}/;
const BACKUP_ROOT = path.join(ROOT, ".studio-backup");

/* ---------------- helpers ---------------- */

const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Set a dotted key inside an existing (possibly mixed flat/nested) i18n object. */
function setI18n(obj, flatKey, value) {
  let node = obj;
  let rest = flatKey;
  while (rest) {
    if (Object.prototype.hasOwnProperty.call(node, rest) && typeof node[rest] !== "object") { node[rest] = value; return; }
    const keys = Object.keys(node).filter(k => rest.startsWith(`${k}.`) && node[k] && typeof node[k] === "object")
      .sort((a, b) => b.length - a.length);
    if (!keys.length) break;
    node = node[keys[0]];
    rest = rest.slice(keys[0].length + 1);
  }
  const parts = rest.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts.at(-1)] = value;
}

function getPath(obj, parts) {
  return parts.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, parts, value) {
  let node = obj;
  for (const k of parts.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k];
  }
  node[parts.at(-1)] = value;
}

function indentOf(text) {
  const m = /^\{\r?\n([ \t]+)"/.exec(text);
  return m ? m[1] : "  ";
}

/*
 * Every change gets its own backup folder: .studio-backup/<time>_<what>/…
 * holding the files exactly as they were before that change, plus info.json.
 * (Earlier versions reused one folder per session, so a second change to the
 * same file overwrote the first backup.)
 */
let backupDir = null;
function beginChange(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  backupDir = path.join(BACKUP_ROOT, `${stamp}_${label.replace(/[^0-9A-Za-z가-힣._-]+/g, "-").slice(0, 40)}`);
  return backupDir;
}

async function saveJson(file, data) {
  const original = await fs.readFile(file, "utf8").catch(() => null);
  if (original !== null) {
    backupDir ??= beginChange("change");
    const target = path.join(backupDir, path.relative(ROOT, file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (!existsSync(target)) await fs.writeFile(target, original);
    const infoFile = path.join(backupDir, "info.json");
    const info = existsSync(infoFile) ? JSON.parse(await fs.readFile(infoFile, "utf8")) : { when: new Date().toISOString(), files: [] };
    if (!info.files.includes(path.relative(ROOT, file))) info.files.push(path.relative(ROOT, file));
    await fs.writeFile(infoFile, JSON.stringify(info, null, 2));
  }
  const text = JSON.stringify(data, null, original ? indentOf(original) : "  ") + "\n";
  await fs.writeFile(file, text, "utf8");
  cache.delete(file);
}

async function listBackups() {
  if (!existsSync(BACKUP_ROOT)) return [];
  const out = [];
  for (const name of (await fs.readdir(BACKUP_ROOT)).sort().reverse().slice(0, 40)) {
    const info = await readJson(path.join(BACKUP_ROOT, name, "info.json")).catch(() => null);
    out.push({ name, when: info?.when ?? null, files: info?.files ?? [] });
  }
  return out;
}

/** Put a backup's files back (the current state is itself backed up first). */
async function restoreBackup(name) {
  const dir = path.join(BACKUP_ROOT, path.basename(name));
  const info = await readJson(path.join(dir, "info.json"));
  beginChange(`restore-${name}`);
  for (const rel of info.files) {
    const saved = await readJson(path.join(dir, rel));
    await saveJson(path.join(ROOT, rel), saved);
  }
  return { restored: info.files.length };
}

/** Translated (Hangul) entries in a lang file — to compare two copies. */
function koCount(flat) {
  return Object.values(flat).filter(v => typeof v === "string" && HANGUL.test(v)).length;
}

/*
 * Protect everything DeepL must not touch; it only ever sees ⟦n⟧ tokens there.
 * A scanner (not one regex) so nested brackets survive:
 *   @Damage[20d10[sonic]|options:area-damage]   @Check[fortitude|dc:20]
 *   [[/r 2d6[fire]]]{label}   <p> </p>   {name}  {item|_id}   item:id:{item|_id}
 * Link/roll labels ({...} right after @Word[...] or [[...]]) stay translatable:
 * only the brackets around them are protected.
 */
function matchBracket(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

function protect(text) {
  const s = String(text);
  const map = {};
  let n = 0;
  let out = "";
  const token = raw => {
    const t = `⟦${++n}⟧`;
    map[t] = raw;
    return t;
  };
  // Emit an enricher/roll and, if a {label} follows, keep the label text translatable.
  const withLabel = (raw, after) => {
    if (s[after] === "{") {
      const close = s.indexOf("}", after);
      if (close > after) return { text: token(`${raw}{`) + s.slice(after + 1, close) + token("}"), next: close + 1 };
    }
    return { text: token(raw), next: after };
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^@[A-Za-z]+\[/.exec(rest))) {
      const end = matchBracket(s, i + m[0].length - 1);
      if (end > 0) {
        const r = withLabel(s.slice(i, end + 1), end + 1);
        out += r.text; i = r.next; continue;
      }
    }
    if (rest.startsWith("[[")) {
      const end = matchBracket(s, i);
      if (end > 0) {
        const r = withLabel(s.slice(i, end + 1), end + 1);
        out += r.text; i = r.next; continue;
      }
    }
    if ((m = /^<\/?[A-Za-z][^<>]*>/.exec(rest))) { out += token(m[0]); i += m[0].length; continue; }
    // roll options / predicates: item:id:{item|_id}, self:condition:frightened
    if (!/[A-Za-z0-9_]/.test(s[i - 1] ?? "") && (m = /^[a-z][a-z0-9-]*(?::[A-Za-z0-9{}|_.-]+)+/.exec(rest))) {
      out += token(m[0]); i += m[0].length; continue;
    }
    const boundary = !/[A-Za-z0-9_]/.test(s[i - 1] ?? "");
    // i18n keys / dotted paths: PF2E.Skill.Occultism, TYPES.Actor.npc, system.details.level
    if (boundary && (m = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+/.exec(rest))) {
      const parts = m[0].split(".");
      const looksLikeKey = parts.length >= 3 || /^[A-Z0-9]{2,}$/.test(parts[0]) || parts.some(p => /[a-z][A-Z]/.test(p));
      if (looksLikeKey && !/[A-Za-z0-9_]/.test(s[i + m[0].length] ?? "")) { out += token(m[0]); i += m[0].length; continue; }
    }
    // code identifiers: ActorTraits, TokenLight, PF2e, HPDetails
    if (boundary && (m = /^(?:[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[0-9]+[A-Za-z0-9]*)/.exec(rest))
        && !/[A-Za-z0-9_]/.test(s[i + m[0].length] ?? "")) {
      out += token(m[0]); i += m[0].length; continue;
    }
    if ((m = /^\{[^{}\n]*\}/.exec(rest))) { out += token(m[0]); i += m[0].length; continue; }
    if ((m = /^\r?\n/.exec(rest))) { out += token(m[0]); i += m[0].length; continue; }
    out += s[i]; i++;
  }
  return { out, map };
}
function restore(text, map) {
  // DeepL sometimes writes "⟦ 3 ⟧" or "⟦3 ⟧"; accept those too.
  return String(text).replace(/⟦\s*(\d+)\s*⟧/g, (t, n) => map[`⟦${n}⟧`] ?? t);
}

/* ---------------- data access (cached) ---------------- */

const cache = new Map();
async function load(file) {
  const stat = await fs.stat(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit.data;
  const data = await readJson(file);
  cache.set(file, { mtime: stat.mtimeMs, data });
  return data;
}

async function langPairs() {
  const system = await readJson(path.join(PF2E_ROOT, "system.json")).catch(() => null);
  const en = (system?.languages ?? []).filter(l => l.lang === "en").map(l => l.path);
  const pairs = [];
  for (const rel of en) {
    const koName = path.basename(rel).replace(/(^|-)en\.json$/, "$1ko.json");
    pairs.push({ en: path.join(PF2E_ROOT, rel), ko: path.join(LANG_DIR, koName), name: koName });
  }
  return pairs;
}

async function langStatus(pair) {
  const en = flatten(await load(pair.en));
  const koExists = existsSync(pair.ko);
  const ko = koExists ? flatten(await load(pair.ko)) : {};
  const missing = [], untranslated = [], stale = [];
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== "string") continue;
    if (!(k in ko)) missing.push(k);
    else if (typeof ko[k] === "string" && LATIN.test(v) && !HANGUL.test(ko[k])) untranslated.push(k);
  }
  for (const k of Object.keys(ko)) if (!(k in en)) stale.push(k);
  return { name: pair.name, koExists, total: Object.keys(en).length, missing, untranslated, stale, en, ko };
}

async function dictFiles() {
  if (!existsSync(DICT_DIR)) return [];
  return (await fs.readdir(DICT_DIR)).filter(f => f.endsWith(".json")).sort();
}

/** Untranslated strings in a dictionary + documents PF2e added that it doesn't have yet. */
async function dictStatus(file) {
  const dict = await load(path.join(DICT_DIR, file));
  const entries = dict.entries ?? {};
  const untranslated = [];
  const walk = (value, parts) => {
    if (typeof value === "string") {
      if (LATIN.test(value) && !HANGUL.test(value)) untranslated.push({ path: parts, text: value });
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, [...parts, k]);
    }
  };
  for (const [key, entry] of Object.entries(entries)) walk(entry, ["entries", key]);

  const pack = file.replace(/^pf2e\./, "").replace(/\.json$/, "");
  const sourceDir = path.join(ROOT, ".build", "source", pack);
  const missing = [];
  if (existsSync(sourceDir)) {
    const mapping = dict.mapping ?? {};
    for (const f of await fs.readdir(sourceDir)) {
      if (!f.endsWith(".json")) continue;
      const doc = await readJson(path.join(sourceDir, f)).catch(() => null);
      if (!doc?.name || entries[doc.name]) continue;
      missing.push({ path: ["entries", doc.name, "name"], text: doc.name, isNew: true });
      for (const [field, target] of Object.entries(mapping)) {
        if (typeof target !== "string") continue;
        const v = getPath(doc, target.split("."));
        if (typeof v === "string" && LATIN.test(v)) missing.push({ path: ["entries", doc.name, field], text: v, isNew: true });
      }
    }
  }
  return { file, label: dict.label ?? pack, untranslated, missing };
}

/* ---------------- DeepL jobs ---------------- */

async function exportJob({ kind, target, scope }) {
  let items = [];
  if (kind === "lang") {
    const pair = (await langPairs()).find(p => p.name === target);
    if (!pair) throw new Error("해당 언어 파일이 없습니다.");
    const st = await langStatus(pair);
    const keys = scope === "missing" ? st.missing : scope === "untranslated" ? st.untranslated : [...st.missing, ...st.untranslated];
    items = keys.map(k => ({ path: [k], text: st.en[k] }));
  } else {
    const st = await dictStatus(target);
    items = scope === "missing" ? st.missing : scope === "untranslated" ? st.untranslated : [...st.missing, ...st.untranslated];
  }
  const lines = [];
  const job = { kind, target, items: [] };
  for (const item of items) {
    const { out, map } = protect(item.text);
    lines.push(out);
    job.items.push({ path: item.path, map, original: item.text });
  }
  return { job, text: lines.join("\n") };
}

function previewImport(job, text) {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length !== job.items.length) {
    return { ok: false, error: `줄 수가 다릅니다: 원문 ${job.items.length}줄, 번역 ${lines.length}줄. DeepL이 줄을 합치거나 나눴는지 확인하세요.` };
  }
  const rows = job.items.map((item, i) => {
    const restored = restore(lines[i], item.map);
    const expected = Object.keys(item.map).length;
    const found = (lines[i].match(/⟦\s*\d+\s*⟧/g) ?? []).length;
    const warn = /⟦\s*\d+\s*⟧/.test(restored) ? "자리표시자 손상"
      : found !== expected ? `자리표시자 ${expected - found}개 사라짐`
      : !HANGUL.test(restored) ? "번역 안 됨" : "";
    return { path: item.path, original: item.original, translated: restored, warn };
  });
  return { ok: true, rows };
}

async function applyImport(job, rows) {
  beginChange(`deepl-${job.target}`);
  if (job.kind === "lang") {
    const pair = (await langPairs()).find(p => p.name === job.target);
    const data = existsSync(pair.ko) ? structuredClone(await load(pair.ko)) : {};
    for (const r of rows) setI18n(data, r.path[0], r.translated);
    await saveJson(pair.ko, data);
  } else {
    const file = path.join(DICT_DIR, job.target);
    const data = structuredClone(await load(file));
    for (const r of rows) {
      // ko-en dictionaries keep names as "한글(English)" (the build can still strip it).
      const value = r.path.at(-1) === "name" && MODE === "ko-en" ? formatName(r.translated, r.original, true) : r.translated;
      setPath(data, r.path, value);
    }
    await saveJson(file, data);
  }
  return { applied: rows.length, backup: backupDir ? path.relative(ROOT, backupDir) : null };
}

/* ---------------- terminology ---------------- */

async function allTextFiles() {
  const files = (await dictFiles()).map(f => path.join(DICT_DIR, f));
  if (existsSync(LANG_DIR)) for (const f of await fs.readdir(LANG_DIR)) if (f.endsWith(".json")) files.push(path.join(LANG_DIR, f));
  return files;
}

async function findTerm({ english, variants }) {
  const hits = [];
  for (const file of await allTextFiles()) {
    const data = await load(file);
    const walk = (value, parts) => {
      if (hits.length >= 800) return;
      if (typeof value === "string") {
        for (const variant of variants) {
          const at = value.indexOf(variant);
          if (at < 0) continue;
          const isName = parts.at(-1) === "name";
          const hasEnglish = !!english && value.includes(english);
          hits.push({
            file: path.relative(ROOT, file), path: parts, variant,
            snippet: value.slice(Math.max(0, at - 40), at + variant.length + 40),
            suggested: hasEnglish || (isName && (parts.at(-2) === english))
          });
        }
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, [...parts, k]);
      }
    };
    walk(data, []);
  }
  return hits;
}

async function replaceTerm({ to, hits }) {
  beginChange(`term-${to}`);
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  let count = 0;
  for (const [rel, list] of byFile) {
    const file = path.join(ROOT, rel);
    const data = structuredClone(await load(file));
    for (const h of list) {
      const current = getPath(data, h.path);
      if (typeof current !== "string" || !current.includes(h.variant)) continue;
      setPath(data, h.path, current.split(h.variant).join(to));
      count++;
    }
    await saveJson(file, data);
  }
  return { replaced: count, backup: backupDir ? path.relative(ROOT, backupDir) : null };
}

/* ---------------- running npm scripts ---------------- */

const runs = new Map();
function startRun(script, args = []) {
  const id = Math.random().toString(36).slice(2);
  const run = { lines: [], done: false, code: null, listeners: new Set() };
  runs.set(id, run);
  const push = line => {
    run.lines.push(line);
    for (const l of run.listeners) l(line);
  };
  const child = spawn("npm", ["run", script, ...(args.length ? ["--", ...args] : [])], { cwd: ROOT, shell: true });
  child.stdout.on("data", d => String(d).split(/\r?\n/).filter(Boolean).forEach(push));
  child.stderr.on("data", d => String(d).split(/\r?\n/).filter(Boolean).forEach(push));
  child.on("close", code => {
    run.done = true;
    run.code = code;
    push(code === 0 ? "✔ 완료" : `✖ 실패 (코드 ${code})`);
    for (const l of run.listeners) l(null);
  });
  return id;
}

/* ---------------- http ---------------- */

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const routes = {
  "GET /api/status": async () => {
    const langs = [];
    for (const pair of await langPairs()) {
      try {
        const s = await langStatus(pair);
        const deployed = path.join(DEPLOY_DIR, "lang", s.name);
        let deployedAhead = 0;
        if (path.resolve(DEPLOY_DIR) !== path.resolve(ROOT) && existsSync(deployed)) {
          deployedAhead = koCount(flatten(await load(deployed))) - koCount(s.ko);
        }
        langs.push({ name: s.name, koExists: s.koExists, total: s.total, missing: s.missing.length, untranslated: s.untranslated.length, stale: s.stale.length, deployedAhead });
      } catch (e) {
        langs.push({ name: pair.name, error: e.message });
      }
    }
    const packs = [];
    for (const f of await dictFiles()) {
      const s = await dictStatus(f);
      if (s.untranslated.length || s.missing.length) packs.push({ file: f, label: s.label, untranslated: s.untranslated.length, missing: s.missing.filter(m => m.path.at(-1) === "name").length });
    }
    return { mode: MODE, pf2eRoot: PF2E_ROOT, pf2eFound: existsSync(path.join(PF2E_ROOT, "system.json")), langs, packs, dictCount: (await dictFiles()).length };
  },
  "POST /api/lang-detail": async b => {
    const pair = (await langPairs()).find(p => p.name === b.name);
    const s = await langStatus(pair);
    const pick = keys => keys.slice(0, 400).map(k => ({ key: k, en: s.en[k], ko: s.ko[k] }));
    return { missing: pick(s.missing), untranslated: pick(s.untranslated), stale: pick(s.stale) };
  },
  "POST /api/remove-stale": async b => {
    beginChange(`stale-${b.name}`);
    const pair = (await langPairs()).find(p => p.name === b.name);
    const s = await langStatus(pair);
    const data = structuredClone(await load(pair.ko));
    const drop = (obj, prefix = "") => {
      for (const k of Object.keys(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (obj[k] && typeof obj[k] === "object") {
          drop(obj[k], key);
          if (!Object.keys(obj[k]).length) delete obj[k];
        } else if (s.stale.includes(key)) delete obj[k];
      }
    };
    drop(data);
    await saveJson(pair.ko, data);
    return { removed: s.stale.length };
  },
  "GET /api/config": async () => {
    const cfg = await readJson(path.join(ROOT, "tools", "local.config.json")).catch(() => ({}));
    return { bilingualNames: cfg.bilingualNames !== false };
  },
  "POST /api/config": async b => {
    const file = path.join(ROOT, "tools", "local.config.json");
    const cfg = await readJson(file).catch(() => ({}));
    if ("bilingualNames" in b) cfg.bilingualNames = !!b.bilingualNames;
    await fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    return { ok: true };
  },
  "GET /api/backups": () => listBackups(),
  "POST /api/restore": b => restoreBackup(b.name),
  "POST /api/pull-deployed": async b => {
    const pair = (await langPairs()).find(p => p.name === b.name);
    const deployed = path.join(DEPLOY_DIR, "lang", b.name);
    beginChange(`from-foundry-${b.name}`);
    await saveJson(pair.ko, await readJson(deployed));
    return { ok: true };
  },
  "POST /api/export": b => exportJob(b),
  "POST /api/preview": b => previewImport(b.job, b.text),
  "POST /api/apply": b => applyImport(b.job, b.rows),
  "POST /api/term-find": b => findTerm(b),
  "POST /api/term-replace": b => replaceTerm(b),
  "POST /api/glossary-save": async b => {
    const file = path.join(ROOT, "tools", "studio", "glossary.decided.csv");
    const csv = b.rows.map(r => `"${r.en.replace(/"/g, '""')}","${r.ko.replace(/"/g, '""')}"`).join("\n") + "\n";
    await fs.writeFile(file, "\uFEFF" + csv, "utf8");
    return { file: path.relative(ROOT, file), count: b.rows.length };
  },
  "POST /api/run": b => ({ id: startRun(b.script, b.args ?? []) })
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await fs.readFile(new URL("./index.html", import.meta.url)));
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/stream/")) {
      const run = runs.get(url.pathname.split("/").pop());
      if (!run) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const send = line => (line === null ? res.end() : res.write(`data: ${JSON.stringify(line)}\n\n`));
      run.lines.forEach(send);
      if (run.done) return send(null);
      run.listeners.add(send);
      req.on("close", () => run.listeners.delete(send));
      return;
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) { res.writeHead(404); return res.end("not found"); }
    const result = await handler(req.method === "POST" ? await body(req) : {});
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`PF2e-KR 스튜디오: ${url}  (이 창을 닫으면 종료)`);
  const opener = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  spawn(opener, { shell: true, stdio: "ignore", detached: true }).on("error", () => {});
});
