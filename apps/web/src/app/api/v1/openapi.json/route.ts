import { NextResponse } from "next/server";

import { openApiDocument } from "@/lib/api/openapi";

export function GET() {
  return NextResponse.json(openApiDocument);
}
