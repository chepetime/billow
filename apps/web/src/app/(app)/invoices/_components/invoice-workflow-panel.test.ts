import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./invoice-workflow-panel.tsx", import.meta.url),
  "utf8",
);

describe("InvoiceWorkflowPanel inputs", () => {
  it("controls Base UI inputs whose saved values can change after a refresh", () => {
    const inputsWithDefaultValues = source.match(
      /<Input\b(?:(?!\/>)[\s\S])*?\bdefaultValue=/g,
    );

    expect(inputsWithDefaultValues).toBeNull();
  });
});
