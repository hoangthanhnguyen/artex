// Translates the Chinese UI strings in the ARTEX web source to English using an
// OpenAI-compatible chat completions endpoint.
//
//   TRANS_API_URL=https://api.deepseek.com/v1 TRANS_API_KEY=... TRANS_API_MODEL=deepseek-chat node translate-api.mjs <source-root>
//
// The key is read from the environment only: it is never written to disk, never
// logged and never committed. Output goes to translations.json next to this
// file and the run is resumable - strings already present are skipped, so a
// failed batch can be retried without re-spending tokens.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.TRANS_API_URL;
const KEY = process.env.TRANS_API_KEY;
const MODEL = process.env.TRANS_API_MODEL;
if (!BASE || !KEY || !MODEL) {
  console.error("set TRANS_API_URL, TRANS_API_KEY and TRANS_API_MODEL");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "translations.json");

const root = process.argv[2];
if (!root) { console.error("usage: node translate-api.mjs <source-root>"); process.exit(1); }

const web = join(root, "web", "src");
const i18n = join(web, "lib", "i18n");
const CJK = /[\u4e00-\u9fff]/;

console.log(`endpoint: ${BASE}`);
console.log(`model:    ${MODEL}`);
console.log(`key:      ${KEY.length} chars (not shown)`);

// Collect every distinct Chinese string the overlay does not already cover, so
// only the gaps are sent to the model (cheaper and it cannot regress existing
// translations). Comments and mock data are skipped, as they never render.
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "vendor" || n === "node_modules" || n === ".next") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}

// Backend-rendered strings (progress messages, API errors, notification text)
// never appear in the web source, so the overlay cannot learn them from there.
// Scan Go sources too; tests never render, so they are skipped.
function walkGo(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "vendor" || n === "node_modules" || n === ".next") continue;
    const st = statSync(p);
    if (st.isDirectory()) walkGo(p, out);
    else if (n.endsWith(".go") && !n.endsWith("_test.go")) out.push(p);
  }
  return out;
}

// Candidates that are really code the regex crossed a quote to capture: they
// carry ASCII backticks, inline interpolation, arrows or statement keywords.
const looksLikeCode = (s) =>
  /[`$]|=>|===|\breturn\b|\bconst\b|\bfunction\b|toast\.|push\(|;\s*$/.test(s);

function collect() {
  const MAP = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const found = new Map();
  const consider = (raw) => {
    const lit = raw.trim();
    if (!lit || !CJK.test(lit) || lit.includes("\n")) return;
    if (looksLikeCode(lit)) return;
    if (MAP[lit] !== undefined) return;
    found.set(lit, 1);
  };
  for (const file of walk(web)) {
    if (file.startsWith(i18n)) continue;
    const rel = file.slice(web.length + 1).replace(/\\/g, "/");
    if (rel.startsWith("lib/mock/")) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g)) consider(m[2]);
    // Also catch a JSX text node that sits right before a {expression}: the
    // earlier < only pattern skipped those (for example "Unused Skill").
    for (const m of src.matchAll(/>([^<>{}]*?[\u4e00-\u9fff][^<>{}]*?)(?=<|\{)/g)) consider(m[1]);
  }
  // Go sources: only "..." and `...` literals (rune literals hold a single
  // character and are never labels), comments stripped first.
  for (const file of walkGo(root)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/"((?:\\.|[^"\\\n])*)"|`([^`]*)`/g)) consider(m[1] ?? m[2]);
  }
  return { MAP, keys: [...found.keys()] };
}

const SYSTEM = [
  "You translate user-interface strings for ARTEX, a Chinese penetration-testing console, into idiomatic English.",
  "Rules:",
  "- Keep every ${...} expression, function call, operator and identifier byte-for-byte identical.",
  "- Keep {{...}} template placeholders and HTML entities as they are.",
  "- Keep the leading/trailing spaces and the trailing colon of error prefixes (for example 保存失败：).",
  "- Keep technology names (LLM, MCP, Skill, Worker, Agent, Planner, CIDR, ICP, TLS, SSE, nmap, sqlmap) unchanged.",
  "- Translate \\n escapes as literal two-character sequences, not real newlines.",
  "- Where a fragment is only punctuation left over from a sentence split by JSX, translate it to the matching English punctuation or leave it unchanged.",
  "- Reply with a single JSON object mapping each input string to its English translation, and nothing else.",
].join("\n");

async function translateBatch(items) {
  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(items, null, 1) },
    ],
  };
  const res = await fetch(`${BASE.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  for (const it of items) {
    if (typeof parsed[it] !== "string" || !parsed[it]) {
      throw new Error(`model did not translate ${JSON.stringify(it).slice(0, 80)}`);
    }
  }
  return parsed;
}

// Split the pending strings into batches so each request stays small enough to
// be answered reliably, and so a single bad batch does not lose the whole run.
const BATCH = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { MAP, keys } = collect();
console.log(`strings to translate: ${keys.length}`);
if (process.env.TRANS_DRY) {
  console.log("dry run: no requests sent");
  process.exit(0);
}

const merged = { ...MAP };
for (let i = 0; i < keys.length; i += BATCH) {
  const slice = keys.slice(i, i + BATCH);
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const out = await translateBatch(slice);
      Object.assign(merged, out);
      writeFileSync(OUT, JSON.stringify(merged, null, 1) + "\n", "utf8");
      done = true;
      console.log(`batch ${i / BATCH + 1}: ok (${Object.keys(merged).length} total)`);
    } catch (e) {
      console.error(`batch ${i / BATCH + 1} attempt ${attempt}: ${e.message}`);
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  if (!done) console.error(`batch ${i / BATCH + 1}: FAILED, left for a second run`);
}

console.log(`\ndone. translations.json holds ${Object.keys(merged).length} entries`);
// end of translator

