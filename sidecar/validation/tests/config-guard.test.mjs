// config-guard.test.mjs — 验证配置不被生产路径默认启用的静态守卫（change: dsh-capability-integration-validation 任务 6.3）
// 断言生产 cordis.driver.yaml 对危险工具默认拒绝（disabled:true），且生产 driver.mjs 不引入验证适配器/桥接。
// 回滚本验证 change 只需移除验证配置与 fixture，不触碰生产 cordis 配置与驱动。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORDIS_DRIVER = join(__dirname, "..", "..", "driver", "cordis.driver.yaml");
const DRIVER_MJS = join(__dirname, "..", "..", "driver", "driver.mjs");

// 生产驱动必须默认拒绝的危险工具/能力行（文件、Shell、网络、子代理、代码执行、落盘）。
const FORBIDDEN_IDS = [
  "tool-fs", "tool-fs-search", "tool-bash", "tool-pwsh", "tool-jobs",
  "tool-web", "web", "web-search-deepseek", "tool-str-replace-editor",
  "tool-skill", "skill", "skill-filesystem", "tool-subagent", "tool-subagent-control",
  "tool-subagent-list-agents", "tool-subagent-fork", "tool-subagent-report", "subagent",
  "workflow-worker-thread", "tool-workflow", "code-runtime", "subprocess",
  "sandbox", "sandbox-policy", "bash-sandbox", "pwsh-sandbox", "shell-env",
  "fs-sandbox", "fs-observation-policy", "tool-goal", "tool-ralph",
  "session-persistence-jsonl", "session-query-sqlite", "session-telemetry-otel",
];

test("6.3 生产 cordis.driver.yaml 对危险工具/能力默认拒绝（disabled:true）", () => {
  const entries = yaml.load(readFileSync(CORDIS_DRIVER, "utf8"));
  assert.ok(Array.isArray(entries), "cordis.driver.yaml 应为条目数组");
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of FORBIDDEN_IDS) {
    const entry = byId.get(id);
    assert.ok(entry, `缺少默认拒绝条目：${id}`);
    assert.equal(entry.disabled, true, `${id} 必须 disabled:true`);
  }
});

test("6.3 生产驱动不注册任何工具、不引入验证适配器/桥接", () => {
  const src = readFileSync(DRIVER_MJS, "utf8");
  assert.ok(!/adapter\.mjs|bridge\.mjs|validation\//.test(src), "driver.mjs 不得引用验证模块");
  assert.ok(!/\.register\(/.test(src), "driver.mjs 不得注册工具");
});

test("6.3 只读作品工具名不出现在生产 cordis 配置（尚未接入生产路径）", () => {
  const text = readFileSync(CORDIS_DRIVER, "utf8");
  for (const name of ["story-list", "story-read", "story-snapshot"]) {
    assert.ok(!text.includes(name), `生产 cordis 配置不得预置只读工具 ${name}`);
  }
});
