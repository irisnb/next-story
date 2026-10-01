// 编辑器「写作宽度」：稿纸列固定宽度居中的档位与持久化。
// 纯显示偏好：只影响正文列 max-width 居中呈现，不写入文档 JSON，也不进入 AI 选区快照。

import type { StorageLike } from "./shared-storage-and-selection-identity.ts";

export type ColumnWidthPreset = "narrow" | "standard" | "wide";

export const COLUMN_WIDTH_STORAGE_KEY = "next-story.column-width-preset";
export const DEFAULT_COLUMN_WIDTH_PRESET: ColumnWidthPreset = "standard";

const COLUMN_WIDTH_PRESETS: readonly ColumnWidthPreset[] = ["narrow", "standard", "wide"];

function isColumnWidthPreset(value: string): value is ColumnWidthPreset {
  return (COLUMN_WIDTH_PRESETS as readonly string[]).includes(value);
}

/** 从存储字符串解析档位：非法或缺失回退默认档位。 */
export function parseColumnWidthPreset(value: string | null): ColumnWidthPreset {
  return value !== null && isColumnWidthPreset(value) ? value : DEFAULT_COLUMN_WIDTH_PRESET;
}

/** 循环到下一档：narrow -> standard -> wide -> narrow。 */
export function nextColumnWidthPreset(current: ColumnWidthPreset): ColumnWidthPreset {
  const index = COLUMN_WIDTH_PRESETS.indexOf(current);
  return COLUMN_WIDTH_PRESETS[(index + 1) % COLUMN_WIDTH_PRESETS.length] ?? DEFAULT_COLUMN_WIDTH_PRESET;
}

/** 读取并校验持久化的档位；缺失/非法回退默认。 */
export function readColumnWidthPreset(storage: StorageLike): ColumnWidthPreset {
  return parseColumnWidthPreset(storage.getItem(COLUMN_WIDTH_STORAGE_KEY));
}

/** 写入档位到存储。 */
export function writeColumnWidthPreset(storage: StorageLike, preset: ColumnWidthPreset): void {
  storage.setItem(COLUMN_WIDTH_STORAGE_KEY, preset);
}
