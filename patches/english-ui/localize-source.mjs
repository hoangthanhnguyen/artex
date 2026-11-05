// Localize parsed TypeScript/TSX literals, never comments or regular expressions.
// Uses the TypeScript already installed by the frontend's locked npm build.
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] || ".");
const check = process.argv.includes("--check");
const reportOnly = process.argv.includes("--report");
const require = createRequire(join(root, "web", "package.json"));
const ts = require(process.env.ARTEX_TYPESCRIPT || "typescript");
const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const decode = (s) => s.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"');
const normalize = (s) => s.replace(/\s+/g, " ").trim();
const map = new Map();
for (const file of ["locale-zh", "extra-zh", "extra2-zh", "extra3-zh", "extra4-zh", "extra5-zh", "translations", "reviewed-zh"]) {
  let entries;
  try { entries = JSON.parse(readFileSync(join(here, `${file}.json`), "utf8")); }
  catch (e) { if (file === "reviewed-zh" && e.code === "ENOENT") continue; throw e; }
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== "string") throw new Error(`Invalid translation in ${file}`);
    map.set(key, value);
    map.set(decode(key), decode(value));
    map.set(normalize(decode(key)), normalize(decode(value)));
  }
}

function lookup(text) {
  const exact = map.get(text);
  if (exact !== undefined && !han.test(exact)) return exact;
  const hit = [map.get(text.trim()), map.get(normalize(text))].find((value) => value !== undefined && !han.test(value));
  if (hit === undefined) return undefined;
  const start = text.indexOf(text.trim());
  return text.slice(0, start) + hit.trim() + text.slice(start + text.trim().length);
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["i18n", "mock", "node_modules", ".next"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
}

const missing = new Map();
const writes = [];
let replacements = 0;
let changedFiles = 0;
function note(text, file, node, source) {
  if (!han.test(text)) return;
  const key = normalize(text);
  const uses = missing.get(key) || [];
  uses.push({ file: relative(root, file).replaceAll("\\", "/"), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, kind: ts.SyntaxKind[node.kind] });
  missing.set(key, uses);
}

for (const file of files(join(root, "web", "src"))) {
  const before = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${file}`);
  const edits = [];
  function isComparisonLiteral(node) {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.arguments.includes(node)) {
      return ["includes", "startsWith", "endsWith", "indexOf"].includes(parent.expression.name.text);
    }
    if (ts.isBinaryExpression(parent) && (parent.left === node || parent.right === node)) {
      return [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(parent.operatorToken.kind);
    }
    return ts.isCaseClause(parent) && parent.expression === node;
  }
  function replace(node, text, kind) {
    if (!han.test(text) || isComparisonLiteral(node)) return;
    const english = lookup(text);
    if (english === undefined) { note(text, file, node, source); return; }
    let replacement;
    if (kind === "jsx") replacement = english.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("{", "&#123;").replaceAll("}", "&#125;");
    else if (kind === "template") replacement = "`" + english.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${") + "`";
    else if (node.parent && ts.isJsxAttribute(node.parent)) replacement = '"' + english.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + '"';
    else replacement = JSON.stringify(english);
    edits.push({ start: node.getStart(source), end: node.end, text: replacement });
  }
  function visit(node) {
    if (ts.isTemplateExpression(node)) {
      const original = before.slice(node.getStart(source) + 1, node.end - 1);
      const translated = map.get(original) ?? map.get(decode(original));
      if (translated !== undefined && !han.test(translated)) {
        // Parse the replacement and require every embedded expression unchanged.
        const candidate = ts.createSourceFile("template.ts", "const x = `" + translated + "`;", ts.ScriptTarget.Latest, true);
        const next = candidate.statements[0]?.declarationList?.declarations[0]?.initializer;
        if (!candidate.parseDiagnostics.length && next && ts.isTemplateExpression(next) && next.templateSpans.length === node.templateSpans.length && node.templateSpans.every((span, i) => span.expression.getText(source) === next.templateSpans[i].expression.getText(candidate))) {
          // Edit only literal segments. Nested expressions get independent edits;
          // a parent replacement must never discard a nested translation.
          const originalParts = [node.head, ...node.templateSpans.map((span) => span.literal)];
          const translatedParts = [next.head, ...next.templateSpans.map((span) => span.literal)];
          originalParts.forEach((part, i) => {
            edits.push({ start: part.getStart(source) + 1, end: part.end - (part.kind === ts.SyntaxKind.TemplateTail ? 1 : 2), text: escapeTemplate(translatedParts[i].text) });
          });
          for (const span of node.templateSpans) visit(span.expression);
          return;
        }
      }
      const parts = [node.head, ...node.templateSpans.map((span) => span.literal)];
      for (const part of parts) {
        const english = lookup(part.text);
        if (han.test(part.text) && english === undefined) note(part.text, file, part, source);
        if (english !== undefined) {
          const start = part.getStart(source) + 1;
          const end = part.end - (part.kind === ts.SyntaxKind.TemplateTail ? 1 : 2);
          edits.push({ start, end, text: escapeTemplate(english) });
        }
      }
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isStringLiteral(node)) replace(node, node.text, "string");
    else if (ts.isNoSubstitutionTemplateLiteral(node)) replace(node, node.text, "template");
    else if (ts.isJsxText(node)) replace(node, node.text, "jsx");
    ts.forEachChild(node, visit);
  }
  visit(source);
  const ordered = edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end) throw new Error(`Overlapping translations in ${file}`);
  }
  let after = before;
  for (const edit of ordered.reverse()) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
  const parsed = ts.createSourceFile(file, after, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length) {
    const diagnostic = parsed.parseDiagnostics[0];
    const pos = parsed.getLineAndCharacterOfPosition(diagnostic.start);
    throw new Error(`Translation broke syntax in ${file}:${pos.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  if (after !== before) {
    changedFiles++;
    replacements += ordered.length;
    writes.push({ file, after });
  }
}
const entries = [...missing].map(([text, uses]) => ({ text, uses }));
console.log(JSON.stringify({ filesChanged: changedFiles, replacements, untranslated: entries.length }));
if (reportOnly) console.log(JSON.stringify(entries, null, 2));
if (!check && !reportOnly && !entries.length) for (const { file, after } of writes) writeFileSync(file, after);
if ((!reportOnly && entries.length) || (check && changedFiles)) process.exitCode = 1;

function escapeTemplate(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}
