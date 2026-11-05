// Split uncovered UI strings into real-UI vs demo/mock data, by source file.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [zhPath, uncPath, patchDir] = process.argv.slice(2);
const zh = JSON.parse(readFileSync(zhPath, "utf8"));
const unc = JSON.parse(readFileSync(uncPath, "utf8"));

const filesOf = (s) => [...(zh.label[s] ?? zh.text[s] ?? [])];
const isMock = (s) => {
  const f = filesOf(s);
  return f.length > 0 && f.every((p) => p.startsWith("lib/mock/") || p.startsWith("lib\\mock\\"));
};

const split = (arr) => {
  const ui = [], mock = [];
  for (const s of arr) (isMock(s) ? mock : ui).push(s);
  return { ui, mock };
};

const all = [...unc.label, ...unc.text];
const { ui, mock } = split(all);
const report = {};
for (const s of all) report[s] = filesOf(s);
writeFileSync(join(patchDir, "missing-sources.json"), JSON.stringify(report, null, 2));
writeFileSync(join(patchDir, "missing-ui.json"), JSON.stringify(ui, null, 2));
writeFileSync(join(patchDir, "missing-mock.json"), JSON.stringify(mock, null, 2));
console.log(`missing total=${all.length} real-ui=${ui.length} mock-only=${mock.length}`);
