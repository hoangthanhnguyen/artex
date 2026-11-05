import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { localizeMentions } from "./mentions.mjs";

const require = createRequire(import.meta.url);
const ts = require(process.env.ARTEX_TYPESCRIPT || "typescript");
const upstream = process.env.ARTEX_SOURCE;

test("English mention tokens can be selected again; legacy tokens remain recognized", { skip: !upstream }, () => {
  const root = mkdtempSync(join(process.env.TEMP || tmpdir(), "artex-mentions-test-"));
  const file = join(root, "web", "src", "lib", "chat-mentions.ts");
  mkdirSync(join(root, "web", "src", "lib"), { recursive: true });
  writeFileSync(file, readFileSync(join(upstream, "web", "src", "lib", "chat-mentions.ts")));
  localizeMentions(root, "web");
  const first = readFileSync(file, "utf8");
  localizeMentions(root, "web");
  assert.equal(readFileSync(file, "utf8"), first);
  const labels = { "漏洞": "Vulnerability", "资产": "Assets", "企业": "Enterprise", "接口": "API", "应用": "Application", "域名": "Domain", "子域名": "Subdomain", "服务": "Service" };
  let localized = first;
  for (const [zh, en] of Object.entries(labels)) localized = localized.replaceAll(JSON.stringify(zh), JSON.stringify(en));
  const output = ts.transpileModule(localized, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(output, { exports });
  for (const kind of exports.mentionKinds) {
    const token = exports.mentionToken({ kind: kind.kind, id: 12, label: "example", description: "" });
    assert.ok(!/[\u4e00-\u9fff]/.test(token));
    assert.equal(exports.selectedMentions(token).length, 1, token);
    assert.equal(exports.mentionSearch(kind.label).kind, kind.kind);
  }
  assert.equal(exports.selectedMentions("@[漏洞#12 old] @[资产#13 old]").length, 2);
  assert.equal(exports.selectedMentions("user@example.com @[Unknown#12]").length, 0);
});

test("server patterns accept English labels without removing legacy type keys", { skip: !upstream }, () => {
  const root = mkdtempSync(join(process.env.TEMP || tmpdir(), "artex-mentions-test-"));
  const file = join(root, "server", "chat_mentions.go");
  mkdirSync(join(root, "server"), { recursive: true });
  writeFileSync(file, readFileSync(join(upstream, "server", "chat_mentions.go")));
  localizeMentions(root, "server");
  const first = readFileSync(file, "utf8");
  assert.ok(first.includes('"Assets": "asset"'));
  assert.ok(first.includes('"漏洞": "finding"'));
  assert.ok(first.includes('"finding": "Vulnerability"'));
  localizeMentions(root, "server");
  assert.equal(readFileSync(file, "utf8"), first);
});
