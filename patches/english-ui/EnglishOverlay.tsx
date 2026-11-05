"use client";

// Translates the ARTEX UI to English at runtime.
//
// Build-time source localization handles application UI literals. This overlay
// is a fallback for known dynamic server messages rendered by the UI.
//
// Consequences worth knowing:
//   * strings missing from the dictionary stay Chinese; extend the JSON to fix
//   * React re-renders write the original Chinese back, so a MutationObserver
//     re-applies the translation
//   * anything under [data-no-i18n] is skipped, as are SCRIPT/STYLE/CODE/PRE
//     and form inputs' values

import { useEffect } from "react";

import dict from "./locale-zh.json";
import extra from "./extra-zh.json";
import extra2 from "./extra2-zh.json";
import extra3 from "./extra3-zh.json";
import extra4 from "./extra4-zh.json";
import extra5 from "./extra5-zh.json";
import reviewed from "./reviewed-zh.json";
import patterns from "./patterns.json";
import autoPatterns from "./auto-patterns.json";

const MAP: Record<string, string> = {
  ...(dict as Record<string, string>),
  ...(extra as Record<string, string>),
  ...(extra2 as Record<string, string>),
  ...(extra3 as Record<string, string>),
  ...(extra4 as Record<string, string>),
  ...(extra5 as Record<string, string>),
  ...(reviewed as Record<string, string>),
};
const PATTERNS = [
  ...(patterns as { re: string; en: string }[]),
  ...(autoPatterns as { re: string; en: string }[]),
].map((p) => ({
  re: new RegExp(p.re),
  en: p.en,
}));

// Tags whose TEXT content must not be touched: code/pre keep literal payloads,
// textarea/input hold user-typed values. Their attributes (placeholder, title,
// aria-label) still need translating, so attribute handling uses a narrower list.
const TEXT_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);
const ATTR_SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const HAS_CJK = /[\u4e00-\u9fff]/;

export function translateString(input: string): string {
  if (!HAS_CJK.test(input)) return input;

  // Multi-line placeholders (asset scopes, payload examples) are one attribute
  // value with newlines; translate line by line so each example still matches.
  const whole = MAP[input];
  if (whole !== undefined) return whole;

  if (input.includes("\n")) return input.split("\n").map(translateLine).join("\n");

  return translateLine(input);
}

function translateLine(input: string): string {
  if (!HAS_CJK.test(input)) return input;

  const exact = MAP[input];
  if (exact !== undefined) return exact;

  const trimmed = input.trim();
  if (!trimmed) return input;

  const hit = MAP[trimmed];
  if (hit !== undefined) {
    const start = input.indexOf(trimmed);
    return `${input.slice(0, start)}${hit}${input.slice(start + trimmed.length)}`;
  }

  // Dynamic strings (page counts, version banners) cannot be exact-keyed.
  for (const { re, en } of PATTERNS) {
    if (re.test(trimmed)) return trimmed.replace(re, en);
  }

  return input;
}

function textSkipped(el: Element | null): boolean {
  if (!el) return true;
  if (TEXT_SKIP_TAGS.has(el.tagName)) return true;
  return el.closest("[data-no-i18n], script, style, code, pre, textarea, [contenteditable]:not([contenteditable='false'])") !== null;
}

function attrSkipped(el: Element): boolean {
  if (ATTR_SKIP_TAGS.has(el.tagName)) return true;
  return el.closest("[data-no-i18n]") !== null;
}

function translateTextNodes(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (textSkipped(parent)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue;
      if (!value || !HAS_CJK.test(value)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const batch: Text[] = [];
  while (walker.nextNode()) batch.push(walker.currentNode as Text);

  for (const node of batch) {
    const current = node.nodeValue ?? "";
    const next = translateString(current);
    if (next !== current) node.nodeValue = next;
  }
}

function translateAttributes(root: ParentNode): void {
  const elements: Element[] = [];

  if (root instanceof Element) elements.push(root);
  if ("querySelectorAll" in root) {
    for (const el of (root as ParentNode).querySelectorAll("*")) elements.push(el);
  }

  for (const el of elements) {
    if (attrSkipped(el)) continue;
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const next = translateString(value);
      if (next !== value) el.setAttribute(attr, next);
    }
  }
}

function translateSubtree(root: Node): void {
  translateTextNodes(root);
  translateAttributes(root as ParentNode);
}

export function EnglishOverlay({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    translateSubtree(document.body);

    // The browser tab title is outside body, so translate it separately and keep
    // it in sync when Next.js swaps it on navigation.
    const applyTitle = () => {
      const next = translateString(document.title);
      if (next !== document.title) document.title = next;
    };
    applyTitle();
    const headObserver = new MutationObserver(applyTitle);
    headObserver.observe(document.head, { subtree: true, childList: true, characterData: true });

    let scheduled = false;
    const pending = new Set<Node>();

    const flush = () => {
      scheduled = false;
      const roots = Array.from(pending);
      pending.clear();
      for (const root of roots) {
        if (!root.isConnected) continue;
        // React often rewrites a single text node in place. A TreeWalker rooted at
        // that node never yields the node itself, so handle it directly.
        if (root.nodeType === Node.TEXT_NODE) {
          if (textSkipped(root.parentElement)) continue;
          const text = root.nodeValue ?? "";
          const next = translateString(text);
          if (next !== text) root.nodeValue = next;
        } else {
          translateSubtree(root);
        }
      }
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof idle === "function") {
        idle(flush, { timeout: 200 });
      } else {
        window.setTimeout(flush, 1);
      }
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" || record.type === "attributes") {
          if (record.target.isConnected) pending.add(record.target);
        } else {
          for (const node of record.addedNodes) {
            if (node.isConnected) pending.add(node);
          }
        }
      }
      if (pending.size > 0) schedule();
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });

    return () => {
      headObserver.disconnect();
      observer.disconnect();
    };
  }, []);

  return <>{children}</>;
}

export default EnglishOverlay;
