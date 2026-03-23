import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AccountListRow } from "@/lib/queries/accounts";

interface TypeGroup {
  typeName: string;
  typeId: number;
  accounts: AccountListRow[];
}

interface CategoryGroup {
  category: string;
  types: TypeGroup[];
}

const LIABILITY_CATEGORIES = new Set(["Current Liability", "Non-current Liability"]);

function groupByCategory(accounts: AccountListRow[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  let currentCategory: CategoryGroup | null = null;
  let currentType: TypeGroup | null = null;

  for (const acct of accounts) {
    if (!currentCategory || currentCategory.category !== acct.accountTypeCategory) {
      currentType = { typeName: acct.accountType, typeId: acct.accountTypeId, accounts: [acct] };
      currentCategory = { category: acct.accountTypeCategory, types: [currentType] };
      groups.push(currentCategory);
    } else if (!currentType || currentType.typeName !== acct.accountType) {
      currentType = { typeName: acct.accountType, typeId: acct.accountTypeId, accounts: [acct] };
      currentCategory.types.push(currentType);
    } else {
      currentType.accounts.push(acct);
    }
  }

  return groups;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function CategoryCard({ category }: { category: CategoryGroup }) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="shrink-0">
        <CardTitle>{category.category}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 overflow-y-auto min-h-0 flex-1">
        {category.types.map((type) => (
          <div
            key={type.typeName}
            className="rounded-lg border bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {type.typeName}
              </h3>
              <Link href={`/accounts/new?typeId=${type.typeId}`}>
                <Button variant="ghost" size="icon-xs" aria-label={`New ${type.typeName} account`}>
                  <Plus className="size-4" />
                </Button>
              </Link>
            </div>
            <div className="space-y-0.5">
              {type.accounts.map((acct) => (
                <div
                  key={acct.accountId}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0 truncate">
                    <Link
                      href={`/accounts/${acct.accountId}/edit`}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {acct.accountName}
                    </Link>
                    {acct.accountIdentifier && (
                      <span className="ml-2 text-muted-foreground">
                        ···{acct.accountIdentifier}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {acct.closedDate ? (
                      <span className="text-xs text-muted-foreground">Closed</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Open</span>
                    )}
                    <span
                      className={`tabular-nums font-medium w-24 text-right ${
                        acct.balance >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCurrency(acct.balance)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-muted/15 p-4 h-full flex flex-col">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4 shrink-0">
        {label}
      </h2>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

export function AccountsByCategory({ accounts }: { accounts: AccountListRow[] }) {
  const allCategories = groupByCategory(accounts);
  const assetCategories = allCategories.filter((c) => !LIABILITY_CATEGORIES.has(c.category));
  const liabilityCategories = allCategories.filter((c) => LIABILITY_CATEGORIES.has(c.category));

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 row-span-2">
        <GroupSection label="Assets">
          <div className="grid grid-cols-2 grid-rows-2 gap-4 h-full">
            {assetCategories.map((cat) => (
              <CategoryCard key={cat.category} category={cat} />
            ))}
          </div>
        </GroupSection>
      </div>
      <div className="col-span-1 row-span-2">
        <GroupSection label="Liabilities">
          <div className="grid grid-cols-1 grid-rows-2 gap-4 h-full">
            {liabilityCategories.map((cat) => (
              <CategoryCard key={cat.category} category={cat} />
            ))}
          </div>
        </GroupSection>
      </div>
    </div>
  );
}
