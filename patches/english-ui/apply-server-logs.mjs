// Translate only the format argument of direct log.* calls; preserve prompts.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL("./", import.meta.url));
const CJK = /[\u4e00-\u9fff]/;

function loadDict() {
  const raw = JSON.parse(readFileSync(join(here, "server-logs.json"), "utf8"));
  const map = new Map();
  for (const [zh, en] of Object.entries(raw)) map.set(zh, en);
  return map;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "web") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".go") && !name.endsWith("_test.go")) out.push(p);
  }
}

function translateFile(file, dict) {
  const src = readFileSync(file, "utf8");
  const n = src.length;
  let out = "";
  let i = 0;
  let hits = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") { const s = i; while (i < n && src[i] !== "\n") i++; out += src.slice(s, i); continue; }
    if (ch === "/" && src[i + 1] === "*") { const s = i; i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; out += src.slice(s, i); continue; }
    if (ch === '"' || ch === "`") {
      const q = ch; const s = i; i++; let buf = "";
      while (i < n && src[i] !== q) { if (q === '"' && src[i] === "\\") { buf += src[i] + (src[i + 1] || ""); i += 2; continue; } buf += src[i]; i++; }
      i++;
      const prefix = src.slice(0, s);
      const isLogFormat = /\blog\.(?:Print|Println|Printf|Fatal|Fatalf|Fatalln|Panic|Panicf|Panicln)\s*\(\s*$/.test(prefix);
      const en = isLogFormat ? dict.get(buf) : undefined;
      if (isLogFormat && CJK.test(buf) && en === undefined) throw new Error(`Untranslated log format in ${file}: ${buf}`);
      if (en !== undefined) { out += q + en + q; hits++; } else out += src.slice(s, i);
      continue;
    }
    out += ch; i++;
  }
  if (hits > 0) writeFileSync(file, out);
  return hits;
}

export function localizeServerLogs(root) {
  const dict = loadDict();
  const files = [];
  walk(root, files);
  let total = 0, changed = 0;
  for (const f of files) {
    const h = translateFile(f, dict);
    if (h > 0) { total += h; changed++; }
  }
  console.log(`[server-logs] replaced ${total} literal(s) across ${changed} file(s)`);
  return { total, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("usage: node apply-server-logs.mjs <source-root>");
  localizeServerLogs(process.argv[2]);
}
