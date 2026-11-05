// Keep English chat-reference tokens compatible with existing Chinese history.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const legacy = "漏洞|资产|企业|接口|IP|应用|域名|子域名|服务";
const english = "Vulnerability|Asset|Assets|Enterprise|API|Application|Domain|Subdomain|Service";
const pairs = [
  ["Vulnerability", "finding"], ["Asset", "asset"], ["Assets", "asset"],
  ["Enterprise", "company"], ["API", "endpoint"], ["Application", "app"],
  ["Domain", "root_domain"], ["Subdomain", "subdomain"], ["Service", "service"],
];

function replaceOnce(source, before, after, name) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error(`Unexpected chat-reference source shape: ${name}`);
  return source.replace(before, after);
}

export function localizeMentions(root, side) {
  const path = side === "web" ? join(root, "web", "src", "lib", "chat-mentions.ts") : join(root, "server", "chat_mentions.go");
  if (!existsSync(path)) throw new Error(`Chat-reference source not found: ${path}`);
  const before = readFileSync(path, "utf8");
  let after = replaceOnce(before, `(${legacy})#`, `(${legacy}|${english})#`, `${side} pattern`);
  if (side === "server") {
    const anchor = 'var chatMentionKinds = map[string]string{';
    const entries = pairs.map(([label, kind]) => `\t${JSON.stringify(label)}: ${JSON.stringify(kind)},`).join("\n");
    after = replaceOnce(after, anchor, `${anchor}\n${entries}`, "server type map");
    const display = `map[string]string{${pairs.filter(([label]) => label !== "Assets").map(([label, kind]) => `${JSON.stringify(kind)}: ${JSON.stringify(label)}`).join(", ")}, "ip": "IP"}`;
    // The trusted kind determines the display label; arbitrary token text does not.
    after = replaceOnce(after, "chatMentionRef{kind, id, m[1]}", `chatMentionRef{kind, id, ${display}[kind]}`, "server display label");
  }
  if (after !== before) writeFileSync(path, after);
}
