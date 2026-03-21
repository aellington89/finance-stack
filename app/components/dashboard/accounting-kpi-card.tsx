import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ChangeInfo {
  percent: number;
  direction: "up" | "down" | "none";
  label: string; // e.g. "vs. Feb: $24,368.99"
}

interface AccountingKpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  change?: ChangeInfo;
  /** Which direction is "good" — "up" for income/investments, "down" for expenses */
  positiveDirection?: "up" | "down";
  className?: string;
}

export function AccountingKpiCard({
  title,
  value,
  subtitle,
  change,
  positiveDirection = "down",
  className,
}: AccountingKpiCardProps) {
  return (
    <Card className={cn("flex-1", className)}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tabular-nums tracking-tight">
          {value}
        </p>
        {(subtitle || change) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {subtitle && <span>{subtitle}</span>}
            {change && change.direction !== "none" && (
              <span
                className={cn(
                  "font-medium",
                  change.direction === positiveDirection
                    ? "text-green-500"
                    : "text-red-500"
                )}
              >
                {change.direction === "down" ? "\u2193" : "\u2191"}{" "}
                {Math.abs(change.percent).toFixed(2)}%
              </span>
            )}
            {change && change.direction === "none" && (
              <span className="font-medium">No change</span>
            )}
            {change && <span>{change.label}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
