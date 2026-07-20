"use server";

import { revalidatePath } from "next/cache";

import {
  InvoiceStatus,
  type InvoiceStatus as InvoiceStatusValue,
} from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(formData: FormData, key: string) {
  const value = readString(formData, key);
  return value.length > 0 ? value : null;
}

function readInt(formData: FormData, key: string) {
  const value = Number.parseInt(readString(formData, key), 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }
  return value;
}

function readDecimal(formData: FormData, key: string) {
  const value = Number.parseFloat(readString(formData, key));
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a number.`);
  }
  return value;
}

function readInvoiceStatus(formData: FormData) {
  const status = readString(formData, "status") || InvoiceStatus.DRAFT;
  if (Object.values(InvoiceStatus).includes(status as InvoiceStatusValue)) {
    return status as InvoiceStatusValue;
  }

  throw new Error(`Unsupported invoice status: ${status}`);
}

function readInvoiceItems(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((position) => {
      const description = readString(formData, `itemDescription${position}`);
      if (!description) {
        return null;
      }

      const quantity = readDecimal(formData, `itemQuantity${position}`);
      const rate = readDecimal(formData, `itemRate${position}`);

      return {
        description,
        note: readOptionalString(formData, `itemNote${position}`),
        quantity,
        rate,
        amount: quantity * rate,
        position,
      };
    })
    .filter((item) => item !== null);
}

export async function createWorkspaceFromOnboarding(formData: FormData) {
  const prisma = getPrisma();
  const invoiceNumber = readInt(formData, "invoiceNumber");
  const invoiceDate = new Date(readString(formData, "invoiceDate"));
  const starterAmount = readDecimal(formData, "starterAmount");

  if (Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invoice date is required.");
  }

  await prisma.$transaction(async (tx) => {
    const userProfile = await tx.userProfile.create({
      data: {
        displayName: readString(formData, "displayName"),
        legalName: readString(formData, "legalName"),
        email: readString(formData, "email"),
        taxId: readOptionalString(formData, "taxId"),
        address: readString(formData, "address"),
        department: readOptionalString(formData, "department"),
        manager: readOptionalString(formData, "manager"),
      },
    });

    const bankAccount = await tx.bankAccount.create({
      data: {
        userProfileId: userProfile.id,
        label: readString(formData, "bankLabel") || "Primary",
        bankName: readString(formData, "bankName"),
        bankAddress: readOptionalString(formData, "bankAddress"),
        bankPhone: readOptionalString(formData, "bankPhone"),
        accountHolderName: readString(formData, "accountHolderName"),
        accountHolderAddress: readOptionalString(
          formData,
          "accountHolderAddress",
        ),
        accountNumber: readString(formData, "accountNumber"),
        accountType: readOptionalString(formData, "accountType"),
        institutionNumber: readOptionalString(formData, "institutionNumber"),
        transitNumber: readOptionalString(formData, "transitNumber"),
        routingNumber: readOptionalString(formData, "routingNumber"),
        swift: readOptionalString(formData, "swift"),
        iban: readOptionalString(formData, "iban"),
        clabe: readOptionalString(formData, "clabe"),
        isDefault: true,
      },
    });

    const clientCompany = await tx.clientCompany.create({
      data: {
        name: readString(formData, "clientName"),
        legalName: readOptionalString(formData, "clientLegalName"),
        address1: readString(formData, "clientAddress1"),
        address2: readOptionalString(formData, "clientAddress2"),
        cityStatePostal: readString(formData, "clientCityStatePostal"),
        country: readString(formData, "clientCountry"),
        email: readString(formData, "clientEmail"),
        attentionTo: readOptionalString(formData, "clientAttentionTo"),
      },
    });

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        invoiceDate,
        status: "DRAFT",
        currency: readString(formData, "currency") || "MXN",
        userProfileId: userProfile.id,
        bankAccountId: bankAccount.id,
        clientCompanyId: clientCompany.id,
        lineItems: {
          create: [
            {
              description:
                readString(formData, "starterDescription") ||
                "Monthly services",
              quantity: 1,
              rate: starterAmount,
              amount: starterAmount,
              position: 0,
            },
          ],
        },
      },
    });

    await tx.invoiceRevision.create({
      data: {
        invoiceId: invoice.id,
        revisionNumber: 1,
        editor: "onboarding",
        summary: "Created starter invoice during onboarding.",
        payload: {
          invoiceNumber,
          userProfileId: userProfile.id,
          bankAccountId: bankAccount.id,
          clientCompanyId: clientCompany.id,
        },
      },
    });
  });

  revalidatePath("/");
}

export async function createBankAccount(formData: FormData) {
  const prisma = getPrisma();
  const userProfileId = readInt(formData, "userProfileId");
  const makeDefault = readString(formData, "isDefault") === "on";

  await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.bankAccount.updateMany({
        where: { userProfileId },
        data: { isDefault: false },
      });
    }

    await tx.bankAccount.create({
      data: {
        userProfileId,
        label: readString(formData, "label"),
        bankName: readString(formData, "bankName"),
        bankAddress: readOptionalString(formData, "bankAddress"),
        bankPhone: readOptionalString(formData, "bankPhone"),
        accountHolderName: readString(formData, "accountHolderName"),
        accountHolderAddress: readOptionalString(
          formData,
          "accountHolderAddress",
        ),
        accountNumber: readString(formData, "accountNumber"),
        accountType: readOptionalString(formData, "accountType"),
        routingNumber: readOptionalString(formData, "routingNumber"),
        swift: readOptionalString(formData, "swift"),
        iban: readOptionalString(formData, "iban"),
        clabe: readOptionalString(formData, "clabe"),
        isDefault: makeDefault,
      },
    });
  });

  revalidatePath("/");
}

export async function createClientCompany(formData: FormData) {
  await getPrisma().clientCompany.create({
    data: {
      name: readString(formData, "name"),
      legalName: readOptionalString(formData, "legalName"),
      address1: readString(formData, "address1"),
      address2: readOptionalString(formData, "address2"),
      cityStatePostal: readString(formData, "cityStatePostal"),
      country: readString(formData, "country"),
      email: readString(formData, "email"),
      attentionTo: readOptionalString(formData, "attentionTo"),
      notes: readOptionalString(formData, "notes"),
    },
  });

  revalidatePath("/");
}

export async function createInvoice(formData: FormData) {
  const prisma = getPrisma();
  const invoiceNumber = readInt(formData, "invoiceNumber");
  const invoiceDate = new Date(readString(formData, "invoiceDate"));
  const lineItems = readInvoiceItems(formData);
  const status = readInvoiceStatus(formData);

  if (Number.isNaN(invoiceDate.getTime())) {
    throw new Error("Invoice date is required.");
  }

  if (lineItems.length === 0) {
    throw new Error("At least one line item is required.");
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      invoiceDate,
      status,
      currency: readString(formData, "currency") || "MXN",
      notes: readOptionalString(formData, "notes"),
      userProfileId: readInt(formData, "userProfileId"),
      bankAccountId: readInt(formData, "bankAccountId"),
      clientCompanyId: readInt(formData, "clientCompanyId"),
      lineItems: { create: lineItems },
    },
  });

  await prisma.invoiceRevision.create({
    data: {
      invoiceId: invoice.id,
      revisionNumber: 1,
      editor: "app",
      summary: "Created invoice.",
      payload: {
        invoiceNumber,
        status,
        lineItems,
      },
    },
  });

  revalidatePath("/");
}
