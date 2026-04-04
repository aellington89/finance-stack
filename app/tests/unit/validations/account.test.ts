import { describe, it, expect } from "vitest";
import { accountFormSchema } from "@/lib/validations/account";

describe("accountFormSchema", () => {
  it("accepts minimal valid input (name + typeId)", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Checking",
      accountTypeId: "3",
    });
    expect(result.success).toBe(true);
  });

  it("accepts full valid input", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Savings Account",
      accountTypeId: "2",
      accountIdentifier: "****1234",
      openedDate: "2020-01-15",
      closedDate: "2024-06-01",
      initialBalance: "1500.00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty account name", () => {
    const result = accountFormSchema.safeParse({
      accountName: "",
      accountTypeId: "1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => String(i.path[0]));
      expect(fields).toContain("accountName");
    }
  });

  it("rejects account name over 255 characters", () => {
    const result = accountFormSchema.safeParse({
      accountName: "a".repeat(256),
      accountTypeId: "1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => String(i.path[0]));
      expect(fields).toContain("accountName");
    }
  });

  it("rejects non-integer accountTypeId", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero accountTypeId", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative accountTypeId", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed date", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "1",
      openedDate: "01/15/2020",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => String(i.path[0]));
      expect(fields).toContain("openedDate");
    }
  });

  it("rejects malformed amount", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "1",
      initialBalance: "1,500.00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.issues.map((i) => String(i.path[0]));
      expect(fields).toContain("initialBalance");
    }
  });

  it("accepts negative initial balance", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Credit Card",
      accountTypeId: "5",
      initialBalance: "-250.00",
    });
    expect(result.success).toBe(true);
  });

  it("treats missing optional fields as undefined (not errors)", () => {
    const result = accountFormSchema.safeParse({
      accountName: "Test",
      accountTypeId: "1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountIdentifier).toBeUndefined();
      expect(result.data.openedDate).toBeUndefined();
    }
  });
});
