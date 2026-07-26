"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";

export function ApiReference() {
  return (
    <ApiReferenceReact
      configuration={{
        spec: { url: "/api/v1/openapi.json" },
        metaData: { title: "Billow API Reference" },
        theme: "default",
      }}
    />
  );
}
