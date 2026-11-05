// Report coverage of the extracted Chinese UI surface by the overlay dicts.
//
//   node coverage.mjs <zh-strings.json> <patches/english-ui>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [zhPath, patchDir] = process.argv.slice(2);
if (!zhPath || !patchDir) {
  console.error("usage: node coverage.mjs <zh-strings.json> <english-ui dir>");
  process.exit(1);
}

const zh = JSON.parse(readFileSync(zhPath, "utf8"));
const dict = {};
for (const f of [
  "locale-zh.json", "extra-zh.json", "extra2-zh.json", "extra3-zh.json",
  "extra4-zh.json", "extra5-zh.json", "translations.json",
]) {
  try { Object.assign(dict, JSON.parse(readFileSync(join(patchDir, f), "utf8"))); } catch {}
}

const patDefs = [
  ...JSON.parse(readFileSync(join(patchDir, "patterns.json"), "utf8")),
  ...JSON.parse(readFileSync(join(patchDir, "auto-patterns.json"), "utf8")),
];
const patRes = patDefs.map((p) => new RegExp(p.re));

const all = new Set([...Object.keys(zh.label), ...Object.keys(zh.text)]);
const missLabel = [], missText = [], missDyn = [];
for (const s of [...Object.keys(zh.label)].sort()) if (dict[s] === undefined) missLabel.push(s);
for (const s of [...Object.keys(zh.text)].sort()) if (dict[s] === undefined) missText.push(s);
for (const s of [...Object.keys(zh.dyn)].sort()) {
  const sample = s.replace(/\$\{[^}]*\}/g, "X");
  if (!patRes.some((r) => r.test(sample))) missDyn.push(s);
}

const uniq = (arr) => [...new Set(arr)];
writeFileSync(join(patchDir, "uncovered-strings.json"), JSON.stringify({
  label: uniq(missLabel),
  text: uniq(missText),
  dyn: uniq(missDyn),
  blob: Object.keys(zh.blob ?? {}),
}, null, 2));

const total = all.size;
const missing = uniq([...missLabel, ...missText]).length;
console.log(`dict entries  : ${Object.keys(dict).length}`);
console.log(`unique zh     : ${total}`);
console.log(`covered       : ${total - missing}`);
console.log(`missing label : ${uniq(missLabel).length}`);
console.log(`missing text  : ${uniq(missText).length}`);
console.log(`missing (all) : ${missing}`);
console.log(`missing dyn   : ${missDyn.length}`);
console.log(`blob (data)   : ${Object.keys(zh.blob ?? {}).length}`);
