import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * 源码卫生（change: unify-engineering-gates-and-docs，F14）。
 *
 * 源文件不得包含真实 NUL 字节：运行可以正常，但常规文本搜索（rg 等）会把文件
 * 判成二进制而整体跳过，审查与差异展示静默漏文件。需要 NUL 语义时必须使用
 * 可见转义 `\u0000`（先例：conversation-archive.ts 的复合键分隔符）。
 */

function typescriptFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFilesUnder(path));
    else if (entry.isFile() && extname(entry.name) === ".ts") files.push(path);
  }
  return files;
}

test("source tree contains no real NUL bytes", () => {
  const files = [...typescriptFilesUnder("src"), ...typescriptFilesUnder("tests")];
  assert.ok(files.length > 0, "扫描应覆盖到 src/ 与 tests/ 下的 TypeScript 文件");
  const offenders = files
    .map((file) => ({ file, offset: readFileSync(file).indexOf(0) }))
    .filter((entry) => entry.offset !== -1)
    .map((entry) => `${entry.file}@byte ${entry.offset}`);
  assert.deepEqual(
    offenders,
    [],
    `以下源码含真实 NUL 字节，应改为可见转义 \\u0000：${offenders.join(", ")}`,
  );
});
