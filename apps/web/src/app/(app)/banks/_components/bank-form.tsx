"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@billow/shadcn/components/native-select";
import { Textarea } from "@billow/shadcn/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { DeleteRecordButton } from "@/app/(app)/_components/delete-record-button";
import { Field } from "@/components/ui/field";
import {
  createBankAccount,
  deleteBankAccount,
  updateBankAccount,
} from "@/lib/actions/bank-accounts";
import { notifySuccess } from "@/lib/notify";
import {
  type BankAccountFormValues,
  type BankAccountInput,
  bankAccountSchema,
} from "@/lib/schemas/workspace";

type Sender = { id: number; displayName: string };

/**
 * The fields that only some banking systems use. Grouped rather than listed
 * inline so the form leads with the four that every account needs — an
 * invoice renders whichever of these are set and silently omits the rest.
 */
const CORRESPONDENT_FIELDS = [
  { name: "accountType", label: "Account type" },
  { name: "clabe", label: "CLABE" },
  { name: "swift", label: "SWIFT / BIC" },
  { name: "iban", label: "IBAN" },
  { name: "routingNumber", label: "Routing number" },
  { name: "institutionNumber", label: "Institution number" },
  { name: "transitNumber", label: "Transit number" },
] as const;

function emptyValues(senderId: number): BankAccountFormValues {
  return {
    userProfileId: senderId,
    label: "",
    bankName: "",
    accountHolderName: "",
    accountNumber: "",
    bankAddress: "",
    bankPhone: "",
    accountHolderAddress: "",
    accountType: "",
    institutionNumber: "",
    transitNumber: "",
    routingNumber: "",
    swift: "",
    iban: "",
    clabe: "",
    isDefault: false,
  };
}

export function BankForm({
  id,
  senders,
  defaultValues,
}: {
  id?: number;
  senders: Sender[];
  defaultValues?: BankAccountFormValues;
}) {
  const router = useRouter();
  const [requestError, setRequestError] = useState<string | null>(null);

  const form = useForm<BankAccountFormValues, unknown, BankAccountInput>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: defaultValues ?? emptyValues(senders[0]?.id ?? 0),
  });

  async function save(values: BankAccountInput) {
    setRequestError(null);

    const result = id
      ? await updateBankAccount(id, values)
      : await createBankAccount(values);

    if (!result.ok) {
      setRequestError(result.error);
      return;
    }

    notifySuccess(id ? "Bank account saved" : "Bank account added");
    router.push("/banks");
    router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(save)} noValidate>
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <Field
          label="Sender profile"
          htmlFor="userProfileId"
          hint="The account belongs to this sender."
          error={form.formState.errors.userProfileId?.message}
        >
          <NativeSelect
            className="w-full"
            id="userProfileId"
            aria-invalid={Boolean(form.formState.errors.userProfileId)}
            {...form.register("userProfileId")}
          >
            {senders.map((sender) => (
              <NativeSelectOption key={sender.id} value={sender.id}>
                {sender.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Label"
          htmlFor="label"
          hint="How you pick this account. For example, Primary account."
          error={form.formState.errors.label?.message}
        >
          <Input
            id="label"
            aria-invalid={Boolean(form.formState.errors.label)}
            {...form.register("label")}
          />
        </Field>

        <Field
          label="Bank name"
          htmlFor="bankName"
          error={form.formState.errors.bankName?.message}
        >
          <Input
            id="bankName"
            aria-invalid={Boolean(form.formState.errors.bankName)}
            {...form.register("bankName")}
          />
        </Field>

        <Field
          label="Account holder name"
          htmlFor="accountHolderName"
          hint="Encrypted at rest."
          error={form.formState.errors.accountHolderName?.message}
        >
          <Input
            id="accountHolderName"
            aria-invalid={Boolean(form.formState.errors.accountHolderName)}
            {...form.register("accountHolderName")}
          />
        </Field>

        <Field
          label="Account number"
          htmlFor="accountNumber"
          hint="Encrypted at rest, and masked outside the invoice."
          error={form.formState.errors.accountNumber?.message}
        >
          <Input
            id="accountNumber"
            aria-invalid={Boolean(form.formState.errors.accountNumber)}
            {...form.register("accountNumber")}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            {...form.register("isDefault")}
          />
          Use as the default account on new invoices
        </label>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Transfer details</h2>
          <p className="text-sm text-muted-foreground">
            Fill in whichever your bank uses. Empty ones are left off the
            invoice.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {CORRESPONDENT_FIELDS.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              htmlFor={field.name}
              error={form.formState.errors[field.name]?.message}
            >
              <Input id={field.name} {...form.register(field.name)} />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-base font-semibold">Addresses and contact</h2>

        <Field
          label="Account holder address"
          htmlFor="accountHolderAddress"
          hint="Encrypted at rest."
          error={form.formState.errors.accountHolderAddress?.message}
        >
          <Textarea
            id="accountHolderAddress"
            rows={2}
            {...form.register("accountHolderAddress")}
          />
        </Field>

        <Field
          label="Bank address"
          htmlFor="bankAddress"
          error={form.formState.errors.bankAddress?.message}
        >
          <Textarea
            id="bankAddress"
            rows={2}
            {...form.register("bankAddress")}
          />
        </Field>

        <Field
          label="Bank phone"
          htmlFor="bankPhone"
          error={form.formState.errors.bankPhone?.message}
        >
          <Input id="bankPhone" {...form.register("bankPhone")} />
        </Field>
      </section>

      {requestError && (
        <p role="alert" className="text-sm text-destructive">
          {requestError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving..." : "Save account"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/banks")}
        >
          Cancel
        </Button>
        {id !== undefined && (
          <div className="ml-auto">
            <DeleteRecordButton
              label="Delete account"
              successMessage="Bank account deleted"
              redirectTo="/banks"
              onDelete={() => deleteBankAccount(id)}
            />
          </div>
        )}
      </div>
    </form>
  );
}
