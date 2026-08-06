"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@billow/shadcn/components/native-select";
import { Textarea } from "@billow/shadcn/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { DeleteRecordButton } from "@/app/(app)/_components/delete-record-button";
import { Field } from "@/components/ui/field";
import {
  createInvoice,
  deleteInvoice,
  updateInvoice,
} from "@/lib/actions/invoices";
import { formatCurrency } from "@/lib/format";
import { notifySuccess } from "@/lib/notify";
import {
  CURRENCIES,
  type InvoiceFormValues,
  type InvoiceInput,
  invoiceSchema,
  lineItemAmount,
} from "@/lib/schemas/workspace";
import type { InvoiceFormOptions } from "@/lib/workspace-records";

const STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
] as const;

const EMPTY_LINE_ITEM = {
  description: "",
  note: "",
  quantity: 1,
  rate: 0,
};

/** A number that arrived from a form control, for display only. */
function asNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function InvoiceForm({
  id,
  options,
  defaultValues,
}: {
  id?: number;
  options: InvoiceFormOptions;
  defaultValues: InvoiceFormValues;
}) {
  const router = useRouter();
  const [requestError, setRequestError] = useState<string | null>(null);

  const form = useForm<InvoiceFormValues, unknown, InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues,
  });

  // An invoice saved with a currency that is no longer in the picker still has
  // to open without being quietly rewritten. A `<select>` whose value matches
  // no option falls back to the first one, so the stored code is added to the
  // list. It fails validation on save, which is the honest outcome: the user
  // is told to choose, rather than having MXN written over their EUR invoice.
  const storedCurrency = defaultValues.currency;
  const currencyOptions =
    typeof storedCurrency === "string" &&
    !(CURRENCIES as readonly string[]).includes(storedCurrency)
      ? [storedCurrency, ...CURRENCIES]
      : CURRENCIES;

  const lineItems = useFieldArray({
    control: form.control,
    name: "lineItems",
  });

  // Watched rather than read from `getValues` so the running total re-renders
  // as the user types. This is the number they check before sending.
  const watchedItems = useWatch({ control: form.control, name: "lineItems" });
  const currency = useWatch({ control: form.control, name: "currency" });

  const rows = (watchedItems ?? []).map((item) =>
    lineItemAmount(asNumber(item?.quantity), asNumber(item?.rate)),
  );
  const total =
    rows.reduce((sum, amount) => sum + Math.round(amount * 100), 0) / 100;

  async function save(values: InvoiceInput) {
    setRequestError(null);

    // Split rather than a ternary: only the create path returns an id, and
    // collapsing the two makes that id `| undefined` at the one call site
    // that needs it.
    if (id !== undefined) {
      const result = await updateInvoice(id, values);
      if (!result.ok) {
        setRequestError(result.error);
        return;
      }

      notifySuccess("Invoice saved");
      router.push(`/invoices/${id}`);
    } else {
      const result = await createInvoice(values);
      if (!result.ok) {
        setRequestError(result.error);
        return;
      }

      notifySuccess("Invoice created");
      router.push(`/invoices/${result.data.id}`);
    }

    router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(save)} noValidate>
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-base font-semibold">Details</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Invoice number"
            htmlFor="invoiceNumber"
            error={form.formState.errors.invoiceNumber?.message}
          >
            <Input
              id="invoiceNumber"
              type="number"
              inputMode="numeric"
              aria-invalid={Boolean(form.formState.errors.invoiceNumber)}
              {...form.register("invoiceNumber")}
            />
          </Field>

          <Field
            label="Invoice date"
            htmlFor="invoiceDate"
            error={form.formState.errors.invoiceDate?.message}
          >
            <Input
              id="invoiceDate"
              type="date"
              aria-invalid={Boolean(form.formState.errors.invoiceDate)}
              {...form.register("invoiceDate")}
            />
          </Field>

          <Field
            label="Currency"
            htmlFor="currency"
            error={form.formState.errors.currency?.message}
          >
            <NativeSelect
              className="w-full"
              id="currency"
              {...form.register("currency")}
            >
              {currencyOptions.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {code}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field
            label="Status"
            htmlFor="status"
            error={form.formState.errors.status?.message}
          >
            <NativeSelect
              className="w-full"
              id="status"
              {...form.register("status")}
            >
              {STATUSES.map((status) => (
                <NativeSelectOption key={status.value} value={status.value}>
                  {status.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-base font-semibold">Parties</h2>

        <Field
          label="Sender"
          htmlFor="userProfileId"
          error={form.formState.errors.userProfileId?.message}
        >
          <NativeSelect
            className="w-full"
            id="userProfileId"
            {...form.register("userProfileId")}
          >
            {options.profiles.map((profile) => (
              <NativeSelectOption key={profile.id} value={profile.id}>
                {profile.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Client"
          htmlFor="clientCompanyId"
          error={form.formState.errors.clientCompanyId?.message}
        >
          <NativeSelect
            className="w-full"
            id="clientCompanyId"
            {...form.register("clientCompanyId")}
          >
            {options.clients.map((client) => (
              <NativeSelectOption key={client.id} value={client.id}>
                {client.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Bank account"
          htmlFor="bankAccountId"
          error={form.formState.errors.bankAccountId?.message}
        >
          <NativeSelect
            className="w-full"
            id="bankAccountId"
            {...form.register("bankAccountId")}
          >
            {options.accounts.map((account) => (
              <NativeSelectOption key={account.id} value={account.id}>
                {account.label} · {account.bankName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Line items</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => lineItems.append({ ...EMPTY_LINE_ITEM })}
          >
            Add line
          </Button>
        </div>

        {form.formState.errors.lineItems?.message && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.lineItems.message}
          </p>
        )}

        <ul className="space-y-4">
          {lineItems.fields.map((field, index) => (
            <li
              key={field.id}
              className="space-y-3 rounded-lg border border-dashed p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_auto] sm:items-start">
                <Field
                  label="Description"
                  htmlFor={`lineItems.${index}.description`}
                  error={
                    form.formState.errors.lineItems?.[index]?.description
                      ?.message
                  }
                >
                  <Input
                    id={`lineItems.${index}.description`}
                    {...form.register(`lineItems.${index}.description`)}
                  />
                </Field>

                <Field
                  label="Qty"
                  htmlFor={`lineItems.${index}.quantity`}
                  error={
                    form.formState.errors.lineItems?.[index]?.quantity?.message
                  }
                >
                  <Input
                    id={`lineItems.${index}.quantity`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    {...form.register(`lineItems.${index}.quantity`)}
                  />
                </Field>

                <Field
                  label="Rate"
                  htmlFor={`lineItems.${index}.rate`}
                  error={
                    form.formState.errors.lineItems?.[index]?.rate?.message
                  }
                >
                  <Input
                    id={`lineItems.${index}.rate`}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    {...form.register(`lineItems.${index}.rate`)}
                  />
                </Field>

                <div className="flex items-end gap-2 sm:pt-6">
                  <span className="min-w-24 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(rows[index] ?? 0, currency)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => lineItems.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <Field
                label="Note"
                htmlFor={`lineItems.${index}.note`}
                error={form.formState.errors.lineItems?.[index]?.note?.message}
              >
                <Input
                  id={`lineItems.${index}.note`}
                  placeholder="Optional, printed under the description"
                  {...form.register(`lineItems.${index}.note`)}
                />
              </Field>
            </li>
          ))}
        </ul>

        {lineItems.fields.length === 0 && (
          <p className="text-sm text-muted-foreground">
            An invoice needs at least one line.
          </p>
        )}

        <div className="flex items-center justify-between border-t pt-4 text-sm">
          <span className="font-medium">Total</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(total, currency)}
          </span>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <Field
          label="Notes"
          htmlFor="notes"
          hint="Printed at the bottom of the invoice."
          error={form.formState.errors.notes?.message}
        >
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </Field>
      </section>

      {requestError && (
        <p role="alert" className="text-sm text-destructive">
          {requestError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? "Saving..."
            : id
              ? "Save invoice"
              : "Create invoice"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(id ? `/invoices/${id}` : "/invoices")}
        >
          Cancel
        </Button>
        {id !== undefined && (
          <div className="ml-auto">
            <DeleteRecordButton
              label="Delete invoice"
              successMessage="Invoice deleted"
              redirectTo="/invoices"
              onDelete={() => deleteInvoice(id)}
            />
          </div>
        )}
      </div>
    </form>
  );
}
