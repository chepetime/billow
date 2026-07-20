import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed Billow metadata.");
}

const pool = new Pool({ connectionString });

const billowMetadata = {
  appId: "sparkles-billow",
  name: "Billow",
  tagline: "Personal invoices without the spreadsheet drift.",
  version: "0.1.6",
  dockerImage: "ghcr.io/chepetime/billow:v0.1.6",
  repositoryUrl: "https://github.com/getumbrel/umbrel-community-app-store",
  supportUrl: "https://github.com/getumbrel/umbrel-community-app-store/issues",
};

await pool.query(
  `
    INSERT INTO "AppMetadata" (
      "appId",
      "name",
      "tagline",
      "version",
      "dockerImage",
      "repositoryUrl",
      "supportUrl",
      "updatedAt"
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT ("appId")
    DO UPDATE SET
      "name" = EXCLUDED."name",
      "tagline" = EXCLUDED."tagline",
      "version" = EXCLUDED."version",
      "dockerImage" = EXCLUDED."dockerImage",
      "repositoryUrl" = EXCLUDED."repositoryUrl",
      "supportUrl" = EXCLUDED."supportUrl",
      "updatedAt" = NOW()
  `,
  [
    billowMetadata.appId,
    billowMetadata.name,
    billowMetadata.tagline,
    billowMetadata.version,
    billowMetadata.dockerImage,
    billowMetadata.repositoryUrl,
    billowMetadata.supportUrl,
  ],
);

const existingProfiles = await pool.query(`SELECT COUNT(*)::int AS count FROM "UserProfile"`);

if (existingProfiles.rows[0]?.count === 0) {
  const userProfile = await pool.query(
    `
      INSERT INTO "UserProfile" (
        "displayName",
        "legalName",
        "email",
        "taxId",
        "address",
        "department",
        "manager",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING "id"
    `,
    [
      "Jose",
      "José Manuel Gulias Lugo",
      "chepe.time@gmail.com",
      "GULM92110985A",
      "Calle Orozco y Berra 4 int. 4, CP 06350, Colonia Buenavista, Alcaldía Cuauhtémoc, Mexico City, Mexico",
      "Engineering",
      "Richard Phan",
    ],
  );

  const bankAccount = await pool.query(
    `
      INSERT INTO "BankAccount" (
        "userProfileId",
        "label",
        "bankName",
        "bankAddress",
        "bankPhone",
        "accountHolderName",
        "accountHolderAddress",
        "accountNumber",
        "accountType",
        "swift",
        "clabe",
        "isDefault",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NOW())
      RETURNING "id"
    `,
    [
      userProfile.rows[0].id,
      "HSBC Mexico",
      "HSBC México, S.A.",
      "Paseo de la Reforma 347, Col. Cuauhtemoc, Cuauhtemoc 06500, CDMX, Mexico",
      "800 712 4825",
      "José Manuel Gulias Lugo",
      "Calle Orozco y Berra 4 int. 4, CP 06350, Colonia Buenavista, Alcaldía Cuauhtémoc, Mexico City, Mexico",
      "021180040669226595",
      "Checking",
      "BIMEMXMM",
      "021180040669226595",
    ],
  );

  const clientCompany = await pool.query(
    `
      INSERT INTO "ClientCompany" (
        "name",
        "legalName",
        "address1",
        "address2",
        "cityStatePostal",
        "country",
        "email",
        "attentionTo",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING "id"
    `,
    [
      "Change.org, PBC",
      "Change.org, PBC",
      "548 Market Street, #2993",
      "Attn: Accounts Payable",
      "San Francisco, CA 94104",
      "United States",
      "ap@change.org",
      "Accounts Payable",
    ],
  );

  const invoice = await pool.query(
    `
      INSERT INTO "Invoice" (
        "invoiceNumber",
        "invoiceDate",
        "status",
        "currency",
        "userProfileId",
        "bankAccountId",
        "clientCompanyId",
        "updatedAt"
      )
      VALUES ($1, $2, 'DRAFT', 'MXN', $3, $4, $5, NOW())
      RETURNING "id"
    `,
    [
      63,
      "2026-07-31T00:00:00.000Z",
      userProfile.rows[0].id,
      bankAccount.rows[0].id,
      clientCompany.rows[0].id,
    ],
  );

  const lineItems = [
    ["Monthly Salary", 1, 192313],
    ["Healthcare support for private healthcare", 1, 2000],
    ["Pension support", 1, 3846.26],
    ["Accounting support", 1, 1000],
    ["Hardware support", 1, 540],
    ["End of year support", 1, 7396.65],
  ];

  for (const [index, item] of lineItems.entries()) {
    const [description, quantity, rate] = item;
    await pool.query(
      `
        INSERT INTO "InvoiceLineItem" (
          "invoiceId",
          "description",
          "quantity",
          "rate",
          "amount",
          "position",
          "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [
        invoice.rows[0].id,
        description,
        quantity,
        rate,
        Number(quantity) * Number(rate),
        index,
      ],
    );
  }

  await pool.query(
    `
      INSERT INTO "InvoiceRevision" (
        "invoiceId",
        "revisionNumber",
        "editor",
        "summary",
        "payload"
      )
      VALUES ($1, 1, 'seed', 'Created seed invoice.', $2)
    `,
    [
      invoice.rows[0].id,
      JSON.stringify({
        invoiceNumber: 63,
        source: "prisma/seed.mjs",
      }),
    ],
  );
}

await pool.end();
