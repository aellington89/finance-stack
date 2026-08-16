import { readChangelog } from "@/lib/changelog";
import type { InlineToken, MigrationKind } from "@/lib/changelog";
import { BUILD_INFO } from "@/lib/version";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

// How each release's declared migration impact reads on the card header. The
// point is the rollback question: `breaking` means reverting to the previous
// image is not enough, the pre-upgrade dump has to be restored (Issue #277).
const MIGRATION_BADGE: Record<
  MigrationKind,
  { label: string; variant: "outline" | "secondary" | "destructive" }
> = {
  none: { label: "No migration", variant: "outline" },
  "backward-compatible": { label: "Backward-compatible migration", variant: "secondary" },
  breaking: { label: "Breaking migration", variant: "destructive" },
};

function renderTokens(tokens: InlineToken[]) {
  return tokens.map((token, i) => {
    if (token.type === "link") {
      return (
        <a
          key={i}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {token.label}
        </a>
      );
    }
    if (token.type === "code") {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1 py-0.5 text-xs font-mono"
        >
          {token.value}
        </code>
      );
    }
    return <span key={i}>{token.value}</span>;
  });
}

export default async function AboutPage() {
  const releases = readChangelog();

  return (
    <div className="p-6 w-3/4 mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">What&apos;s New</h1>
      </div>
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No release history found.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {releases.map((release) => {
            const isCurrent =
              release.version !== "Unreleased" &&
              release.version === BUILD_INFO.version;
            // null for [Unreleased] and for any value the parser did not
            // recognize — the gate reports those, the page stays quiet.
            const migrationBadge =
              release.migration && MIGRATION_BADGE[release.migration];
            return (
              <Card
                key={release.version}
                className={isCurrent ? "ring-2 ring-primary" : undefined}
              >
                <CardHeader>
                  <CardTitle>
                    <div className="flex items-center gap-2">
                      <span>
                        {release.version === "Unreleased"
                          ? "Unreleased"
                          : `v${release.version}`}
                      </span>
                      {release.date && (
                        <span className="text-sm font-normal text-muted-foreground">
                          {release.date}
                        </span>
                      )}
                      {isCurrent && <Badge variant="default">Current</Badge>}
                      {migrationBadge && (
                        <Badge variant={migrationBadge.variant}>
                          {migrationBadge.label}
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                {release.sections.length > 0 && (
                  <CardContent>
                    <Table>
                      <TableBody>
                        {release.sections.flatMap((section) =>
                          section.items.map((item, i) => (
                            <TableRow key={`${section.heading}-${i}`}>
                              {i === 0 && (
                                <TableCell
                                  rowSpan={section.items.length}
                                  className="align-top font-medium text-muted-foreground text-xs uppercase tracking-wide w-24 pr-4"
                                >
                                  {section.heading}
                                </TableCell>
                              )}
                              <TableCell className="text-sm whitespace-normal break-words">
                                {renderTokens(item.tokens)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
