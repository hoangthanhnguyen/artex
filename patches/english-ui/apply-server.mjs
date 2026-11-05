// Apply only reviewed structural compatibility changes, not incomplete translations.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localizeMentions } from "./mentions.mjs";
import { localizeServerLogs } from "./apply-server-logs.mjs";
if (!process.argv[2]) throw new Error("usage: node apply-server.mjs <source-root>");
localizeMentions(process.argv[2], "server");
localizeServerLogs(process.argv[2]);
const mcpPath = join(process.argv[2], "server", "mcpdiscover.go");
let mcpSource = readFileSync(mcpPath, "utf8");
for (const [zh, en] of [
  ["stdio 传输缺少命令", "stdio transport requires a command"],
  ["http 传输缺少 URL", "http transport requires a URL"],
  ["sse 传输缺少 URL", "sse transport requires a URL"],
  ["未知传输方式 %q", "unknown transport %q"],
]) {
  mcpSource = mcpSource.replace(`fmt.Errorf("${zh}"`, `fmt.Errorf("${en}"`);
}
writeFileSync(mcpPath, mcpSource);
const configPath = join(process.argv[2], "config", "config.go");
const configSource = readFileSync(configPath, "utf8");
function replaceLiteral(source, zh, en, file) {
  const before = `"${zh}"`;
  const after = `"${en}"`;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one ${before}, found ${count}`);
  return source.replace(before, after);
}
writeFileSync(configPath, replaceLiteral(configSource, "环境变量 ARTEX_PG_DSN", "environment variable ARTEX_PG_DSN", configPath));
