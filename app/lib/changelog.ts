// Pure parse helpers for CHANGELOG.md (Keep-a-Changelog 1.1.0 format).
// Mirrors release-notes-core.ts: side-effect-free so the unit suite can
// exercise all logic against inline fixtures without touching the filesystem.
// readChangelog() is the only I/O-bearing export.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string }
  | { type: "code"; value: string };

export interface ChangelogItem {
  tokens: InlineToken[];
  raw: string;
}

export interface ChangelogSection {
  heading: string;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

// ## [version] - YYYY-MM-DD  or  ## [Unreleased]
const RELEASE_RE = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;
// ### Added / Changed / Fixed / Security
const SECTION_RE = /^### (.+)/;
// - bullet item
const ITEM_RE = /^- (.+)/;
// --- horizontal rule or [ref]: url marks end of release content
const FOOTER_RE = /^---\s*$|^\[.+\]:\s*https?:\/\//;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let currentRelease: ChangelogRelease | null = null;
  let currentSection: ChangelogSection | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();

    if (FOOTER_RE.test(line)) break;

    const releaseMatch = RELEASE_RE.exec(line);
    if (releaseMatch) {
      currentSection = null;
      currentRelease = {
        version: releaseMatch[1],
        date: releaseMatch[2] ?? null,
        sections: [],
      };
      releases.push(currentRelease);
      continue;
    }

    if (!currentRelease) continue;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      currentSection = { heading: sectionMatch[1], items: [] };
      currentRelease.sections.push(currentSection);
      continue;
    }

    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch && currentSection) {
      const raw = itemMatch[1];
      currentSection.items.push({ tokens: parseInline(raw), raw });
    }
  }

  return releases;
}

// Tokenize a bullet line's text into text / link / code tokens so the
// page component can render [Issue #N](url) as real anchors and `foo` as <code>.
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const INLINE_RE = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let pos = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > pos) {
      tokens.push({ type: "text", value: text.slice(pos, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: "link", label: match[1], href: match[2] });
    } else {
      tokens.push({ type: "code", value: match[3] });
    }
    pos = match.index + match[0].length;
  }

  if (pos < text.length) {
    tokens.push({ type: "text", value: text.slice(pos) });
  }

  return tokens;
}

// Resolve CHANGELOG.md across environments:
//   1. process.cwd()/CHANGELOG.md  — standalone runner  (cwd /app)
//   2. process.cwd()/../CHANGELOG.md — next dev          (cwd app/)
// Returns [] rather than throwing if the file is missing in either location.
export function readChangelog(): ChangelogRelease[] {
  const candidates = [
    join(process.cwd(), "CHANGELOG.md"),
    join(process.cwd(), "..", "CHANGELOG.md"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return parseChangelog(readFileSync(p, "utf8"));
    }
  }
  return [];
}
