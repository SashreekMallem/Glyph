import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ExtractedFieldsPanel,
  humanizeKey,
  isEaseContainer,
} from "./ExtractedFieldsPanel";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("humanizeKey", () => {
  it("converts EASE paths to human labels", () => {
    expect(humanizeKey("experience/item_0002/title")).toBe(
      "Experience › Item 2 › Title",
    );
  });

  it("strips technical prefixes", () => {
    expect(humanizeKey("experience/__ease__")).toBe("Experience");
    expect(humanizeKey("experience/display_order")).toBe("Experience");
  });

  it("title-cases snake_case keys", () => {
    expect(humanizeKey("contact_info/phone_number")).toBe(
      "Contact Info › Phone Number",
    );
  });

  it("renders single segment", () => {
    expect(humanizeKey("name")).toBe("Name");
  });

  it("returns empty string for empty path", () => {
    expect(humanizeKey("")).toBe("");
  });
});

describe("isEaseContainer", () => {
  it("recognizes EASE containers", () => {
    expect(
      isEaseContainer({ __ease__: true, display_order: ["item_0001"] }),
    ).toBe(true);
  });

  it("rejects plain objects", () => {
    expect(isEaseContainer({ foo: "bar" })).toBe(false);
    expect(isEaseContainer(null)).toBe(false);
    expect(isEaseContainer([])).toBe(false);
  });
});

describe("<ExtractedFieldsPanel>", () => {
  it("returns no DOM when ease is null", () => {
    const html = render(<ExtractedFieldsPanel ease={null} />);
    expect(html).toBe("");
  });

  it("shows placeholder when ease is empty", () => {
    const html = render(<ExtractedFieldsPanel ease={{}} />);
    expect(html).toContain("No fields extracted yet");
  });

  it("renders flat key/value rows", () => {
    const html = render(
      <ExtractedFieldsPanel ease={{ name: "Alice", age: 30, active: true }} />,
    );
    expect(html).toContain("Name");
    expect(html).toContain("Alice");
    expect(html).toContain("Age");
    expect(html).toContain("30");
    expect(html).toContain("Active");
    // boolean true → check mark
    expect(html).toContain("✓");
  });

  it("respects display_order in EASE arrays and renders Item N labels", () => {
    const ease = {
      experience: {
        __ease__: true,
        display_order: ["item_0002", "item_0001"],
        item_0001: { title: "Engineer" },
        item_0002: { title: "Designer" },
      },
    };
    const html = render(<ExtractedFieldsPanel ease={ease} />);
    // display_order is item_0002 first, then item_0001
    const idx2 = html.indexOf("Designer");
    const idx1 = html.indexOf("Engineer");
    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeLessThan(idx1);
    expect(html).toContain("Item 1");
    expect(html).toContain("Item 2");
    // The item_NNNN technical prefix should not leak through anywhere as
    // the literal "item_0001" string in user-facing labels.
    expect(html).not.toContain("item_0001");
  });

  it("truncates long string values via title attribute", () => {
    const long = "a".repeat(120);
    const html = render(<ExtractedFieldsPanel ease={{ summary: long }} />);
    expect(html).toContain('title="' + long + '"');
    expect(html).toContain("text-ellipsis");
  });

  it("prefers field.value when shape is annotated", () => {
    const ease = {
      title: { value: "Hello world", text_span: { start: 0, end: 11 } },
    };
    const html = render(<ExtractedFieldsPanel ease={ease} />);
    expect(html).toContain("Hello world");
    // The annotated wrapper key 'text_span' should not bleed through
    // as a label in the output.
    expect(html).not.toContain("Text Span");
  });

  it("renders booleans as ✓/✗", () => {
    const html = render(
      <ExtractedFieldsPanel ease={{ remote: false, fulltime: true }} />,
    );
    expect(html).toContain("✗");
    expect(html).toContain("✓");
  });

  it("shows streaming pulse when isStreaming is true", () => {
    const html = render(
      <ExtractedFieldsPanel ease={{ name: "x" }} isStreaming />,
    );
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Extracting");
  });

  it("renders arrays of primitives as comma-separated", () => {
    const html = render(
      <ExtractedFieldsPanel ease={{ tags: ["react", "typescript", "node"] }} />,
    );
    expect(html).toContain("react, typescript, node");
  });
});
