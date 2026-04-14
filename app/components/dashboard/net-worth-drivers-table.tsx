import type { DriversData } from "@/lib/queries/net-worth-drilldown";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

function signedCurrency(n: number): string {
  const formatted = formatCurrency(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

function signedPercent(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}%`;
  if (n < 0) return `-${abs}%`;
  return `${abs}%`;
}

function valueColor(n: number): string {
  if (n > 0) return "text-green-600 dark:text-green-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "";
}

interface NetWorthDriversTableProps {
  data: DriversData;
}

export function NetWorthDriversTable({ data }: NetWorthDriversTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          Net Worth Drivers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Type Category</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">% Impact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.categories.map((row) => (
              <TableRow key={row.categoryId}>
                <TableCell className="text-muted-foreground">
                  {row.categoryName}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${valueColor(row.change)}`}
                >
                  {signedCurrency(row.change)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${valueColor(row.percentImpact)}`}
                >
                  {signedPercent(row.percentImpact)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total</TableCell>
              <TableCell
                className={`text-right font-bold tabular-nums ${valueColor(data.totalChange)}`}
              >
                {signedCurrency(data.totalChange)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {data.totalChange !== 0 ? "100.00%" : "0.00%"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
