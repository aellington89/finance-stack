import { readChangelog } from "@/lib/changelog";
import type { InlineToken } from "@/lib/changelog";
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
