// Shared fixture helper for the two /api/health suites (#191). Not a *.test.ts
// file, so the integration project's include glob does not collect it — which is
// also why it cannot live in either suite: importing one test file from another
// would run its describes twice.

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { OPENING_BALANCE_TYPE, WORK_EXPENSE_TYPE } from "@/lib/constants/reference-ids";

// Puts both rows these suites perturb back to canonical. Safe to run after every
// test: the UPDATE is a no-op when the name is already right, and the INSERT is
// a no-op when the row was never deleted.
export async function restoreTransactionTypes() {
  await db.execute(sql`
    UPDATE transaction_types
    SET transaction_type = ${OPENING_BALANCE_TYPE.name}
    WHERE transaction_type_id = ${OPENING_BALANCE_TYPE.id}
  `);

  await db.execute(sql`
    INSERT INTO transaction_types (transaction_type_id, transaction_type)
    OVERRIDING SYSTEM VALUE
    VALUES (${WORK_EXPENSE_TYPE.id}, ${WORK_EXPENSE_TYPE.name})
    ON CONFLICT (transaction_type_id) DO NOTHING
  `);
}
