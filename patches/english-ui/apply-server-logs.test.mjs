import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { localizeServerLogs } from "./apply-server-logs.mjs";

const dict = JSON.parse(readFileSync(new URL("./server-logs.json", import.meta.url), "utf8"));
const verbs = text => text.match(/%(?:\[[0-9]+\])?[-+# 0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[a-zA-Z%]/g) || [];

test("log translations preserve format arguments and contain no Han text", () => {
  for (const [zh, en] of Object.entries(dict)) {
    assert.equal(typeof en, "string", zh);
    assert.ok(!/[\u4e00-\u9fff]/.test(en), zh);
    assert.deepEqual(verbs(en), verbs(zh), zh);
  }
});

test("only log format literals change; prompts, comments and tests remain intact", () => {
  const root = mkdtempSync(join(tmpdir(), "artex-log-test-"));
  try {
    const [zh, en] = Object.entries(dict).find(([key]) => !key.includes('"') && !key.includes("\\"));
    const source = `package sample\n// ${zh}\nvar prompt = "${zh}"\nfunc emit() { log.Printf(\n "${zh}", value) }\n`;
    const file = join(root, "sample.go");
    const testFile = join(root, "sample_test.go");
    writeFileSync(file, source);
    writeFileSync(testFile, source);
    assert.equal(localizeServerLogs(root).total, 1);
    const output = readFileSync(file, "utf8");
    assert.ok(output.includes(`var prompt = "${zh}"`));
    assert.ok(output.includes(`// ${zh}`));
    assert.ok(output.includes(`"${en}", value`));
    assert.equal(readFileSync(testFile, "utf8"), source);
    assert.equal(localizeServerLogs(root).total, 0);
    writeFileSync(file, 'package sample\nfunc emit() { log.Printf("未翻译的新日志") }');
    assert.throws(() => localizeServerLogs(root), /Untranslated log/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
