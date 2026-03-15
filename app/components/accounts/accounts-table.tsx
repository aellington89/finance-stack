"use client";

import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AccountBalanceRow } from "@/lib/queries/accounts";

interface AccountEntry {
  name: string;
  balance: number;
}

interface AccountTypeGroup {
  accountType: string;
  subtotal: number;
  accounts: AccountEntry[];
}

interface CategoryGroup {
  category: string;
  subtotal: number;
  accountTypes: AccountTypeGroup[];
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const ASSET_CATEGORIES = [
  "Current Asset",
  "Fixed Asset",
  "Investment",
  "Restricted Asset",
];
const LIABILITY_CATEGORIES = ["Current Liability", "Non-current Liability"];

function buildCategoryGroups(data: AccountBalanceRow[]): {
  assets: CategoryGroup[];
  liabilities: CategoryGroup[];
} {
  const categoryMap = new Map<string, CategoryGroup>();
  const accountTypeMap = new Map<string, AccountTypeGroup>();

  for (const row of data) {
    if (
      row.accountTypeCategory === null &&
      row.accountType === null &&
      row.accountName === null
    ) {
      // Grand total — skip
    } else if (row.accountType === null && row.accountName === null) {
      if (row.accountTypeCategory) {
        const existing = categoryMap.get(row.accountTypeCategory);
        if (existing) {
          existing.subtotal = row.balance;
        } else {
          categoryMap.set(row.accountTypeCategory, {
            category: row.accountTypeCategory,
            subtotal: row.balance,
            accountTypes: [],
          });
        }
      }
    } else if (row.accountName === null && row.accountType !== null) {
      const key = `${row.accountTypeCategory}::${row.accountType}`;
      const existing = accountTypeMap.get(key);
      if (existing) {
        existing.subtotal = row.balance;
      }
    } else if (
      row.accountTypeCategory !== null &&
      row.accountType !== null &&
      row.accountName !== null
    ) {
      const key = `${row.accountTypeCategory}::${row.accountType}`;
      let atGroup = accountTypeMap.get(key);
      if (!atGroup) {
        atGroup = {
          accountType: row.accountType,
          subtotal: 0,
          accounts: [],
        };
        accountTypeMap.set(key, atGroup);

        let catGroup = categoryMap.get(row.accountTypeCategory);
        if (!catGroup) {
          catGroup = {
            category: row.accountTypeCategory,
            subtotal: 0,
            accountTypes: [],
          };
          categoryMap.set(row.accountTypeCategory, catGroup);
        }
        catGroup.accountTypes.push(atGroup);
      }
      atGroup.accounts.push({ name: row.accountName, balance: row.balance });
    }
  }

  const assets: CategoryGroup[] = [];
  const liabilities: CategoryGroup[] = [];

  for (const cat of ASSET_CATEGORIES) {
    const group = categoryMap.get(cat);
    if (group) assets.push(group);
  }
  for (const cat of LIABILITY_CATEGORIES) {
    const group = categoryMap.get(cat);
    if (group) liabilities.push(group);
  }

  return { assets, liabilities };
}


function getAccountTypeNames(categories: CategoryGroup[]): string[] {
  return categories.flatMap((c) => c.accountTypes.map((at) => at.accountType));
}

function getCategoryNames(categories: CategoryGroup[]): string[] {
  return categories.map((c) => c.category);
}

function getAllExpandableKeys(categories: CategoryGroup[]): string[] {
  return [
    ...getCategoryNames(categories),
    ...getAccountTypeNames(categories),
  ];
}

export function AccountsTable({ data }: { data: AccountBalanceRow[] }) {
  const { assets, liabilities } = buildCategoryGroups(data);

  const totalAssets = assets.reduce((sum, g) => sum + g.subtotal, 0);
  const totalLiabilities = liabilities.reduce(
    (sum, g) => sum + g.subtotal,
    0
  );

  const allAssetKeys = useMemo(() => getAllExpandableKeys(assets), [assets]);
  const allLiabilityKeys = useMemo(
    () => getAllExpandableKeys(liabilities),
    [liabilities]
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (accountType: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(accountType)) {
        next.delete(accountType);
      } else {
        next.add(accountType);
      }
      return next;
    });
  };

  const expandAll = (accountTypes: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const at of accountTypes) next.add(at);
      return next;
    });
  };

  const collapseAll = (accountTypes: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const at of accountTypes) next.delete(at);
      return next;
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start lg:items-stretch">
      <BalanceSheetSection
        title="Assets"
        categories={assets}
        total={totalAssets}
        totalLabel="Total Assets"
        expanded={expanded}
        onToggle={toggle}
        onExpandAll={() => expandAll(allAssetKeys)}
        onCollapseAll={() => collapseAll(allAssetKeys)}
      />
      <BalanceSheetSection
        title="Liabilities"
        categories={liabilities}
        total={totalLiabilities}
        totalLabel="Total Liabilities"
        expanded={expanded}
        onToggle={toggle}
        onExpandAll={() => expandAll(allLiabilityKeys)}
        onCollapseAll={() => collapseAll(allLiabilityKeys)}
      />
    </div>
  );
}

function BalanceSheetSection({
  title,
  categories,
  total,
  totalLabel,
  expanded,
  onToggle,
  onExpandAll,
  onCollapseAll,
}: {
  title: string;
  categories: CategoryGroup[];
  total: number;
  totalLabel: string;
  expanded: Set<string>;
  onToggle: (accountType: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-1">
          <button
            onClick={onExpandAll}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Expand all"
          >
            <ChevronsUpDownIcon className="size-4" />
          </button>
          <button
            onClick={onCollapseAll}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Collapse all"
          >
            <ChevronsDownUpIcon className="size-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <Table>
          <TableBody>
            {categories.map((category) => (
              <CategoryRows
                key={category.category}
                category={category}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="mt-auto">
        <div className="flex w-full items-center justify-between">
          <span className="font-bold text-base uppercase tracking-wide">{totalLabel}</span>
          <span
            className={cn(
              "font-bold text-base tabular-nums",
              amountColorClass(total)
            )}
          >
            {currencyFormatter.format(total)}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}

function CategoryRows({
  category,
  expanded,
  onToggle,
}: {
  category: CategoryGroup;
  expanded: Set<string>;
  onToggle: (accountType: string) => void;
}) {
  const isCategoryExpanded = expanded.has(category.category);

  return (
    <>
      <TableRow
        className="bg-muted/50 hover:bg-muted/50 cursor-pointer"
        onClick={() => onToggle(category.category)}
      >
        <TableCell className="py-2">
          <div className="flex items-center gap-1.5">
            {isCategoryExpanded ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="font-bold text-base uppercase tracking-wide">
              {category.category}
            </span>
          </div>
        </TableCell>
        <TableCell
          className={cn(
            "text-right font-bold text-base tabular-nums py-2",
            amountColorClass(category.subtotal)
          )}
        >
          {currencyFormatter.format(category.subtotal)}
        </TableCell>
      </TableRow>

      {isCategoryExpanded &&
        category.accountTypes.map((atGroup) => {
          const isExpanded = expanded.has(atGroup.accountType);
          return (
            <AccountTypeRows
              key={atGroup.accountType}
              group={atGroup}
              isExpanded={isExpanded}
              onToggle={() => onToggle(atGroup.accountType)}
            />
          );
        })}
    </>
  );
}

function AccountTypeRows({
  group,
  isExpanded,
  onToggle,
}: {
  group: AccountTypeGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="pl-4">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="font-medium">{group.accountType}</span>
          </div>
        </TableCell>
        <TableCell
          className={cn(
            "text-right font-medium tabular-nums",
            amountColorClass(group.subtotal)
          )}
        >
          {currencyFormatter.format(group.subtotal)}
        </TableCell>
      </TableRow>

      {isExpanded &&
        group.accounts.map((account) => (
          <TableRow key={account.name} className="bg-muted/50 hover:bg-muted/50">
            <TableCell className="pl-10 italic text-muted-foreground">
              {account.name}
            </TableCell>
            <TableCell
              className={cn(
                "text-right italic tabular-nums",
                amountColorClass(account.balance)
              )}
            >
              {currencyFormatter.format(account.balance)}
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}

/**
 * Unified color logic for account dollar amounts:
 * - Positive: green (asset growth or liability paydown)
 * - Zero: white/default
 * - Negative: red (asset loss or increasing debt)
 */
export function amountColorClass(value: number): string {
  if (value === 0) return "";
  return value > 0
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
}
