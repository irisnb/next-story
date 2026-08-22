// 编辑器「留白」：正文四周显示留白的预设档位与持久化。
// 纯显示偏好：只影响内容区 padding，不写入草稿本/正文本 JSON，也不进入 AI 选区快照。

import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

export type MarginPreset = "compact" | "standard" | "loose";

export const MARGIN_STORAGE_KEY = "next-story.margin-preset";
export const DEFAULT_MARGIN_PRESET: MarginPreset = "standard";

const MARGIN_PRESETS: readonly MarginPreset[] = ["compact", "standard", "loose"];

function isMarginPreset(value: string): value is MarginPreset {
  return (MARGIN_PRESETS as readonly string[]).includes(value);
}

/** 从存储字符串解析档位：非法或缺失回退默认档位。 */
export function parseMarginPreset(value: string | null): MarginPreset {
  return value !== null && isMarginPreset(value) ? value : DEFAULT_MARGIN_PRESET;
}

/** 循环到下一档：compact -> standard -> loose -> compact。 */
export function nextMarginPreset(current: MarginPreset): MarginPreset {
  const index = MARGIN_PRESETS.indexOf(current);
  return MARGIN_PRESETS[(index + 1) % MARGIN_PRESETS.length] ?? DEFAULT_MARGIN_PRESET;
}

/** 读取并校验持久化的档位；缺失/非法回退默认。 */
export function readMarginPreset(storage: StorageLike): MarginPreset {
  return parseMarginPreset(storage.getItem(MARGIN_STORAGE_KEY));
}

/** 写入档位到存储。 */
export function writeMarginPreset(storage: StorageLike, preset: MarginPreset): void {
  storage.setItem(MARGIN_STORAGE_KEY, preset);
}