import { Card, CardContent } from "@/components/ui/card";

/**
 * Placeholder body for scaffolded drilldown pages that don't have content yet.
 * Replace with the real drilldown when building it out.
 */
export function ComingSoon({ feature }: { feature: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">{feature}</p>
        <p className="text-sm text-muted-foreground">
          This drilldown is coming soon.
        </p>
      </CardContent>
    </Card>
  );
}
