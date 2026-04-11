export interface TransactionFormCustomState {
  transactionDate: string;
  amount: string;
  accountId: string;
  relatedAccountId: string;
  transactionTypeId: string;
  transactionCategoryId: string;
}

// Persists Date, Account, and Transaction Type across a successful submit so
// users can enter runs of related transactions without re-selecting them.
export function getPostSubmitState(
  prev: TransactionFormCustomState,
): TransactionFormCustomState {
  return {
    transactionDate: prev.transactionDate,
    accountId: prev.accountId,
    transactionTypeId: prev.transactionTypeId,
    amount: "",
    relatedAccountId: "",
    transactionCategoryId: "",
  };
}
