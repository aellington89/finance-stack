import { getTransactionFormOptions } from "@/lib/queries/transactions";
import { TransactionForm } from "@/components/transactions/transaction-form";

export const dynamic = "force-dynamic";

export default async function NewTransactionPage() {
  const { accounts, types, categories } = await getTransactionFormOptions();

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">New Transaction</h1>
      <TransactionForm
        accounts={accounts}
        types={types}
        categories={categories}
      />
    </main>
  );
}
