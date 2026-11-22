"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClearableComboboxField,
  ComboboxField,
  type LookupOption,
} from "@/components/transactions/combobox-fields";
import { previewSchedule, previewSentence } from "@/components/transactions/recurring-schedule-view";
import { CADENCES, cadenceUnit, type Cadence } from "@/lib/recurring/schedule";
import type { ActionState } from "@/lib/actions/utils";
import type { RecurringTransactionRow } from "@/lib/queries/recurring-transactions";

const initialState: ActionState = { success: false, errors: {}, message: "" };

/** How long typing must pause before the preview is announced. */
const ANNOUNCE_DELAY_MS = 600;

interface RecurringTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  accounts: LookupOption[];
  types: LookupOption[];
  categories: LookupOption[];
  /** The template being edited. Absent when adding one. */
  template?: RecurringTransactionRow;
  /**
   * Postgres's CURRENT_DATE as the page read it, the "today" the save uses:
   * the add form's default next date, and the preview's today.
   */
  today: string;
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : isEdit ? "Save Changes" : "Add"}
    </Button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}

/**
 * Add or edit one recurring transaction (Issue #135): the six fields every row
 * it creates will carry, and when it repeats. The line under the schedule says
 * what saving will do, including any dates already due, which a save adds at
 * once.
 */
export function RecurringTransactionDialog({
  open,
  onOpenChange,
  action,
  accounts,
  types,
  categories,
  template,
  today,
}: RecurringTransactionDialogProps) {
  const isEdit = template !== undefined;
  const [state, formAction] = useActionState(action, initialState);

  // The pickers list open accounts only. The template's own account or related
  // account that has since closed is added back, marked, so an edit keeps it
  // rather than posting an empty field: a paused template may stay on a closed
  // account (the save refuses only an active one), and a closed related
  // account is still a valid link.
  const accountOptions = useMemo(() => {
    const closed: LookupOption[] = [];
    const keep = (id: number | null | undefined, name: string | null | undefined) => {
      if (id == null || name == null) return;
      if (accounts.some((a) => a.id === id) || closed.some((a) => a.id === id)) return;
      closed.push({ id, name: `${name} (closed)` });
    };
    keep(template?.accountId, template?.accountName);
    keep(template?.relatedAccountId, template?.relatedAccountName);
    return closed.length === 0 ? accounts : [...accounts, ...closed];
  }, [accounts, template]);

  const [description, setDescription] = useState(template?.transactionDescription ?? "");
  const [amount, setAmount] = useState(template?.amount ?? "");
  const [accountId, setAccountId] = useState(template ? String(template.accountId) : "");
  const [relatedAccountId, setRelatedAccountId] = useState(
    template?.relatedAccountId != null ? String(template.relatedAccountId) : ""
  );
  const [transactionTypeId, setTransactionTypeId] = useState(
    template ? String(template.transactionTypeId) : ""
  );
  const [transactionCategoryId, setTransactionCategoryId] = useState(
    template ? String(template.transactionCategoryId) : ""
  );
  const [cadence, setCadence] = useState<Cadence>(template?.cadence ?? "monthly");
  const [intervalCount, setIntervalCount] = useState(String(template?.intervalCount ?? 1));
  const [nextRunDate, setNextRunDate] = useState(template?.nextRunDate ?? today);
  const [endDate, setEndDate] = useState(template?.endDate ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  const every = Number(intervalCount);
  const unitItems = useMemo(
    () =>
      Object.fromEntries(
        CADENCES.map((c) => [c, cadenceUnit(c, Number.isInteger(every) && every > 0 ? every : 2)])
      ) as Record<Cadence, string>,
    [every]
  );

  const preview = previewSchedule({
    cadence,
    intervalCount,
    nextRunDate,
    endDate,
    isActive,
    stored: template
      ? {
          cadence: template.cadence,
          intervalCount: template.intervalCount,
          anchorDate: template.anchorDate,
          nextRunDate: template.nextRunDate,
          isActive: template.isActive,
        }
      : null,
    today,
  });

  // The line under the schedule changes on every key typed into a date or the
  // interval. A screen reader is told only once typing pauses, through its own
  // status region, so it doesn't read out each half-typed schedule.
  const sentence = previewSentence(preview);
  const [announced, setAnnounced] = useState(sentence);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(sentence), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sentence]);

  useEffect(() => {
    if (!state.message) return;
    if (state.success) {
      toast.success(state.message);
      onOpenChange(false);
    } else {
      toast.error(state.message);
    }
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit recurring transaction" : "Add recurring transaction"}</DialogTitle>
          <DialogDescription>
            Each scheduled date adds a transaction with these details. Changes
            apply to dates still to come. Transactions already added stay as
            they are.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" aria-label={isEdit ? "Edit recurring transaction" : "Add recurring transaction"}>
          {template && (
            <>
              <input type="hidden" name="recurringTransactionId" value={template.recurringTransactionId} />
              {/* The next date this dialog opened with. If the hourly check
                  moves the template on while it's open, a next date left as
                  it was still counts as unchanged, so the save doesn't
                  re-anchor the schedule (AC23). */}
              <input type="hidden" name="loadedNextRunDate" value={template.nextRunDate} />
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="rt-description">Description *</Label>
            <Input
              id="rt-description"
              name="transactionDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoComplete="off"
              aria-invalid={state.errors.transactionDescription ? true : undefined}
            />
            <FieldError errors={state.errors.transactionDescription} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-amount">Amount *</Label>
            <input type="hidden" name="amount" value={amount} />
            <CurrencyInput
              id="rt-amount"
              value={amount}
              onChange={setAmount}
              autoComplete="off"
              aria-invalid={state.errors.amount ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Signed as for a transaction: negative for money out of the account.
            </p>
            <FieldError errors={state.errors.amount} />
          </div>

          <ComboboxField
            label="Account"
            name="accountId"
            options={accountOptions}
            value={accountId}
            onChange={setAccountId}
            required
            error={state.errors.accountId}
          />

          <ClearableComboboxField
            label="Related Account"
            name="relatedAccountId"
            options={accountOptions}
            value={relatedAccountId}
            onChange={setRelatedAccountId}
            error={state.errors.relatedAccountId}
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            For a transfer, add one recurring transaction for each account, as
            you do for transactions.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ComboboxField
              label="Transaction Type"
              name="transactionTypeId"
              options={types}
              value={transactionTypeId}
              onChange={setTransactionTypeId}
              required
              error={state.errors.transactionTypeId}
            />
            <ComboboxField
              label="Category"
              name="transactionCategoryId"
              options={categories}
              value={transactionCategoryId}
              onChange={setTransactionCategoryId}
              required
              error={state.errors.transactionCategoryId}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Repeats every *</legend>
            <div className="flex gap-2">
              <Input
                id="rt-interval"
                name="intervalCount"
                aria-label="Number of units between dates"
                inputMode="numeric"
                className="w-20"
                value={intervalCount}
                onChange={(e) => setIntervalCount(e.target.value)}
                autoComplete="off"
                aria-invalid={state.errors.intervalCount ? true : undefined}
              />
              <input type="hidden" name="cadence" value={cadence} />
              <Select items={unitItems} value={cadence} onValueChange={(val) => val && setCadence(val as Cadence)}>
                <SelectTrigger id="rt-cadence" aria-label="Unit" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {unitItems[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FieldError errors={state.errors.intervalCount ?? state.errors.cadence} />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rt-next">Next date *</Label>
              <Input
                id="rt-next"
                name="nextRunDate"
                type="date"
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
                aria-invalid={state.errors.nextRunDate ? true : undefined}
              />
              <FieldError errors={state.errors.nextRunDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rt-end">Ends</Label>
              <Input
                id="rt-end"
                name="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-invalid={state.errors.endDate ? true : undefined}
              />
              <FieldError errors={state.errors.endDate} />
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input type="hidden" name="isActive" value={isActive ? "true" : "false"} />
              <input
                id="rt-active"
                type="checkbox"
                className="size-4 accent-primary"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <Label htmlFor="rt-active">Active</Label>
            </div>
          )}

          {/* Hidden from screen readers, which read the status below instead:
              the same sentence, once typing pauses. */}
          <p className="text-sm text-muted-foreground" data-testid="rt-preview" aria-hidden="true">
            {sentence}
          </p>
          <p role="status" className="sr-only">
            {announced}
          </p>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
