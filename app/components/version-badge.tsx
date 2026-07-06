"use client";

import Link from "next/link";
import { BUILD_INFO } from "@/lib/version";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { format } from "date-fns";

export function VersionBadge() {
  const { version, gitSha, buildTime } = BUILD_INFO;
  const isDev = gitSha === "dev";
  const shortSha = isDev ? "dev" : gitSha.slice(0, 7);
  const formattedTime = buildTime
    ? format(new Date(buildTime), "MMM d, yyyy HH:mm")
    : "—";

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link href="/settings/about" />}
        className="text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        v{version}
        {isDev && <span className="ml-1 opacity-50">(dev)</span>}
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <div className="flex flex-col gap-0.5">
          <span>Version: {version}</span>
          <span>SHA: {shortSha}</span>
          <span>Built: {formattedTime}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
