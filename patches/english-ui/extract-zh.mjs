// Extract Chinese UI strings from the ARTEX web frontend.
//
//   node extract-zh.mjs <web/src dir> <out.json>
//
// A char-level scanner (not a regex) so that real JS/TS string lexical rules are
// respected: ' and " may not contain a raw newline, ` may. Comments are skipped.
// JSX text (CJK sitting between > and < outside any literal) is captured from a
// copy of the source where every literal has been blanked out, so a string can
// never masquerade as JSX text.
//
// Output buckets:
//   label  : short single-line strings -> must be exact dictionary keys
//   text   : short JSX text nodes      -> must be exact dictionary keys
//   dyn    : template literals with ${...} -> need a regex pattern
//   blob   : long / multi-line strings (prompt text, demo docs) -> reported only

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const outPath = process.argv[3] || "zh-strings.json";
if (!root) {
  console.error("usage: node extract-zh.mjs <web/src dir> [out.json]");
  process.exit(1);
}

const HAS_CJK = /[\u4e00-\u9fff]/;
const LABEL_MAX = 80;

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

// Scan one file. Returns { literals: string[], masked: string }.
function scan(src) {
  const literals = [];
  let masked = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const nx = src[i + 1];
    if (c === "/" && nx === "/") {                 // line comment
      while (i < n && src[i] !== "\n") { masked += " "; i++; }
      continue;
    }
    if (c === "/" && nx === "*") {                 // block comment
      masked += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { masked += src[i] === "\n" ? "\n" : " "; i++; }
      masked += "  "; i += 2;
      continue;
    }
    if (c === "'" || c === "\"") {                 // single/double literal
      let j = i + 1, out = "", ok = true;
      while (j < n) {
        const d = src[j];
        if (d === "\\") { out += src[j] + (src[j + 1] ?? ""); j += 2; continue; }
        if (d === "\n") { ok = false; break; }
        if (d === c) break;
        out += d; j++;
      }
      if (ok && j < n && src[j] === c) {
        literals.push(out);
        for (let k = i; k < j + 1; k++) masked += src[k] === "\n" ? "\n" : " ";
        i = j + 1; continue;
      }
      masked += " "; i++; continue;
    }
    if (c === "`") {                                 // template literal
      let j = i + 1, out = "";
      while (j < n) {
        const d = src[j];
        if (d === "\\") { out += src[j] + (src[j + 1] ?? ""); j += 2; continue; }
        if (d === "`") break;
        out += d; j++;
      }
      literals.push(out);
      for (let k = i; k < j + 1; k++) masked += src[k] === "\n" ? "\n" : " ";
      i = j + 1; continue;
    }
    masked += c; i++;
  }
  return { literals, masked };
}

const files = walk(root, []);
const label = new Map();
const dyn = new Map();
const text = new Map();
const blob = new Map();
const add = (m, s, f) => { if (!m.has(s)) m.set(s, new Set()); m.get(s).add(f); };

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = f.slice(root.length + 1);
  const { literals, masked } = scan(src);
  for (const s of literals) {
    if (!HAS_CJK.test(s)) continue;
    if (s.includes("${")) { add(dyn, s, rel); continue; }
    if (s.includes("\n") || s.length > LABEL_MAX) add(blob, s, rel);
    else add(label, s, rel);
  }
  const re = />([^<>{}]*?[\u4e00-\u9fff][^<>{}]*?)</g;
  let m;
  while ((m = re.exec(masked))) {
    const t = m[1].trim();
    if (t && t.length <= LABEL_MAX) add(text, t, rel);
  }
}

const dump = (m) => Object.fromEntries([...m].sort().map(([k, v]) => [k, [...v].sort()]));
writeFileSync(outPath, JSON.stringify({
  files: files.length,
  label: dump(label),
  text: dump(text),
  dyn: dump(dyn),
  blob: dump(blob),
}, null, 2));
console.log(`files=${files.length} label=${label.size} text=${text.size} dyn=${dyn.size} blob=${blob.size}`);
