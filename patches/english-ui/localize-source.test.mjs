// Run with ARTEX_TYPESCRIPT pointing to the frontend's installed TypeScript.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const translator = fileURLToPath(new URL("./localize-source.mjs", import.meta.url));
function fixture(text) {
  const root = mkdtempSync(join(process.env.TEMP || tmpdir(), "artex-i18n-test-"));
  mkdirSync(join(root, "web", "src"), { recursive: true });
  writeFileSync(join(root, "web", "package.json"), "{}");
  const file = join(root, "web", "src", "sample.tsx");
  writeFileSync(file, text);
  return { root, file };
}
function run(root, ...flags) {
  return spawnSync(process.execPath, [translator, root, ...flags], { encoding: "utf8", env: process.env });
}

test("translates literals, preserves expressions and escaped JSX attributes, and is idempotent", () => {
  const input = 'const name = "x"; const x = `选择对话「${name}」`; const y = "删除"; const z = <input placeholder="搜索" />; // 删除\nconst r = /删除/;';
  const { root, file } = fixture(input);
  const first = run(root);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const output = readFileSync(file, "utf8");
  assert.ok(output.includes("${name}"));
  assert.ok(output.includes("// 删除"));
  assert.ok(output.includes("/删除/"));
  assert.ok(!output.includes('"删除"'));
  assert.equal(run(root, "--check").status, 0);
  assert.equal(readFileSync(file, "utf8"), output);
});

test("untranslated literals fail without partially rewriting source", () => {
  const input = 'const a = "删除"; const b = "这个翻译不存在测试";';
  const { root, file } = fixture(input);
  assert.notEqual(run(root).status, 0);
  assert.equal(readFileSync(file, "utf8"), input);
});

test("report mode never writes and nested template string literals are translated", () => {
  const { root, file } = fixture('const name = "x"; const x = `删除${name ? "删除" : "搜索"}`;');
  const input = readFileSync(file, "utf8");
  assert.equal(run(root, "--report").status, 0);
  assert.equal(readFileSync(file, "utf8"), input);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.ok(!/[\u4e00-\u9fff]/.test(readFileSync(file, "utf8")));
});

test("comparison literals stay verbatim while display literals translate", () => {
  const input = 'const msg = "x"; const hit = msg.includes("删除"); const eq = msg === "删除"; const label = "删除";';
  const { root, file } = fixture(input);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = readFileSync(file, "utf8");
  assert.ok(output.includes('msg.includes("删除")'), output);
  assert.ok(output.includes('msg === "删除"'), output);
  assert.ok(!output.includes('const label = "删除"'), output);
  assert.equal(run(root, "--check").status, 0);
});
