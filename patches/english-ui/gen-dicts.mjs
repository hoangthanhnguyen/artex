// Builds the runtime overlay dictionaries from translations.json.
//
//   node gen-dicts.mjs
//
// Static strings become map entries (the overlay matches them exactly, after a
// trim). Strings that contain ${...} cannot be matched as keys because the DOM
// shows the evaluated value, so they become anchored regex patterns with the
// placeholders as capture groups. This keeps the whole translation in the
// overlay, with no source rewriting.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(join(here, "translations.json"), "utf8"));

const logTable = JSON.parse(readFileSync(join(here, "server-logs.json"), "utf8"));
for (const [zh, en] of Object.entries(logTable)) {
  if (table[zh] === undefined) table[zh] = en;
  const prefix = /^\[[^\]]+\]\s*/;
  const bare = zh.replace(prefix, "");
  if (table[bare] === undefined) table[bare] = en.replace(prefix, "");
}

const CJK = /[\u4e00-\u9fff]/;
const isCodeFragment = (s) =>
  s.includes("\n") && /(?:\breturn\b|\bconst\b|\blet\b|=>|;\s*$|\bif \()/.test(s);

// Split a template string into literal runs and ${...} placeholders, matching
// braces so nested object literals inside the expression do not end it early.
function splitTemplate(s) {
  const parts = [];
  let i = 0;
  let buf = "";
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      if (buf) parts.push({ lit: buf });
      buf = "";
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") depth--;
        j++;
      }
      parts.push({ ph: s.slice(i, j) });
      i = j;
    } else {
      buf += s[i];
      i++;
    }
  }
  if (buf) parts.push({ lit: buf });
  return parts;
}

// Go format strings use %-verbs instead of ${...}; %s/%d/%q/%v/%w render as
// substituted text in the DOM, so they become wildcard placeholders too.
const VERB = /%(?:\[[0-9]+\])?[+\-# .0-9]*[sdqvwxXfFeEgGtT]/;
const hasVerb = (s) => VERB.test(s);
function splitFormat(s) {
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(new RegExp(VERB.source, "g"))) {
    if (m.index > last) parts.push({ lit: s.slice(last, m.index) });
    parts.push({ ph: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ lit: s.slice(last) });
  return parts;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const map = {};
const patterns = [];
let skipped = 0;

for (const [k, v] of Object.entries(table)) {
  if (k === "__placeholder__" || !CJK.test(k)) continue;
  if (isCodeFragment(k)) {
    skipped++;
    continue;
  }

  const hasTmpl = k.includes("${");
  if (!hasTmpl && !hasVerb(k)) {
    map[k] = v;
    // JSX collapses whitespace across lines, so register the collapsed form
    // too or multi-line paragraphs never match the rendered text node.
    if (k.includes("\n")) {
      const collapsed = k.replace(/\s*\n\s*/g, " ").trim();
      if (collapsed && collapsed !== k && map[collapsed] === undefined) {
        map[collapsed] = v.replace(/\s*\n\s*/g, " ").trim();
      }
    }
    continue;
  }

  const split = hasTmpl ? splitTemplate : splitFormat;
  const kp = split(k);
  const vp = split(v);
  const kPh = kp.filter((p) => p.ph).length;
  const vPh = vp.filter((p) => p.ph).length;
  if (kPh === 0 || kPh !== vPh) {
    skipped++;
    continue;
  }
  // A dynamic pattern is only useful and safe when a literal run carries real
  // text; one made only of punctuation would match unrelated strings.
  if (!kp.some((p) => p.lit && CJK.test(p.lit))) {
    skipped++;
    continue;
  }

  let re = "^";
  for (const p of kp) re += p.lit !== undefined ? escapeRe(p.lit) : "(.+?)";
  re += "$";

  let en = "";
  let n = 0;
  for (const p of vp) {
    if (p.lit !== undefined) en += p.lit;
    else en += "$" + ++n;
  }

  const litLen = kp.reduce((a, p) => a + (p.lit ? p.lit.length : 0), 0);
  patterns.push({ re, en, litLen });
}

// First match wins in the overlay, so the most specific patterns go first.
patterns.sort((a, b) => b.litLen - a.litLen);

writeFileSync(join(here, "extra5-zh.json"), JSON.stringify(map, null, 1) + "\n", "utf8");
writeFileSync(
  join(here, "auto-patterns.json"),
  JSON.stringify(patterns.map(({ re, en }) => ({ re, en })), null, 1) + "\n",
  "utf8",
);

console.log("map entries:", Object.keys(map).length);
console.log("patterns:", patterns.length);
console.log("skipped:", skipped);
// end of generator
