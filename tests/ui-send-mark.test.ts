import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("approved send PNG bytes and intrinsic ratio remain unchanged", () => {
  const png = readFileSync(new URL("../src/assets/user-mark.png", import.meta.url));
  assert.equal(createHash("sha256").update(png).digest("hex"), "b8296fa14dc2f9c3e889e9dcd9d8677be1fc9ada57b1f46edfea2ed7dd8a9d96");
  assert.equal(png.readUInt32BE(16), 988);
  assert.equal(png.readUInt32BE(20), 789);
});

test("send actions retain accessible names and original-ratio disabled/focus presentation", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/ui-v5.css", import.meta.url), "utf8");
  for (const role of ["follow-up-send", "direct-question-send"]) {
    assert.match(html, new RegExp(`<button[^>]*data-role="${role}"[^>]*aria-label="(?:发送|提问)"[^>]*type="submit"[^>]*disabled`));
  }
  assert.match(css, /\.ai-send-mark::after\s*\{[^}]*width:\s*28px;[^}]*height:\s*auto;[^}]*aspect-ratio:\s*988\s*\/\s*789;/);
  assert.match(css, /\.ai-send-mark:disabled\s*\{[^}]*background:\s*#e4e4e4/);
  assert.match(css, /\.ai-send-mark:focus-visible\s*\{[^}]*outline:\s*2px/);
});
