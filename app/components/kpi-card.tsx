import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface KpiCardProps {
  title: string;
  value: string;
  description?: string;
  className?: string;
}

export function KpiCard({ title, value, description, className }: KpiCardProps) {
  return (
    <Card className={cn("flex-1", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tabular-nums tracking-tight">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
