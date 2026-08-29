// gen-config.mjs：生成驱动脚本的静态容器配置 cordis.driver.yaml。
// 只含插件装配与默认拒绝清单；模型/端点等运行时参数由 driver.mjs 经 boot() 的
// patches 参数在内存中注入，不写进本文件。DSH 升级后重跑本脚本 + 回归测试。
import { writeFileSync, mkdirSync } from "node:fs";
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
const DENY_IDS = [
  "headless-runner", "headless-startup", "hmr",
  // 落盘相关（不落盘要求）
  "session-persistence-jsonl", "session-query-sqlite", "session-telemetry-otel",
  "spill-local", "spill-policy", "session-checkpoint-policy", "attachment-local",
  // 额外 LLM 调用（标题生成）
  "session-title", "session-title-llm",
  // 工具与执行
  "tool-bash", "tool-pwsh", "tool-jobs", "tool-fs", "tool-fs-search",
  "skill", "skill-filesystem", "tool-skill", "tool-todo", "tool-goal", "tool-ralph",
  "tool-str-replace-editor", "tool-web", "web", "web-search-deepseek",
  "subagent", "subagent-spawn-in-process", "subagent-fork-in-process",
  "tool-subagent-control", "tool-subagent-list-agents", "tool-subagent",
  "tool-subagent-fork", "tool-subagent-report", "workflow-worker-thread", "tool-workflow",
  "code-runtime", "subprocess", "bash-sandbox", "pwsh-sandbox",
  "sandbox", "sandbox-policy", "shell-env", "fs-sandbox", "fs-observation-policy",
  // 交互/命令/目标（无常驻宿主语义）
  "user-questions", "approval", "permission", "plan-mode", "commands", "command-feedback",
  "command-goal", "command-compact", "goal", "goal-round-driver", "jobs", "repeat-tool-reminder",
];

const entries = composeEntries([
  ...profile.layers.map((l) => l.patches),
  DENY_IDS.map((id) => ({ id, disabled: true })),
]);

const outPath = join(__dirname, "cordis.driver.yaml");
writeFileSync(outPath, yaml.dump(entries, { schema: entrySchema, noRefs: true }));
console.log(`WROTE ${outPath} (${entries.length} entries)`);
