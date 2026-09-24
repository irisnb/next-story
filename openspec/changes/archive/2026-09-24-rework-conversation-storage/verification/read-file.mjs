// 通用文件读取打印（UTF-8）。用法：node read-file.mjs <路径>
import { readFileSync } from "node:fs";
console.log(readFileSync(process.argv[2], "utf8"));
