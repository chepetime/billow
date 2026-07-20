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

await pool.end();
