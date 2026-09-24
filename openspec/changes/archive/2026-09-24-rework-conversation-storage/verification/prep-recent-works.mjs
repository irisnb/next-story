// 准备最近作品条目：备份原文件，把测试作品置顶写入（去重）。
// 用法：node prep-recent-works.mjs <recent-works.json 路径> <名称> <作品路径>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const [file, name, projectPath] = process.argv.slice(2);
if (!file || !name || !projectPath) {
  console.error("usage: node prep-recent-works.mjs <file> <name> <path>");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error("recent-works.json 不存在:", file);
  process.exit(1);
}
const backup = file + ".backup-20260925";
if (!existsSync(backup)) copyFileSync(file, backup);
const list = JSON.parse(readFileSync(file, "utf8"));
const rest = list.filter((e) => e && e.path !== projectPath);
rest.unshift({ name, path: projectPath, last_opened_at: new Date().toISOString() });
writeFileSync(file, JSON.stringify(rest, null, 2));
console.log("OK entries=" + rest.length + " backup=" + backup);
