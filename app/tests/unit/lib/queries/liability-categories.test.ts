import { describe, it, expect } from "vitest";
import {
  LIABILITY_CATEGORY_IDS,
  LIABILITY_CURRENT_CATEGORY_ID,
  LIABILITY_NON_CURRENT_CATEGORY_ID,
} from "@/lib/queries/liability-categories";

// This file used to also cover DEBT_PAYMENT_CATEGORY_IDS and
// DEBT_INTEREST_CATEGORY_IDS — the transaction_category_id lists the Liabilities
// aggregates filtered on. Issue #111 deleted them: the meaning moved to
// transaction_categories.reporting_role, so what those lists asserted (non-empty,
// no duplicates, no overlap between the two buckets) is now either a property of
// the registry (tests/unit/lib/constants/reporting-roles.test.ts) or of the data
// (tests/integration/queries/liabilities-drilldown.test.ts).
//
// What remains here is pinned by id and legitimately so: account_type_categories
// ships with the application and arrives identical on every install.

describe("LIABILITY_CATEGORY_IDS", () => {
  it("contains exactly the two liability category IDs from shared-lookups", () => {
    expect(LIABILITY_CURRENT_CATEGORY_ID).toBe(5);
    expect(LIABILITY_NON_CURRENT_CATEGORY_ID).toBe(6);
    expect([...LIABILITY_CATEGORY_IDS].sort()).toEqual([5, 6]);
  });
});
