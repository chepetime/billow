import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "./field";

// Rendered to static markup rather than mounted: these are assertions about
// which attributes land on which element, and that survives without a DOM.
function render(node: React.ReactElement) {
  return renderToStaticMarkup(node);
}

describe("Field", () => {
  it("associates the label with the control", () => {
    const html = render(
      <Field label="Name" htmlFor="name">
        <input id="name" />
      </Field>,
    );

    expect(html).toContain('for="name"');
    expect(html).toContain('id="name"');
  });

  it("points the control at its error message, not the wrapper", () => {
    const html = render(
      <Field label="Name" htmlFor="name" error="Name is required">
        <input id="name" aria-invalid="true" />
      </Field>,
    );

    // The description must hang off the input: a screen reader reads the
    // description of the focused element, so aria-describedby on a wrapping
    // <div> announces nothing.
    expect(html).toMatch(/<input[^>]*aria-describedby="name-error"/);
    expect(html).toContain('id="name-error"');
    expect(html).toContain('role="alert"');
  });

  it("points the control at its hint when there is no error", () => {
    const html = render(
      <Field label="Name" htmlFor="name" hint="As it appears on invoices">
        <input id="name" />
      </Field>,
    );

    expect(html).toMatch(/<input[^>]*aria-describedby="name-hint"/);
    expect(html).toContain('id="name-hint"');
  });

  it("prefers the error over the hint when both are present", () => {
    const html = render(
      <Field label="Name" htmlFor="name" error="Required" hint="Some hint">
        <input id="name" />
      </Field>,
    );

    expect(html).toMatch(/<input[^>]*aria-describedby="name-error"/);
    expect(html).not.toContain("Some hint");
  });

  it("keeps a caller's own aria-describedby instead of clobbering it", () => {
    const html = render(
      <Field label="Name" htmlFor="name" error="Required">
        <input id="name" aria-describedby="name-extra" />
      </Field>,
    );

    expect(html).toMatch(/<input[^>]*aria-describedby="name-extra name-error"/);
  });

  it("describes nothing when there is neither error nor hint", () => {
    const html = render(
      <Field label="Name" htmlFor="name">
        <input id="name" />
      </Field>,
    );

    expect(html).not.toContain("aria-describedby");
  });
});
