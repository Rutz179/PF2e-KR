/**
 * 영문 병기: "화염 광선(Fire Ray)".
 *
 * Normalises every translated name at build time, whatever the dictionary
 * holds, so entries typed or DeepL-translated without the English still come
 * out bilingual (and the other way round when the option is off).
 *
 * Switch: tools/local.config.json → "bilingualNames": true | false
 *         (or env PF2EKR_BILINGUAL=0/1). Default: on.
 */
import { LOCAL_CONFIG } from "./common.mjs";

const HANGUL = /[\uAC00-\uD7A3]/;

export function bilingualEnabled() {
  const env = process.env.PF2EKR_BILINGUAL;
  if (env !== undefined && env !== "") return !/^(0|false|off|no)$/i.test(env);
  return LOCAL_CONFIG.bilingualNames !== false;
}

/** "화염 광선" + "Fire Ray" → "화염 광선(Fire Ray)"; with off: strip "(Fire Ray)". */
export function formatName(korean, english, on = bilingualEnabled()) {
  const ko = String(korean ?? "").trim();
  const en = String(english ?? "").trim();
  if (!ko || !en || !HANGUL.test(ko) || ko === en) return ko || korean;
  // "Augury (At Will)" → also try the base "Augury"
  const candidates = [...new Set([en, en.replace(/\s*\([^()]*\)\s*$/, "").trim()])].filter(Boolean);
  if (on) {
    if (candidates.some(c => ko.includes(c))) return ko;              // already bilingual
    if (/\([^()]*[A-Za-z]{3,}[^()]*\)/.test(ko)) return ko;           // has some English original already
    return `${ko}(${en})`;
  }
  let out = ko;
  for (const c of candidates) {
    out = out.replace(` (${c})`, "").replace(`(${c})`, "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Apply to a built document and its embedded items (matched by id to the source). */
export function normalizeNames(out, source, on = bilingualEnabled()) {
  if (!out || !source) return;
  out.name = formatName(out.name, source.name, on);
  if (Array.isArray(out.items) && Array.isArray(source.items)) {
    const byId = new Map(source.items.map(i => [i?._id, i]));
    for (const item of out.items) {
      const original = item?.flags?.["PF2e-KR"]?.originalName ?? byId.get(item?._id)?.name;
      if (original) item.name = formatName(item.name, original, on);
    }
  }
}
