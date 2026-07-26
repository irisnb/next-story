import assert from "node:assert/strict";
import test from "node:test";

import { getCaretCoordinates, mirroredCaretStyleProperties } from "../src/caret-coordinates.ts";

test("caret mirror uses kebab-case CSS property names", () => {
  assert.ok(mirroredCaretStyleProperties.includes("box-sizing"));
  assert.ok(mirroredCaretStyleProperties.includes("border-top-width"));
  assert.ok(mirroredCaretStyleProperties.includes("line-height"));
  assert.ok(mirroredCaretStyleProperties.includes("tab-size"));
  assert.equal(mirroredCaretStyleProperties.some((name) => /[A-Z]/.test(name)), false);
});

test("caret mirror does not copy the whole textarea suffix for long text", () => {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const spanTexts: string[] = [];

  class FakeStyle {
    setProperty(_name: string, _value: string): void {}
  }

  class FakeElement {
    readonly tagName: string;

    constructor(tagName: string) {
      this.tagName = tagName;
    }

    readonly style = new FakeStyle();
    textContent = "";
    offsetTop = 0;
    offsetLeft = 0;

    appendChild(child: FakeElement): FakeElement {
      if (child.tagName === "span") {
        spanTexts.push(child.textContent);
      }
      return child;
    }

    removeChild(child: FakeElement): FakeElement {
      return child;
    }
  }

  const body = new FakeElement("body");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      body,
      createElement: (tagName: string) => new FakeElement(tagName),
    },
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({
      getPropertyValue: (property: string) => property === "line-height" || property === "font-size" ? "16" : "0",
    }),
  });

  try {
    getCaretCoordinates({
      value: `${"a".repeat(10)}${"b".repeat(10_000)}`,
      scrollTop: 0,
      scrollLeft: 0,
    } as HTMLTextAreaElement, 10);

    assert.deepEqual(spanTexts, ["."]);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: previousGetComputedStyle });
  }
});
