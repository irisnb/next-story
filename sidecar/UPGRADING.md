# DSH SDK 升级指南（sidecar/UPGRADING.md）

> 本文档是 `@deepseek-ai/dsh` 版本升级的正式流程，对应规格 `openspec/specs/sidecar-dependency-hygiene/spec.md`。
> 任何人在（或 AI 代理在）升级 DSH 前必读本文。

## overrides 与 DSH 版本是两回事（正交说明）

`sidecar/package.json` 里有两个互不干扰的部分：

```jsonc
{
  "dependencies": {
    "@deepseek-ai/dsh": "0.1.0-rc.7"   // ← 外包队本身：升级 = 改这一行，谁也不拦
  },
  "overrides": {
    "fast-uri": "^3.1.6",               // ← 分包商条款：只管 DSH 带进来的传递依赖，
    "js-yaml": "^4.3.2",                //    不限制 DSH 的版本选择
    "sharp": "^0.35.4",
    "hono": "^4.13.5",
    "qs": "^6.16.0"
  }
}
```

**钉版永远是范围（`^x.y.z`），不是死版本号。** 这是规格要求。含义：

- DSH 哪天自己声明的依赖范围已满足修复版 → 条款自动满足，不冲突；届时可删除多余条目（见下文第 4 步）。
- DSH 仍带旧包 → 条款继续兜底，警报不回潮。
- 删除任何 override 条目都是安全的、可逆的（改配置，不碰代码）。

## 五步升级流程

```
1. 改版本号    sidecar/package.json 中 @deepseek-ai/dsh 的版本号（只此一行）
2. 重建锁文件  删除 sidecar/package-lock.json，在 sidecar/ 内 npm install
3. 全量回归    仓库根目录依次跑：
                 npm run test:driver
                 npm run test:reliability
                 npm run test:validation
4. audit 复查  sidecar/ 内跑 npm audit，按结果处理：
                 新 DSH 自带修复版 → 删除多余 overrides 条目，再回第 2 步重建锁文件
                 新 DSH 仍带旧包   → 保留 overrides（预期行为，不用动）
                 出现新警报        → 有修复版：补一条范围钉版；
                                    无修复版：在下方「风险记录区」登记接受理由
5. 真实链路    sidecar/driver/ 内跑真实链路回归后合入：
                 $env:DEEPSEEK_API_KEY = <key>
                 node test-driver.mjs <api_base> <model>
```

第 3 步若失败：先确认失败是否与本次换包相关（sharp 换版最易暴露原生二进制问题）。若钉版导致冲突，可删除对应 override 行并在风险记录区登记接受理由，然后重走第 2 步。

## 当前 overrides 来源台账（2026-09-16 建立）

| 条目 | 钉版 | 来源警报（GitHub Advisory） | 清理条件 |
|---|---|---|---|
| `fast-uri` | `^3.1.6` | GHSA-5jgf-p345-68v8 / GHSA-f65p-4m7j-42xc / GHSA-fph4-wmhf-6fwf / GHSA-jqff-g426-hqxp（均 high） | DSH 声明范围 ≥3.1.6 |
| `js-yaml` | `^4.3.2` | GHSA-2883-xcg3-v3hh（high） | DSH 声明范围 ≥4.3.2 |
| `sharp` | `^0.35.4` | GHSA-rgj7-g3m4-5g8c（high，libheif 连带） | DSH 声明范围 ≥0.35.4 |
| `hono` | `^4.13.5` | GHSA-gqvv-2mrq-wpjv / GHSA-g6gw-c38x-mqfc / GHSA-crvj-82cr-hjcx（均 medium） | DSH 声明范围 ≥4.13.5 |
| `qs` | `^6.16.0` | GHSA-x5fp-wj9c-mxmx / GHSA-4mjr-xmp4-gh2g（均 medium） | DSH 声明范围 ≥6.16.0 |

> 背景：这些警报的漏洞路径（外部输入打 Web 框架 / SSRF / 图像解析）在当前架构下无外部触达面——sidecar 是本地无监听端口的 headless 进程，流量仅限用户自己的配置/内容与已鉴权的 LLM API 响应——评级高但实际风险中低。整备理由是地基债清零 + 阶段 6 动工前基线干净，而非存在现实攻击面。

## 风险记录区（无修复版警报登记处）

**使用规则**：当某传递依赖警报在 npm 生态暂无修复版可钉时，**必须**在此登记后方可接受——不登记就是违规（规格要求）。修复版发布后应复评并移除条目。

登记格式：

```text
- 包名：<name>
  警报：<GHSA 编号及等级>
  接受理由：<实际暴露面评估，为什么当前架构下可接受>
  复评条件：<何时重新评估，如「修复版发布后」/「sidecar 架构变化引入外部输入时」>
  登记日期：<YYYY-MM-DD>
```

**当前条目：无。**（2026-09-16 首次整备时 5/5 有修复版包全部钉版，无遗留。）
