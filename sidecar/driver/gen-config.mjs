// gen-config.mjs：生成驱动脚本的静态容器配置 cordis.driver.yaml。
// 只含插件装配与默认拒绝清单；模型/端点等运行时参数由 driver.mjs 经 boot() 的
// patches 参数在内存中注入，不写进本文件。DSH 升级后重跑本脚本 + 回归测试。
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const home = join(__dirname, ".gen-home");
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;

const { loadProfile, composeEntries } = await import("@deepseek-ai/dsh-app-boot");

const installAnchor = join(__dirname, "..", "node_modules", "@deepseek-ai", "dsh", "package.json");
const profile = loadProfile("gen", "headless", installAnchor, home, { userLayer: false });

const JsExpr = new yaml.Type("tag:yaml.org,2002:js", {
  kind: "scalar", resolve: (d) => typeof d === "string",
  construct: (d) => ({ __jsExpr: d }), represent: (d) => d["__jsExpr"],
});
const entrySchema = yaml.JSON_SCHEMA.extend(JsExpr);

// 默认拒绝：工具/执行/网络/子代理/交互/落盘 全部不装载（capability_gateway 的
// FORBIDDEN_TOOL_IDS 整体不可达，清单扩充时自动覆盖）。
// 单一真相源（设计 D14，任务 1.4）：装配禁用清单来自 denied-capabilities.json，
// 其中 gateway=true 的子集与 Rust capability_gateway::FORBIDDEN_TOOL_IDS 由两端
// 契约测试双向钉死；修改清单只改该文件后重跑本脚本。
const DENIED = JSON.parse(readFileSync(join(__dirname, "denied-capabilities.json"), "utf8"));
const DENY_IDS = DENIED.entries.map((entry) => entry.id);

const entries = composeEntries([
  ...profile.layers.map((l) => l.patches),
  DENY_IDS.map((id) => ({ id, disabled: true })),
]);

const outPath = join(__dirname, "cordis.driver.yaml");
writeFileSync(outPath, yaml.dump(entries, { schema: entrySchema, noRefs: true }));
console.log(`WROTE ${outPath} (${entries.length} entries)`);
