// dump-events.mjs：dump 一轮真实对话的完整事件结构，作为驱动脚本 seed 构造器的模板依据。
// 用法：$env:DEEPSEEK_API_KEY = <key>; node dump-events.mjs <api_base> <model>
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [apiBase, model] = process.argv.slice(2);
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiBase || !model || !apiKey) { console.error("usage: node dump-events.mjs <api_base> <model>"); process.exit(2); }

const home = join(__dirname, ".dump-home");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
process.env.DSH_HOME = home;
process.env.DEEPSEEK_API_KEY = apiKey;

const { loadProfile, composeEntries, boot } = await import("@deepseek-ai/dsh-app-boot");
const { installModelSelection } = await import("@deepseek-ai/dsh-agent");
const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
const { SessionId } = await import("@deepseek-ai/dsh-session");

const installAnchor = join(__dirname, "..", "node_modules", "@deepseek-ai", "dsh", "package.json");
const profile = loadProfile("dump", "headless", installAnchor, home, { userLayer: false });

const JsExpr = new yaml.Type("tag:yaml.org,2002:js", {
  kind: "scalar", resolve: (d) => typeof d === "string",
  construct: (d) => ({ __jsExpr: d }), represent: (d) => d["__jsExpr"],
});
const entrySchema = yaml.JSON_SCHEMA.extend(JsExpr);

const DENY_IDS = ["headless-runner", "headless-startup", "hmr",
  "session-persistence-jsonl", "session-query-sqlite", "session-telemetry-otel",
  "spill-local", "spill-policy", "session-checkpoint-policy", "attachment-local",
  "session-title", "session-title-llm",
  "tool-bash", "tool-pwsh", "tool-jobs", "tool-fs", "tool-fs-search",
  "skill", "skill-filesystem", "tool-skill", "tool-todo", "tool-goal", "tool-ralph",
  "tool-str-replace-editor", "tool-web", "web", "web-search-deepseek",
  "subagent", "subagent-spawn-in-process", "subagent-fork-in-process",
  "tool-subagent-control", "tool-subagent-list-agents", "tool-subagent",
  "tool-subagent-fork", "tool-subagent-report", "workflow-worker-thread", "tool-workflow",
  "code-runtime", "subprocess", "bash-sandbox", "pwsh-sandbox",
  "sandbox", "sandbox-policy", "shell-env", "fs-sandbox", "fs-observation-policy",
  "user-questions", "approval", "permission", "plan-mode", "commands", "command-feedback",
  "command-goal", "command-compact", "goal", "goal-round-driver", "jobs", "repeat-tool-reminder"];
const patches = [
  { id: "agent-default-model", config: { provider: "deepseek-official", model } },
  { id: "llm-deepseek", config: { baseURL: apiBase, thinking: "disabled" } },
  ...DENY_IDS.map((id) => ({ id, disabled: true })),
];
const entries = composeEntries([...profile.layers.map((l) => l.patches), patches]);
const configPath = join(__dirname, "cordis.dump.yaml");
writeFileSync(configPath, yaml.dump(entries, { schema: entrySchema, noRefs: true }));

const ctx = await boot("dump", configPath, []);
const agents = ctx.get("agents");
const defaultModel = ctx.get("agentDefaultModel");
const selection = defaultModel.currentSelection();

const handle = await agents.create({
  sessionId: SessionId(`session-${randomUUID()}`),
  meta: { cwd: __dirname },
  agentOptions: { provider: selection.provider, model: selection.model },
  setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }); },
});
const agent = handle.agent;

agent.followup(createUserMessage({ content: [{ type: "text", text: "用不超过20个字回答：1+1等于几？" }], source: { kind: "user" } }));
await agent.whenIdle();
agent.followup(createUserMessage({ content: [{ type: "text", text: "我上一条问了你什么？" }], source: { kind: "user" } }));
await agent.whenIdle();

const log = agent.session.events.map((e) => JSON.parse(JSON.stringify(e)));
writeFileSync(join(__dirname, "event-template.json"), JSON.stringify(log, null, 2));
console.log(`DUMPED ${log.length} events -> sidecar/probe/event-template.json`);
console.log("TYPES=" + log.map((e) => e.type).join(","));
await ctx.fiber.dispose();
process.exit(0);
