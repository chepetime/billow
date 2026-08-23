#!/usr/bin/env node
/**
 * Dependency advisory check.
 *
 *   node scripts/audit-deps.mjs
 *
 * `pnpm audit` fails in some environments because the registry replies with
 * gzip that the runtime does not transparently decode ("Unexpected token" on
 * what is really `1f 8b 08`). This queries the same npm bulk advisory endpoint
 * and decompresses explicitly.
 *
 * Exits non-zero on high/critical advisories that are not acknowledged below.
 */
import fs from "node:fs";
import zlib from "node:zlib";

/**
 * Advisories we have traced and accepted, with the reason. Anything not listed
 * here fails the build, so this file is the record of what was reviewed.
 */
const ACKNOWLEDGED = {
  "find-my-way":
    "Reached only through @prisma/dev, Prisma's local dev server. We ship the prisma CLI to run migrate deploy and never start that server.",
  valibot:
    "Bundled by @hookform/resolvers and @prisma/dev. We use the zod resolver; no valibot schema is ever constructed.",
  postcss:
    "A stale 8.4.31 copy in the build toolchain. Build-time CSS only; not served at runtime.",
  "brace-expansion": "Lint and glob tooling; not part of the running app.",
  "deepmerge-ts":
    "Used only by @prisma/config while loading the repository-owned prisma.config.ts for CLI/build commands; no request or user-controlled object reaches this merge.",
};

const FAIL_ON = new Set(["high", "critical"]);

function packagesFromLockfile(path = "pnpm-lock.yaml") {
  const lines = fs.readFileSync(path, "utf8").split("\n");
  const found = {};
  let inPackages = false;

  for (const line of lines) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[a-z]/.test(line)) inPackages = false;
    if (!inPackages) continue;

    const match = line.match(/^ {2}(\S+?)@([0-9][^:(]*)(?:\([^)]*\))*:\s*$/);
    if (match) {
      const [, name, version] = match;
      found[name] ??= new Set();
      found[name].add(version);
    }
  }

  return Object.fromEntries(
    Object.entries(found).map(([name, versions]) => [name, [...versions]]),
  );
}

async function fetchAdvisories(packages) {
  const response = await fetch(
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packages),
    },
  );

  let buffer = Buffer.from(await response.arrayBuffer());
  // Decompress explicitly: some environments do not do it for us.
  if (buffer[0] === 0x1f && buffer[1] === 0x8b)
    buffer = zlib.gunzipSync(buffer);
  return JSON.parse(buffer.toString("utf8"));
}

const packages = packagesFromLockfile();
const advisories = await fetchAdvisories(packages);

const blocking = [];
const accepted = [];

for (const [name, entries] of Object.entries(advisories)) {
  for (const advisory of entries) {
    const row = {
      name,
      severity: advisory.severity,
      range: advisory.vulnerable_versions,
      title: advisory.title,
    };
    if (ACKNOWLEDGED[name]) accepted.push(row);
    else if (FAIL_ON.has(advisory.severity)) blocking.push(row);
    else accepted.push(row);
  }
}

console.log(
  `Checked ${Object.keys(packages).length} packages from the lockfile.\n`,
);

if (accepted.length) {
  console.log("Acknowledged:");
  for (const row of accepted) {
    console.log(`  ${row.severity.padEnd(8)} ${row.name} ${row.range}`);
    if (ACKNOWLEDGED[row.name])
      console.log(`           ${ACKNOWLEDGED[row.name]}`);
  }
  console.log("");
}

if (blocking.length) {
  console.error("Unreviewed high or critical advisories:");
  for (const row of blocking) {
    console.error(
      `  ${row.severity.padEnd(8)} ${row.name} ${row.range}  ${row.title}`,
    );
  }
  console.error(
    "\nFix the dependency, or add it to ACKNOWLEDGED in scripts/audit-deps.mjs with the reason it cannot be exploited here.",
  );
  process.exit(1);
}

console.log("No unreviewed high or critical advisories.");
