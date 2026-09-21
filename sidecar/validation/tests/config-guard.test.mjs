// config-guard.test.mjs — 验证配置不被生产路径默认启用的静态守卫（change: dsh-capability-integration-validation 任务 6.3；
// 禁用清单单一真相源见 change: add-agent-on-demand-reading 任务 1.4 / 设计 D14）
// 断言生产 cordis.driver.yaml 对危险工具默认拒绝（disabled:true），且生产 driver.mjs 不引入验证适配器/桥接。
// 期望的禁用清单来自 sidecar/driver/denied-capabilities.json（与 gen-config.mjs 的 DENY_IDS 同源，不再各自维护）。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORDIS_DRIVER = join(__dirname, "..", "..", "driver", "cordis.driver.yaml");
const DRIVER_MJS = join(__dirname, "..", "..", "driver", "driver.mjs");
const DENIED_CAPABILITIES = join(__dirname, "..", "..", "driver", "denied-capabilities.json");

// 单一真相源：装配禁用清单（gen-config.mjs 由此派生 DENY_IDS 生成 cordis.driver.yaml）。
const DENIED = JSON.parse(readFileSync(DENIED_CAPABILITIES, "utf8"));
const FORBIDDEN_IDS = DENIED.entries.map((entry) => entry.id);

test("6.3 生产 cordis.driver.yaml 对清单内危险工具/能力默认拒绝（disabled:true）", () => {
  const entries = yaml.load(readFileSync(CORDIS_DRIVER, "utf8"));
  assert.ok(Array.isArray(entries), "cordis.driver.yaml 应为条目数组");
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of FORBIDDEN_IDS) {
    const entry = byId.get(id);
    assert.ok(entry, `缺少默认拒绝条目：${id}`);
    assert.equal(entry.disabled, true, `${id} 必须 disabled:true`);
  }
});

test("6.3/5.1 生产驱动只注册受控只读故事工具四件套，不引入验证适配器/桥接", () => {
  const src = readFileSync(DRIVER_MJS, "utf8");
  assert.ok(!/adapter\.mjs|bridge\.mjs|validation\//.test(src), "driver.mjs 不得引用验证模块");
  // 任务 5.1（add-agent-on-demand-reading，设计 D2/D6）：生产驱动注册 Agent 工具面
  // 四件套，实现仅为协议桥接。红线从「不注册任何工具」收紧为「只注册四件套」：
  // 注册名单来自 STORY_TOOLS 常量，工具定义只经唯一的 bridge 工厂（defineTool
  // 单一调用点），不存在任何其它 .register 调用。
  assert.ok(
    src.includes('const STORY_TOOLS = ["story-list", "story-read", "story-search", "story-request-reading"];'),
    "工具注册名单必须来自 STORY_TOOLS 四件套常量",
  );
  assert.ok(
    (src.match(/\.register\(/g) ?? []).length === 1 && src.includes("agentCtx.tools.register(bridge(name))"),
    "唯一的工具注册点必须是 STORY_TOOLS 循环内的 bridge 工厂",
  );
  assert.ok(
    (src.match(/defineTool\(/g) ?? []).length === 1,
    "工具定义只允许单一 bridge 工厂调用点",
  );
});

test("6.3 只读作品工具名不出现在生产 cordis 配置（尚未接入生产路径）", () => {
  const text = readFileSync(CORDIS_DRIVER, "utf8");
  // Agent 工具面（D6）+ 系统自动取材保留名 story-snapshot。
  for (const name of ["story-list", "story-read", "story-search", "story-request-reading", "story-snapshot"]) {
    assert.ok(!text.includes(name), `生产 cordis 配置不得预置只读工具 ${name}`);
  }
});
