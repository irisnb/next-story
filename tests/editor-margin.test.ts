import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MARGIN_PRESET,
  MARGIN_STORAGE_KEY,
  nextMarginPreset,
  parseMarginPreset,
  readMarginPreset,
  writeMarginPreset,
  type MarginPreset,
} from "../src/editor-margin.ts";
import { memoryStorageFixture } from "./memory-storage-fixture.ts";

test("parseMarginPreset 缺失回退默认档位", () => {
  assert.equal(parseMarginPreset(null), DEFAULT_MARGIN_PRESET);
  assert.equal(DEFAULT_MARGIN_PRESET, "standard");
});

test("parseMarginPreset 合法档位原样返回", () => {
  assert.equal(parseMarginPreset("compact"), "compact");
  assert.equal(parseMarginPreset("standard"), "standard");
  assert.equal(parseMarginPreset("loose"), "loose");
});

test("parseMarginPreset 非法值回退默认档位", () => {
  assert.equal(parseMarginPreset("huge"), DEFAULT_MARGIN_PRESET);
  assert.equal(parseMarginPreset(""), DEFAULT_MARGIN_PRESET);
  assert.equal(parseMarginPreset(" STANDARD "), DEFAULT_MARGIN_PRESET);
});

test("nextMarginPreset 三档循环", () => {
  assert.equal(nextMarginPreset("compact"), "standard");
  assert.equal(nextMarginPreset("standard"), "loose");
  assert.equal(nextMarginPreset("loose"), "compact");
});

test("readMarginPreset 无键时回退默认", () => {
  const storage = memoryStorageFixture();
  assert.equal(readMarginPreset(storage), DEFAULT_MARGIN_PRESET);
});

test("readMarginPreset 读取已保存档位", () => {
  const storage = memoryStorageFixture({ [MARGIN_STORAGE_KEY]: "loose" });
  assert.equal(readMarginPreset(storage), "loose");
});

test("readMarginPreset 非法保存值回退默认", () => {
  const storage = memoryStorageFixture({ [MARGIN_STORAGE_KEY]: "bogus" });
  assert.equal(readMarginPreset(storage), DEFAULT_MARGIN_PRESET);
});

test("writeMarginPreset 写入指定键", () => {
  const storage = memoryStorageFixture();
  writeMarginPreset(storage, "compact");
  assert.equal(storage.data[MARGIN_STORAGE_KEY], "compact");

  writeMarginPreset(storage, "loose");
  assert.equal(storage.data[MARGIN_STORAGE_KEY], "loose");
});

test("write 后 read 恢复同一档位（往返一致）", () => {
  const storage = memoryStorageFixture();
  const presets: MarginPreset[] = ["compact", "standard", "loose"];
  for (const preset of presets) {
    writeMarginPreset(storage, preset);
    assert.equal(readMarginPreset(storage), preset);
  }
});