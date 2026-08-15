import { pgTable, index, foreignKey, serial, text, date, integer, bigint, jsonb, numeric, check, primaryKey, pgView, uuid, timestamp } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const transactions = pgTable("transactions", {
	transactionId: serial("transaction_id").primaryKey().notNull(),
	transactionDescription: text("transaction_description").notNull(),
	transactionDate: date("transaction_date").notNull(),
	accountId: integer("account_id").notNull(),
	amount: numeric({ precision: 15, scale:  2 }).notNull(),
	relatedAccountId: integer("related_account_id"),
	transactionTypeId: integer("transaction_type_id").notNull(),
	transactionCategoryId: integer("transaction_category_id").notNull(),
}, (table) => [
	index("idx_transactions_account_date").using("btree", table.accountId.asc().nullsLast().op("int4_ops"), table.transactionDate.asc().nullsLast().op("date_ops")),
	index("idx_transactions_category").using("btree", table.transactionCategoryId.asc().nullsLast().op("int4_ops")),
	index("idx_transactions_date").using("btree", table.transactionDate.asc().nullsLast().op("date_ops")),
	index("idx_transactions_related_account_id").using("btree", table.relatedAccountId.asc().nullsLast().op("int4_ops")).where(sql`"related_account_id" IS NOT NULL`),
	index("idx_transactions_type").using("btree", table.transactionTypeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.accountId],
			name: "transactions_account_id_fkey"
		}),
	foreignKey({
			columns: [table.relatedAccountId],
			foreignColumns: [accounts.accountId],
			name: "transactions_related_account_id_fkey"
		}),
	foreignKey({
			columns: [table.transactionCategoryId],
			foreignColumns: [transactionCategories.transactionCategoryId],
			name: "transactions_transaction_category_id_fkey"
		}),
	foreignKey({
			columns: [table.transactionTypeId],
			foreignColumns: [transactionTypes.transactionTypeId],
			name: "transactions_transaction_type_id_fkey"
		}),
	check("transactions_transaction_description_not_blank", sql`transaction_description <> ''`),
]);

export const accountTypes = pgTable("account_types", {
	accountTypeId: integer("account_type_id").primaryKey().generatedAlwaysAsIdentity({ name: "account_types_account_type_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	accountType: text("account_type").notNull(),
	accountTypeCategoryId: integer("account_type_category_id").notNull(),
	liquidityClass: text("liquidity_class"),
}, (table) => [
	foreignKey({
			columns: [table.accountTypeCategoryId],
			foreignColumns: [accountTypeCategories.accountTypeCategoryId],
			name: "account_types_account_type_category_id_fkey"
		}),
	check("account_types_liquidity_class_check", sql`liquidity_class = ANY (ARRAY['liquid'::text, 'semi_liquid'::text, 'illiquid'::text, 'restricted'::text])`),
]);

export const accounts = pgTable("accounts", {
	accountId: serial("account_id").primaryKey().notNull(),
	accountName: text("account_name").notNull(),
	accountTypeId: integer("account_type_id").notNull(),
	accountIdentifier: text("account_identifier"),
	closedDate: date("closed_date"),
	openedDate: date("opened_date"),
	liquidityClass: text("liquidity_class"),
}, (table) => [
	foreignKey({
			columns: [table.accountTypeId],
			foreignColumns: [accountTypes.accountTypeId],
			name: "accounts_account_type_id_fkey"
		}),
	check("accounts_liquidity_class_check", sql`liquidity_class = ANY (ARRAY['liquid'::text, 'semi_liquid'::text, 'illiquid'::text, 'restricted'::text])`),
	check("accounts_account_name_not_blank", sql`account_name <> ''`),
]);

export const accountTypeCategories = pgTable("account_type_categories", {
	accountTypeCategoryId: integer("account_type_category_id").primaryKey().generatedAlwaysAsIdentity({ name: "account_type_categories_account_type_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	accountTypeCategory: text("account_type_category").notNull(),
});

export const transactionCategories = pgTable("transaction_categories", {
	transactionCategoryId: integer("transaction_category_id").primaryKey().generatedAlwaysAsIdentity({ name: "transaction_type_categories_transaction_type_category_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	transactionCategory: text("transaction_category").notNull(),
	// What this category means to the reporting layer (issue #111). NULL for
	// most rows — a category only carries a role when the user opts it into an
	// aggregate. Same shape as account_types.liquidity_class below: nullable
	// text with a CHECK, which leaves `= ANY (ARRAY[...])` NULL-permissive on
	// its own.
	//
	// The value set is spelled out here rather than built from
	// lib/constants/reporting-roles.ts because interpolating it would need
	// sql.raw, which eslint.config.mjs bans repo-wide. `npm run
	// check:seed-references` proves this list and REPORTING_ROLE_KEYS equal in
	// both directions instead, so the duplication cannot drift.
	reportingRole: text("reporting_role"),
}, () => [
	check("transaction_categories_reporting_role_check", sql`reporting_role = ANY (ARRAY['debt_principle_paid'::text, 'debt_interest_paid'::text, 'debt_interest_accrued'::text, 'debt_cash_paydown'::text])`),
]);

export const transactionTypes = pgTable("transaction_types", {
	transactionTypeId: integer("transaction_type_id").primaryKey().generatedAlwaysAsIdentity({ name: "transaction_types_transaction_type_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	transactionType: text("transaction_type").notNull(),
});

export const users = pgTable("users", {
	userId: uuid("user_id").defaultRandom().primaryKey().notNull(),
	username: text().unique().notNull(),
	passwordHash: text("password_hash").notNull(),
	role: text().default('admin').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("users_username_not_blank", sql`username <> ''`),
	// The role vocabulary from lib/auth/roles.ts (issue #87). Spelled out here
	// rather than interpolated for the same reason as the reporting_role check
	// above: sql.raw is banned repo-wide.
	check("users_role_valid", sql`role = ANY (ARRAY['admin'::text, 'user'::text])`),
]);

// Written only by the audit_row_change() trigger installed in migration
// 0004_add_audit_log.sql — never by the application. finance_app holds SELECT
// and nothing else (init-db/roles/02-grants.sql), which is what stops a
// compromised app from forging entries or erasing its own tracks. See
// docs/audit-log.md before changing anything here (issue #180).
export const auditLog = pgTable("audit_log", {
	auditId: bigint("audit_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// No FK to users: the log has to survive the deletion of the user it names,
	// and actor_label is the human-readable snapshot taken at write time.
	actorUserId: uuid("actor_user_id"),
	actorLabel: text("actor_label").notNull(),
	actorSource: text("actor_source").notNull(),
	action: text().notNull(),
	tableName: text("table_name").notNull(),
	rowPk: text("row_pk").notNull(),
	beforeData: jsonb("before_data"),
	afterData: jsonb("after_data"),
	changedColumns: text("changed_columns").array(),
}, (table) => [
	// Both are declared ascending even though every query here reads newest-first:
	// a btree serves ORDER BY ... DESC by scanning backwards, and on the composite
	// index the leading table_name/row_pk equality makes that scan a plain range
	// walk. Keeping them ASC avoids a schema.ts that claims a direction
	// drizzle-kit does not emit into the migration SQL.
	index("idx_audit_log_occurred_at").using("btree", table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_audit_log_table_row").using("btree", table.tableName.asc().nullsLast().op("text_ops"), table.rowPk.asc().nullsLast().op("text_ops"), table.occurredAt.asc().nullsLast().op("timestamptz_ops")),
	check("audit_log_action_check", sql`action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])`),
	check("audit_log_actor_source_check", sql`actor_source = ANY (ARRAY['app'::text, 'database'::text])`),
]);

export const accountBalanceHistory = pgTable("account_balance_history", {
	accountId: integer("account_id").notNull(),
	balanceDate: date("balance_date").notNull(),
	dailyBalance: numeric("daily_balance", { precision: 15, scale:  2 }).default('0').notNull(),
	cumulativeBalance: numeric("cumulative_balance", { precision: 15, scale:  2 }).default('0').notNull(),
}, (table) => [
	index("idx_abh_account_date").using("btree", table.accountId.asc().nullsLast().op("int4_ops"), table.balanceDate.desc().nullsFirst().op("date_ops")),
	index("idx_balance_history_date").using("btree", table.balanceDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.accountId],
			name: "account_balance_history_account_id_fkey"
		}),
	primaryKey({ columns: [table.accountId, table.balanceDate], name: "account_balance_history_pkey"}),
]);
export const vTransactionsFull = pgView("v_transactions_full", {	transactionId: integer("transaction_id"),
	transactionDescription: text("transaction_description"),
	transactionDate: date("transaction_date"),
	amount: numeric({ precision: 15, scale:  2 }),
	accountId: integer("account_id"),
	relatedAccountId: integer("related_account_id"),
	accountName: text("account_name"),
	accountTypeId: integer("account_type_id"),
	accountType: text("account_type"),
	accountTypeCategory: text("account_type_category"),
	relatedAccountName: text("related_account_name"),
	transactionTypeId: integer("transaction_type_id"),
	transactionType: text("transaction_type"),
	transactionCategoryId: integer("transaction_category_id"),
	transactionCategory: text("transaction_category"),
}).as(sql`SELECT t.transaction_id, t.transaction_description, t.transaction_date, t.amount, t.account_id, t.related_account_id, a.account_name, a.account_type_id, at.account_type, atc.account_type_category, ra.account_name AS related_account_name, tt.transaction_type_id, tt.transaction_type, tc.transaction_category_id, tc.transaction_category FROM transactions t JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) LEFT JOIN accounts ra ON t.related_account_id = ra.account_id JOIN transaction_types tt USING (transaction_type_id) JOIN transaction_categories tc USING (transaction_category_id)`);

export const vAccountBalancesCurrent = pgView("v_account_balances_current", {	accountId: integer("account_id"),
	accountName: text("account_name"),
	accountType: text("account_type"),
	accountTypeCategory: text("account_type_category"),
	accountTypeCategoryId: integer("account_type_category_id"),
	currentBalance: numeric("current_balance", { precision: 15, scale:  2 }),
	balanceDate: date("balance_date"),
}).as(sql`SELECT abh.account_id, a.account_name, at.account_type, atc.account_type_category, atc.account_type_category_id, abh.cumulative_balance AS current_balance, abh.balance_date FROM account_balance_history abh JOIN accounts a USING (account_id) JOIN account_types at USING (account_type_id) JOIN account_type_categories atc USING (account_type_category_id) WHERE abh.balance_date = (( SELECT max(account_balance_history.balance_date) AS max FROM account_balance_history WHERE account_balance_history.account_id = abh.account_id))`);

export const vDailyTotals = pgView("v_daily_totals", {	transactionDate: date("transaction_date"),
	transactionType: text("transaction_type"),
	dailyTotal: numeric("daily_total"),
}).as(sql`SELECT t.transaction_date, tt.transaction_type, sum(t.amount) AS daily_total FROM transactions t JOIN transaction_types tt USING (transaction_type_id) GROUP BY t.transaction_date, tt.transaction_type`);

// The read surface for the audit log. Like the three views above it is created
// without security_invoker, so it runs with the view owner's rights — which is
// how finance_metabase reads it while holding no privilege on audit_log itself.
export const vAuditLog = pgView("v_audit_log", {	auditId: bigint("audit_id", { mode: "number" }),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }),
	actorUserId: uuid("actor_user_id"),
	actorLabel: text("actor_label"),
	actorSource: text("actor_source"),
	action: text(),
	tableName: text("table_name"),
	rowPk: text("row_pk"),
	changedColumns: text("changed_columns").array(),
	beforeData: jsonb("before_data"),
	afterData: jsonb("after_data"),
}).as(sql`SELECT audit_id, occurred_at, actor_user_id, actor_label, actor_source, action, table_name, row_pk, changed_columns, before_data, after_data FROM audit_log`);