// 在构建产物里查找字符串并打印上下文。用法：node find-in-bundle.mjs <目录> <字符串>
import { readFileSync, readdirSync } from "node:fs";
const [dir, needle] = process.argv.slice(2);
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".js")) continue;
  const s = readFileSync(`${dir}/${f}`, "utf8");
  let i = s.indexOf(needle);
  let count = 0;
  while (i !== -1 && count < 3) {
    console.log(`--- ${f} @${i} ---`);
    console.log(s.slice(Math.max(0, i - 300), i + 300).replace(/\n/g, "\\n"));
    console.log("");
    i = s.indexOf(needle, i + 1);
    count += 1;
  }
}
console.log("done");
