"use client"

import { useState } from "react"
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import { Bar, BarChart, Line, LineChart, XAxis, YAxis } from "recharts"
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip as ChartJSTooltip,
  Legend as ChartJSLegend,
} from "chart.js"
import { Doughnut } from "react-chartjs-2"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

// -- Chart.js registration --
ChartJS.register(ArcElement, ChartJSTooltip, ChartJSLegend)

// -- Sample data --

const barChartData = [
  { month: "Jan", income: 4200, expenses: 3100 },
  { month: "Feb", income: 4500, expenses: 2900 },
  { month: "Mar", income: 4100, expenses: 3400 },
  { month: "Apr", income: 4800, expenses: 3200 },
  { month: "May", income: 5200, expenses: 3600 },
  { month: "Jun", income: 4900, expenses: 3300 },
]

const lineChartData = [
  { month: "Jan", balance: 12400 },
  { month: "Feb", balance: 13900 },
  { month: "Mar", balance: 14600 },
  { month: "Apr", balance: 16200 },
  { month: "May", balance: 17800 },
  { month: "Jun", balance: 19400 },
]

const barChartConfig = {
  income: { label: "Income", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
} satisfies ChartConfig

const lineChartConfig = {
  balance: { label: "Net Worth", color: "var(--chart-3)" },
} satisfies ChartConfig

const doughnutData = {
  labels: ["Groceries", "Rent", "Utilities", "Transport", "Other"],
  datasets: [
    {
      data: [650, 1400, 220, 180, 450],
      backgroundColor: [
        "oklch(0.809 0.105 251.813)",
        "oklch(0.623 0.214 259.815)",
        "oklch(0.546 0.245 262.881)",
        "oklch(0.488 0.243 264.376)",
        "oklch(0.424 0.199 265.638)",
      ],
      borderWidth: 0,
    },
  ],
}

// -- TanStack Table data --

type Transaction = {
  date: string
  description: string
  category: string
  amount: number
}

const transactions: Transaction[] = [
  { date: "2026-03-01", description: "Grocery Store", category: "Groceries", amount: -82.5 },
  { date: "2026-03-02", description: "Monthly Salary", category: "Salary", amount: 4500.0 },
  { date: "2026-03-03", description: "Electric Bill", category: "Utilities", amount: -95.2 },
  { date: "2026-03-04", description: "Gas Station", category: "Transport", amount: -45.0 },
  { date: "2026-03-05", description: "Restaurant", category: "Dining", amount: -62.8 },
]

const columnHelper = createColumnHelper<Transaction>()

const columns = [
  columnHelper.accessor("date", {
    header: "Date",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("description", {
    header: "Description",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("category", {
    header: "Category",
    cell: (info) => <Badge variant="secondary">{info.getValue()}</Badge>,
  }),
  columnHelper.accessor("amount", {
    header: "Amount",
    cell: (info) => {
      const val = info.getValue()
      return (
        <span className={val < 0 ? "text-destructive" : "text-emerald-600"}>
          {val < 0 ? "-" : "+"}${Math.abs(val).toFixed(2)}
        </span>
      )
    },
  }),
]

// -- Page component --

export default function TestUIPage() {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data: transactions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-8">
      <div>
        <h1 className="text-2xl font-bold">UI Component Test Page</h1>
        <p className="text-muted-foreground">
          Verifies that all installed libraries render correctly.
        </p>
      </div>

      {/* ── Section 1: shadcn/ui Components ── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">shadcn/ui Components</h2>

        <Card>
          <CardHeader>
            <CardTitle>Component Sampler</CardTitle>
            <CardDescription>
              Button, Input, Select, Badge, Tabs, and Dialog
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>

            {/* Input */}
            <div className="max-w-sm">
              <Input placeholder="Type something..." />
            </div>

            {/* Select */}
            <div className="max-w-sm">
              <Select defaultValue="checking">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="credit">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="pt-4">
                Overview tab content
              </TabsContent>
              <TabsContent value="details" className="pt-4">
                Details tab content
              </TabsContent>
              <TabsContent value="settings" className="pt-4">
                Settings tab content
              </TabsContent>
            </Tabs>

            {/* Dialog */}
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>
                Open Dialog
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog Title</DialogTitle>
                  <DialogDescription>
                    This is a test dialog. It renders correctly if you can see
                    this text with a backdrop overlay.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </section>

      {/* ── Section 2: shadcn Charts (Recharts) ── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">shadcn Charts (Recharts)</h2>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Income vs Expenses</CardTitle>
              <CardDescription>Bar chart — monthly comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={barChartConfig}>
                <BarChart data={barChartData}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="income"
                    fill="var(--color-income)"
                    radius={4}
                  />
                  <Bar
                    dataKey="expenses"
                    fill="var(--color-expenses)"
                    radius={4}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Net Worth Trend</CardTitle>
              <CardDescription>
                Line chart — cumulative balance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={lineChartConfig}>
                <LineChart data={lineChartData}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    stroke="var(--color-balance)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Section 3: react-chartjs-2 (Chart.js) ── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">react-chartjs-2 (Chart.js)</h2>

        <Card>
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
            <CardDescription>
              Doughnut chart — spending by category
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <div className="h-64 w-64">
              <Doughnut
                data={doughnutData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Section 4: TanStack Table ── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold">TanStack Table</h2>

        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
            <CardDescription>
              Click column headers to sort
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className="cursor-pointer select-none"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {{ asc: " ↑", desc: " ↓" }[
                          header.column.getIsSorted() as string
                        ] ?? ""}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
