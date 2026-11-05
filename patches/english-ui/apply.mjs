// Applies the English UI overlay to a fetched ARTEX source tree.
//
//   node patches/english-ui/apply.mjs <dir containing web/>
//
// Idempotent: running it twice does not double-wrap or duplicate imports.
// Fails loudly when the layout file no longer matches the expected shape, so a
// future upstream refactor cannot silently ship a half-patched build.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeMentions } from "./mentions.mjs";

const root = process.argv[2];
if (!root) {
  console.error("usage: node apply.mjs <source-root>");
  process.exit(1);
}

const web = join(root, "web");
const layoutPath = join(web, "src", "app", "layout.tsx");
const i18nDir = join(web, "src", "lib", "i18n");

localizeMentions(root, "web");

mkdirSync(i18nDir, { recursive: true });

for (const file of [
  "EnglishOverlay.tsx",
  "locale-zh.json",
  "extra-zh.json",
  "extra2-zh.json",
  "extra3-zh.json",
  "extra4-zh.json",
  "extra5-zh.json",
  "reviewed-zh.json",
  "patterns.json",
  "auto-patterns.json",
]) {
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), file), join(i18nDir, file));
}

let layout = readFileSync(layoutPath, "utf8");

if (!layout.includes("EnglishOverlay")) {
  const importAnchor = 'import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";';
  if (!layout.includes(importAnchor)) {
    console.error(`anchor import not found in ${layoutPath}`);
    process.exit(1);
  }
  layout = layout.replace(
    importAnchor,
    `${importAnchor}\nimport { EnglishOverlay } from "@/lib/i18n/EnglishOverlay";`,
  );

  const childrenAnchor = "            {children}";
  if (!layout.includes(childrenAnchor)) {
    console.error(`children anchor not found in ${layoutPath}`);
    process.exit(1);
  }
  layout = layout.replace(
    childrenAnchor,
    "            <EnglishOverlay>{children}</EnglishOverlay>",
  );

  writeFileSync(layoutPath, layout);
}

console.log("english-ui overlay applied");
