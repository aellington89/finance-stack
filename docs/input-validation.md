# Input Validation & Error Messages

The rules every server action and page boundary follows, and the two CI gates that keep them true. Written up as part of the [Issue #179](https://github.com/aellington89/finance-stack/issues/179) audit, which decomposed section 3 of the security epic [#100](https://github.com/aellington89/finance-stack/issues/100).

## The three rules

**1. Re-validate at every entry point.** A server action is directly POST-able regardless of which page renders it, so client-side form state proves nothing. Every action parses its `FormData` through a Zod schema in [`app/lib/validations/`](../app/lib/validations/) before touching the database. The same applies to search params and dynamic route segments — a URL is user input.

**2. Never interpolate into SQL.** Values bind as parameters (`${value}` inside a `sql` tag, or the Drizzle query builder). Identifiers go through `sql.identifier()`. An `IN (…)` list goes through [`valueList()`](../app/lib/queries/_aggregates.ts). `sql.raw()` is banned by ESLint — see [the gates](#the-two-gates).

**3. Never surface driver text.** A caught error becomes an authored message via [`actionFailure()`](../app/lib/actions/failure.ts), which reports the real one server-side. Postgres error text carries row data by design — see [Observability → redaction](observability.md).

## The validation checklist

All 17 mutating actions, all green. Each also opens with `requireActionUser()` ([Issue #120](https://github.com/aellington89/finance-stack/issues/120)) — the session gate is a separate concern and is not repeated in the table.

There is no `createTransactionType()`: every row that table holds ships in `shared-lookups.sql`, so it was removed rather than guarded ([Issue #109](https://github.com/aellington89/finance-stack/issues/109)).

`parseEntityId()` ([`lib/validations/id.ts`](../app/lib/validations/id.ts)) narrows an ID to a positive `int4`, returning `null` for anything else. It exists because the guard it replaced (`!id || id <= 0`) accepted `1.5`, `Infinity`, and values past the `int4` ceiling — all of which bind cleanly in JavaScript and then raise `22P02` / `22003` in the driver.

| Action | Body validation | ID validation | Failure message |
| --- | --- | --- | --- |
| `submitTransaction()` | `transactionFormSchema` | — | Failed to save transaction. Please try again. |
| `updateTransaction()` | `transactionFormSchema` | `transactionId` | Failed to update transaction. Please try again. |
| `deleteTransaction()` | — | `transactionId` | Failed to delete transaction. Please try again. |
| `createAccount()` | `accountFormSchema` | — | Failed to create account. Please try again. |
| `updateAccount()` | `accountFormSchema` | `accountId` | Failed to update account. Please try again. |
| `deleteAccount()` | — | `accountId` | Failed to delete account. Please try again. |
| `createTransactionCategory()` | `transactionCategorySchema` | — | Failed to create category. Please try again. |
| `updateTransactionCategory()` | `transactionCategorySchema` | `transactionCategoryId` | Failed to update category. Please try again. |
| `deleteTransactionCategory()` | — | `transactionCategoryId` | Failed to delete category. Please try again. |
| `updateTransactionType()` | `entityNameSchema` | `transactionTypeId` | Failed to update type. Please try again. |
| `deleteTransactionType()` | — | `transactionTypeId` | Failed to delete type. Please try again. |
| `createAccountTypeCategory()` | `entityNameSchema` | — | Failed to create category. Please try again. |
| `updateAccountTypeCategory()` | `entityNameSchema` | `accountTypeCategoryId` | Failed to update category. Please try again. |
| `deleteAccountTypeCategory()` | — | `accountTypeCategoryId` | Failed to delete category. Please try again. |
| `createAccountType()` | `accountTypeSchema` | — | Failed to create account type. Please try again. |
| `updateAccountType()` | `accountTypeSchema` | `accountTypeId` | Failed to update account type. Please try again. |
| `deleteAccountType()` | — | `accountTypeId` | Failed to delete account type. Please try again. |

**This table is a gate, not a note.** [`tests/integration/actions/validation-contract.test.ts`](../app/tests/integration/actions/validation-contract.test.ts) parses the rows out of it and asserts they exactly match the exported functions of the three action modules. Add an action without a row here and the suite fails.

### The two exemptions

[`lib/actions/auth.ts`](../app/lib/actions/auth.ts) is out of the table:

- **`authenticate()`** hands raw credentials to Auth.js, which owns their handling. It returns one message — *"Invalid username or password."* — for every failure, deliberately not distinguishing unknown-user from wrong-password. Still covered by the contract test's driver-text assertion.
- **`signOutAction()`** accepts no input.

## Error-message vocabulary

Only three things can produce text a user sees:

| Source | Example | Where it comes from |
| --- | --- | --- |
| A Zod field message | "Account name is required" | Authored in the schema, keyed by field via `buildFieldErrors()` |
| A guard literal | "Invalid account ID", "Cannot delete: this category is used by existing transactions.", "Cannot delete: this type is protected — it ships with the app." | Written inline in the action, or composed by `protectionRefusal()` ([`lib/constants/protected-rows.ts`](../app/lib/constants/protected-rows.ts)) |
| `actionFailure()`'s third argument | "Failed to create account. Please try again." | The catch arm; the real error goes to the logs |

Zod's own messages count as internals, not as authored text. A field the client omits arrives as `null` from `formData.get()`, and a bare `z.string()` renders that as `Invalid input: expected string, received null` — which `buildFieldErrors()` would put straight on the form. Every `z.string()` in `lib/validations/` therefore carries a message argument: `z.string("Account name is required")`.

## Reads are entry points too

Search params and route segments reach the query layer the same way form fields reach an action.

- **Dates** — [`validateDateRange()`](../app/lib/validations/date-range.ts) owns `dateFrom` / `dateTo` for every dashboard page ([Issue #150](https://github.com/aellington89/finance-stack/issues/150)).
- **Filters** — [`validateFilterParams()`](../app/lib/validations/search-params.ts) owns `accountIds` / `typeIds` / `categoryIds` / `amount` / `descriptions`. Both return the same discriminated union, and a page renders `DateRangeError` instead of its data when either rejects.
- **Route segments** — `parseEntityId()` again; `/accounts/1.5/edit` is a 404, not an error boundary.

One deliberate behaviour choice: an ID list with a bad entry is **rejected whole**, not filtered down to its valid entries. Silently querying the remainder answers a question the user did not ask — and the filtering it replaced (`.filter((n) => !isNaN(n))`) is exactly what let `1.5` through, since `Number("1.5")` is not `NaN`.

## The two gates

**ESLint — no `sql.raw`.** Enforced over `app/`, `lib/`, `components/` and `hooks/` in [`eslint.config.mjs`](../app/eslint.config.mjs), alongside the `no-console` rule from [Issue #129](https://github.com/aellington89/finance-stack/issues/129). `sql.raw()` splices its argument into the SQL text unescaped, which is how a URL search param came to be interpolated into a `date_trunc()` call in `lib/queries/accounting.ts` — held back from the query only by a regex.

The rule is absolute because every previous use had a bound equivalent. If you need one, you want one of:

| Instead of | Use |
| --- | --- |
| `sql.raw(\`'${value}'\`)` | `${value}` — it binds |
| `sql.raw(alias)` | `sql.identifier(alias)` |
| `sql.raw(ids.join(", "))` | `valueList(ids)` |
| `sql.raw(EXPRESSIONS[key])` | a `Record<K, SQL>` of `sql\`\`` fragments |

Note that `date_trunc()`, `to_char()` and `generate_series()` all accept their unit / format / step as **parameters** — `date_trunc($1, $2::date)` works — so needing a literal there is usually an assumption rather than a constraint.

**The validation contract test.** Described above; it also asserts that no action returns driver text, and that a malformed payload is rejected *before* the database is reached (it spies on `console.error`, so an action that let the payload through to `actionFailure()` fails even though it returned the right message).

## Adding a new server action

1. Put the body schema in `lib/validations/`, with a message on every `z.string()`.
2. Open with `requireActionUser()`, then `safeParse()`, then `parseEntityId()` for any ID.
3. Wrap **everything** that touches the database in one `try` — including read-only pre-checks. A read outside it escapes the action as an unhandled throw rather than an `ActionState`.
4. Do the writes inside `auditedTransaction()` ([Audit Log](audit-log.md)).
5. Return `actionFailure(name, error, "<authored message>")` from the catch.
6. Add a row to the table above and to the contract test's registry.
