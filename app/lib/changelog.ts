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

// How a release affects the database, and therefore how it can be rolled back.
// drizzle-kit generates no down migrations, so reverting a schema change means
// restoring the pre-upgrade dump rather than re-pinning the previous image —
// which is why each release declares its impact and the gate enforces it
// (Issue #277). See docs/releases.md.
//
//   none                — no migration in this release
//   backward-compatible — the previous app version runs fine against the new
//                         schema; a pure image rollback is sufficient
//   breaking            — rolling back requires restoring a pre-upgrade dump
export type MigrationKind = "none" | "backward-compatible" | "breaking";

export const MIGRATION_KINDS = ["none", "backward-compatible", "breaking"] as const;

export function isMigrationKind(value: string): value is MigrationKind {
  return (MIGRATION_KINDS as readonly string[]).includes(value);
}

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
  // Recognized marker value, or null when absent *or* unrecognized. Never
  // coerced — an unknown value does not become a MigrationKind.
  migration: MigrationKind | null;
  // Raw text after "**Migration:**"; null when the release carries no marker
  // line at all. The pair is what lets the gate tell "missing" (migrationRaw
  // === null) from "malformed" (migrationRaw set, migration null) — one
  // nullable field cannot express both, and the malformed message has to be
  // able to quote what it rejected.
  migrationRaw: string | null;
}

// ## [version] - YYYY-MM-DD  or  ## [Unreleased]
const RELEASE_RE = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/;
// ### Added / Changed / Fixed / Security
const SECTION_RE = /^### (.+)/;
// - bullet item
const ITEM_RE = /^- (.+)/;
// **Migration:** none | backward-compatible | breaking  (Issue #277).
// Matched exactly and case-sensitively: "Breaking" is a malformed value, not a
// synonym, so a typo fails the gate rather than silently meaning something.
const MIGRATION_RE = /^\*\*Migration:\*\*\s*(.*?)\s*$/;
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
        migration: null,
        migrationRaw: null,
      };
      releases.push(currentRelease);
      continue;
    }

    if (!currentRelease) continue;

    // The marker belongs between the release heading and its first ### section,
    // so it is only read while currentSection is null. First one wins: a stray
    // second line cannot quietly override a valid declaration.
    if (currentSection === null && currentRelease.migrationRaw === null) {
      const migrationMatch = MIGRATION_RE.exec(line);
      if (migrationMatch) {
        const value = migrationMatch[1];
        currentRelease.migrationRaw = value;
        currentRelease.migration = isMigrationKind(value) ? value : null;
        continue;
      }
    }

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
