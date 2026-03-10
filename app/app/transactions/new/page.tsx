import { db } from "@/lib/db";
import { accounts, transactionTypes, transactionCategories } from "@/drizzle/schema";
import { isNull } from "drizzle-orm";
import { TransactionForm } from "./transaction-form";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const [accountList, typeList, categoryList] = await Promise.all([
    db
      .select({ id: accounts.accountId, name: accounts.accountName })
      .from(accounts)
      .where(isNull(accounts.closedDate))
      .orderBy(accounts.accountName),
    db
      .select({ id: transactionTypes.transactionTypeId, name: transactionTypes.transactionType })
      .from(transactionTypes)
      .orderBy(transactionTypes.transactionType),
    db
      .select({
        id: transactionCategories.transactionCategoryId,
        name: transactionCategories.transactionCategory,
      })
      .from(transactionCategories)
      .orderBy(transactionCategories.transactionCategory),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">New Transaction</h1>
      <TransactionForm
        accounts={accountList}
        types={typeList}
        categories={categoryList}
      />
    </main>
  );
}
