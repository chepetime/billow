import { NextResponse } from "next/server";

import {
  isAppMetadataDatabaseAvailable,
  listAppMetadata,
} from "@/lib/app-metadata";

export const dynamic = "force-dynamic";

export async function GET() {
  const metadata = await listAppMetadata();
  const databaseAvailable = await isAppMetadataDatabaseAvailable();

  return NextResponse.json({
    metadata,
    databaseAvailable,
  });
}
