import assert from "node:assert/strict";
import test from "node:test";

import { showModule, type ModuleViews } from "../src/views.ts";

class FakeClassList {
  private readonly values = new Set<string>();

  constructor(initial: readonly string[] = []) {
    for (const value of initial) this.values.add(value);
  }

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  readonly classList: FakeClassList;

  constructor(classes: readonly string[] = []) {
    this.classList = new FakeClassList(classes);
  }
}

function makeViews(): ModuleViews {
  return {
    writing: new FakeElement() as unknown as HTMLElement,
    files: new FakeElement(["hidden"]) as unknown as HTMLElement,
    settings: new FakeElement(["hidden"]) as unknown as HTMLElement,
  };
}

test("showModule activates exactly one module at a time", () => {
  const views = makeViews();

  showModule(views, "files");
  assert.equal(views.writing.classList.contains("hidden"), true);
  assert.equal(views.files.classList.contains("hidden"), false);
  assert.equal(views.settings.classList.contains("hidden"), true);

  showModule(views, "settings");
  assert.equal(views.writing.classList.contains("hidden"), true);
  assert.equal(views.files.classList.contains("hidden"), true);
  assert.equal(views.settings.classList.contains("hidden"), false);

  showModule(views, "writing");
  assert.equal(views.writing.classList.contains("hidden"), false);
  assert.equal(views.files.classList.contains("hidden"), true);
  assert.equal(views.settings.classList.contains("hidden"), true);
});
