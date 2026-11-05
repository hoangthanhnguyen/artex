// Apply the local source patches to the fetched upstream tree.
//
//   node patches/goal-gate/apply.mjs [srcDir]
//
// src/ is gitignored (it is fetched by fetch-source.ps1, see NOTICE.md), so the
// handful of additions ARTEX needs on top of upstream live here instead and are
// copied in. Re-running is safe: files are overwritten and the one-line
// server.go edit is skipped when already present.
//
// What this adds on top of pristine upstream 0.3.15:
//   src/server/goal_gate.go          target-presence gate for task goals
//   src/server/goal_gate_test.go     unit test pinning the gate behaviour
//   src/server/ported_skills_test.go test that the ported skills parse
//   src/server/server.go             one call to goalGateCheck in createTask
//   src/skills/<name>/               the ported skills, so an in-tree run and
//                                    the shipped-skills test see them too
//   src/go.mod, src/go.sum           `replace norma => BaaRai/Norma v0.4.4`
//
// On the norma replacement: upstream pins github.com/Autumn-27/norma v0.4.3,
// which is the agent harness that executes every shell command the agent runs.
// BaaRai/Norma v0.4.4 is that same module with 7 added _test.go files and 13
// production files changed; the change set was read in full before adopting it
// and contains no backdoor:
//   * llm/*, harness/query.go, noaadapter/project.go  Gemini thought_signature
//     round-tripping (the reason the fork needed a newer norma at all)
//   * tool/helpers.go, shell_session.go, task.go      UTF-8 rune-safe truncation
//   * tool/task.go                                    stale-session sweep and
//     always-set non-interactive PAGER/GIT_PAGER/SYSTEMD_PAGER/DEBIAN_FRONTEND
//   * llm/anthropic.go, types.go                      Usage.MergeEcho, so an
//     Anthropic-compatible provider that reports zeros at message_start is no
//     longer metered at 0 input tokens
// go.mod itself is byte-identical between the two, and no upstream file was
// deleted or replaced. See NOTICE.md for the hashes and the comparison table.
//
// Both hash lines below are the ones sum.golang.org serves for this version
// (https://sum.golang.org/lookup/github.com/!baa!rai/!norma@v0.4.4). They are
// pinned here rather than left to `go mod tidy`, because the build stage runs
// `go mod download` from src/go.mod + src/go.sum alone: without the go.sum
// lines the download fails with a missing-checksum error instead of resolving.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const srcDir = process.argv[2] || join(root, 'src');

if (!existsSync(srcDir)) {
  console.error(`source tree not found: ${srcDir}`);
  console.error('run fetch-source.ps1 first, then re-run this script');
  process.exit(1);
}

// 1. drop in the standalone files
const serverDir = join(srcDir, 'server');
mkdirSync(serverDir, { recursive: true });
for (const f of ['goal_gate.go', 'goal_gate_test.go', 'ported_skills_test.go']) {
  copyFileSync(join(here, 'src-server', f), join(serverDir, f));
  console.log(`copied server/${f}`);
}

// 2. wire the gate into createTask, once
const serverGo = join(serverDir, 'server.go');
let body = readFileSync(serverGo, 'utf8');

const anchor = `\tif err := s.validateTaskProfileIDs(req.LLMProfileIDs); err != nil {
\t\twriteErr(w, 400, err.Error())
\t\treturn
\t}
`;
const inserted = anchor + `\tif err := goalGateCheck(req.Goal); err != nil {
\t\twriteErr(w, 400, err.Error())
\t\treturn
\t}
`;

if (body.includes('goalGateCheck(req.Goal)')) {
  console.log('server.go already patched (goalGateCheck call present), leaving as is');
} else if (!body.includes(anchor)) {
  console.error('server.go anchor for the gate call was not found; upstream shape changed?');
  process.exit(1);
} else {
  body = body.replace(anchor, inserted);
  writeFileSync(serverGo, body);
  console.log('patched server/server.go (inserted goalGateCheck call)');
}

// 2b. verify the gate really landed inside createTask, not just somewhere in the
// file. A silent mis-placement is worse than a loud failure for a security gate,
// so this checks position explicitly and aborts when the shape is unexpected.
if (!body.includes('goalGateCheck(req.Goal)')) {
  console.error('verification failed: no goalGateCheck call in server.go');
  process.exit(1);
}
{
  const lines = body.split('\n');
  const callIdx = lines.findIndex((l) => l.includes('goalGateCheck(req.Goal)') && !l.includes('func '));
  // find the createTask function opening before the call
  let fnIdx = -1;
  for (let i = callIdx; i >= 0; i--) {
    if (lines[i].includes('func (s *Server) createTask(')) { fnIdx = i; break; }
  }
  if (fnIdx === -1 || callIdx < fnIdx) {
    console.error('verification failed: goalGateCheck is not inside createTask');
    process.exit(1);
  }
  // make sure no other function definition sits between createTask and the call
  let ok = true;
  for (let i = fnIdx + 1; i < callIdx; i++) {
    if (/^func /.test(lines[i])) { ok = false; break; }
  }
  if (!ok) {
    console.error('verification failed: goalGateCheck is outside the createTask body');
    process.exit(1);
  }
  console.log(`verified: goalGateCheck at server.go:${callIdx + 1}, inside createTask (starts line ${fnIdx + 1})`);
}

// 3. swap the harness for the fork's norma, pinned. Upstream requires
//    Autumn-27/norma v0.4.3 and the replace directive points the module at its
//    superset. Both the go.mod directive and the go.sum hashes are written here
//    so the tree is buildable straight from a bare `go mod download`.
const NORMA_REQ = 'github.com/Autumn-27/norma v0.4.3';
const NORMA_REPLACE = 'replace github.com/Autumn-27/norma => github.com/BaaRai/Norma v0.4.4';
const NORMA_H1 = 'github.com/BaaRai/Norma v0.4.4 h1:x5UAeaTuhREI1GiIYuwIEybRxr/pLCeCUvXmUbwv5Is=';
const NORMA_GOMOD_H1 = 'github.com/BaaRai/Norma v0.4.4/go.mod h1:BudWrf7iHl96FgHqFr/HwN3mKYmGjJDt+xL2ZHXfFZw=';
{
  const goMod = join(srcDir, 'go.mod');
  const goSum = join(srcDir, 'go.sum');
  let mod = readFileSync(goMod, 'utf8');

  if (!mod.includes(NORMA_REQ)) {
    console.error(`go.mod does not require ${NORMA_REQ}; upstream dependency shape changed?`);
    process.exit(1);
  }
  if (mod.includes(NORMA_REPLACE)) {
    console.log('go.mod already carries the norma replace, leaving as is');
  } else {
    // Appended as its own block: a replace directive is legal anywhere at top
    // level, and appending keeps us out of the require () block whose exact
    // spelling upstream is free to change.
    if (!mod.endsWith('\n')) mod += '\n';
    mod += `\n${NORMA_REPLACE}\n`;
    writeFileSync(goMod, mod);
    console.log('patched go.mod (replace norma => BaaRai/Norma v0.4.4)');
  }

  let sum = readFileSync(goSum, 'utf8');
  let added = 0;
  for (const line of [NORMA_H1, NORMA_GOMOD_H1]) {
    if (sum.includes(line)) continue;
    if (!sum.endsWith('\n')) sum += '\n';
    sum += `${line}\n`;
    added++;
  }
  if (added > 0) {
    writeFileSync(goSum, sum);
    console.log(`patched go.sum (added ${added} BaaRai/Norma hash line${added === 1 ? '' : 's'})`);
  } else {
    console.log('go.sum already carries the BaaRai/Norma hashes, leaving as is');
  }

  // The replace must be the only one for this module path, and the hashes must
  // still be present after the edits: a silently dropped line would surface much
  // later as a confusing `missing go.sum entry` during the image build.
  mod = readFileSync(goMod, 'utf8');
  sum = readFileSync(goSum, 'utf8');
  const replaces = mod.split('\n').filter((l) => l.startsWith('replace github.com/Autumn-27/norma'));
  if (replaces.length !== 1 || replaces[0] !== NORMA_REPLACE) {
    console.error('verification failed: expected exactly one norma replace directive in go.mod');
    process.exit(1);
  }
  if (!sum.includes(NORMA_H1) || !sum.includes(NORMA_GOMOD_H1)) {
    console.error('verification failed: BaaRai/Norma hashes missing from go.sum');
    process.exit(1);
  }
  console.log('verified: norma => BaaRai/Norma v0.4.4, both go.sum hashes present');
}

// 4. mirror the ported skills into src/skills so an in-tree run (and the
//    shipped-skills test) sees the same set the runtime bind mount provides.
const repoSkls = join(root, 'skills');
const srcSkls = join(srcDir, 'skills');
if (existsSync(repoSkls)) {
  mkdirSync(srcSkls, { recursive: true });
  let n = 0;
  for (const e of readdirSync(repoSkls, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    cpSync(join(repoSkls, e.name), join(srcSkls, e.name), { recursive: true, force: true });
    n++;
  }
  console.log(`mirrored ${n} skills into src/skills`);
}

console.log('goal-gate patch applied');
