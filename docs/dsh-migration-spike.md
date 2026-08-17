# DSH 迁移 Spike 测试文档（完整参考版）

> 日期：2026-08-17
> 目的：验证 DeepSeek Harness（DSH）能否作为 Next Story 的后端引擎（headless sidecar），并**把踩过的坑连同根因和正确做法完整记录下来**，后续迁移时照做即可，不用再来回试。
> 结论：**可行**。

---

## 一、结论速览（TL;DR）

DSH 能当 Next Story 的后端引擎。完整链条已真机打通：

```
DSH 装好 → headless 跑通 → 交接 key → keyring 插件挂载（钥匙串读 key，无明文）
→ 真生成（质量对得上陪想）→ 追问成立 → 禁工具安全（写文件被拒）→ Rust sidecar 端到端 → 错误映射
```

迁移时最关键的 5 个坑（详见第四节）：① 凭据引用名不能带连字符；② keyring 插件挂载要用 `disabled + insert` 而非 `name` 覆盖；③ Rust spawn 要并发排空管道否则死锁；④ 绕开 `.cmd` shim 直接 spawn `node bin.js`；⑤ 超时要放宽（agent 思考模式慢）。

---

## 二、测试环境

| 项 | 值 |
|---|---|
| DSH 版本 | `@deepseek-ai/dsh@0.1.0-rc.7`（精确锁版，`latest`/`next` 都指向它） |
| Node | v24.15.0（DSH 要求 ≥ 22.19） |
| pnpm | v11.21.0（`dsh plugin` 内部转发给 pnpm） |
| 平台 | Windows（真机） |
| 嵌入方式 | `node <bin.js> --profile headless "<task>"` 一次性任务 |
| 凭据 | `dsh-credentials-keyring` 插件挂进 `ctx.credentials`，读 Windows 钥匙串 |
| 侧车目录 | `sidecar/`（`package.json` + `package-lock.json` 锁版，`node_modules` 已 gitignore） |
| Rust 侧 | `src-tauri/src/dsh_sidecar.rs`（`generate_via_dsh` + `map_dsh_failure`） |

关键路径速记：

| 路径 | 是什么 |
|---|---|
| `sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js` | DSH 真正的 CLI 入口（Rust 要直接 spawn 它） |
| `sidecar/node_modules/.bin/dsh.cmd` | npm 生成的 shim（**别 spawn 它**，见坑④） |
| `~/.dsh/profiles/headless/` | headless profile 目录（package.json + cordis.patch.yml） |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 我们改的 patch 层（挂 keyring + 禁工具） |
| `~/.dsh/.credentials.yaml` | DSH 默认明文凭据文件（有残留 key，见坑⑥） |
| `D:\dsh-credentials-keyring\` | 用户自己写的 keyring 插件源码（本地） |

---

## 三、排错速查表（症状 → 根因 → 解法）

| 症状 | 根因 | 解法（详见第四节） |
|---|---|---|
| DSH 报 `MISSING_CREDENTIAL: no API key` | 凭据引用名含连字符，DSH 要求 POSIX 标识符 | 交接 key 到 `DEEPSEEK_API_KEY`（坑①） |
| 挂了 keyring 插件，DSH 却还走明文 / 仍报缺 key | patch 的 `name` 覆盖被「name mismatch」静默跳过 | `disabled: true` + `insert`（坑②） |
| Rust 里 spawn DSH 一直超时，PowerShell 里同样命令很快 | 管道缓冲区死锁（退出后才读 stdout） | 并发排空 stdout/stderr（坑③） |
| spawn `.bin/dsh.cmd` 后进程树异常、卡住 | `.cmd` 的 `goto` 技巧搞乱进程树 | 直接 spawn `node bin.js`（坑④） |
| 生成超过 60s | DSH agent 思考模式比单次 HTTP 慢 | 放宽超时 + 关思考（坑⑤） |
| 命令行测 DSH 明明「没配 key」却能生成 | `~/.dsh/.credentials.yaml` 有残留明文 key | 清理明文，走钥匙串（坑⑥） |
| 装 `dsh-headless` 装到旧版 | `latest` 标签停在过时的 0.0.1-rc.1 | 显式 `@0.1.0-rc.7` 或 `@next`（坑⑦） |
| 多轮追问想走 ACP 却装不上 | `dsh-acp` 卡在 0.0.1-rc.1，与主线 peer 冲突 | 用 one-shot，ACP 后置（坑⑧） |
| DSH 的 AI 能写文件跑命令（危险） | 默认 agent 带工具 | 禁工具（坑⑨） |

---

## 四、关键发现详解（每个坑：症状 / 根因 / 证据 / 正确做法 / 错误做法）

### 坑①：凭据引用名不能带连字符（「零交接」不成立）

**症状**：Rust 后端把 API Key 存在钥匙串 `service=com.nextstory.desktop`、`account=llm-api-key`。想让 DSH 直接读这个槽位，实现「零交接」，结果 DSH 无法 resolve。

**根因**：DSH 的 `credentialRef()` 对引用名做硬校验——必须是 POSIX shell 标识符：

```js
// @deepseek-ai/dsh-credentials/lib/index.js
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;   // 字母/数字/下划线，不允许连字符
```

`llm-api-key` 含连字符，`credentialRef('llm-api-key')` 直接 throw。

**正确做法**：一次性交接——把 key 复制到合法引用名 `DEEPSEEK_API_KEY`（同 service），旧 key 保留。用插件同一个底层 `@napi-rs/keyring`（保证读同一槽位）：

```js
// 交接脚本（在 D:\dsh-credentials-keyring 下跑，因为那里有 @napi-rs/keyring）
import { Entry } from '@napi-rs/keyring'
const SERVICE = 'com.nextstory.desktop'
const oldKey = await new Entry(SERVICE, 'llm-api-key').getPassword()
if (oldKey) {
  await new Entry(SERVICE, 'DEEPSEEK_API_KEY').setPassword(oldKey)
  console.log('已复制到 DEEPSEEK_API_KEY，旧 key 保留')
}
```

**错误做法**：试图让 DSH 直接读 `llm-api-key`（连字符，被 REF_PATTERN 拒绝）。

**顺带验证**：`@napi-rs/keyring`（插件底层）与 Rust `keyring` crate 底层同源，读同一槽位。真机读回旧 key 长度 35（标准 DeepSeek key 长度），确认槽位兼容。

---

### 坑②：keyring 插件挂载要用 `disabled + insert`，不是 `name` 覆盖

**症状**：按直觉写 `- id: credentials, name: dsh-credentials-keyring` 想替换默认 provider，结果 DSH 静默跳过，key 一直来自明文 `.credentials.yaml`。早期还误以为「挂载成功」，其实是明文在兜底。

**根因**：DSH 的 patch 对 `id` 相同的覆盖，要求 `name` 必须匹配现有值，否则跳过并告警（不报错、不替换）：

```js
// cordis-plugin-include/lib/index.js  applyEntryPatches()
if (name && name !== target.name) {
  warn("patch: name mismatch for %C (expected %C, got %C), skipping", id, target.name, name);
  continue;
}
```

**证据**：`dsh --profile headless --dump-config` 会打印 `name mismatch for "credentials" (expected "@deepseek-ai/dsh-credentials-local", got "dsh-credentials-keyring"), skipping`，且 credentials 条目仍是 local。

**正确做法**：先 `disabled` 关掉默认 provider，再 `insert` 插入自己的插件（新 id，插件的 Service 名仍由 `super(ctx, "credentials")` 决定，不受 entry id 影响）：

```yaml
# ~/.dsh/profiles/headless/cordis.patch.yml
- id: credentials
  disabled: true
- insert:
  - id: credentials-keyring
    name: dsh-credentials-keyring
    config:
      service: com.nextstory.desktop
```

**验证方法**：
1. `dsh plugin --profile headless add git+https://github.com/irisnb/dsh-credentials-keyring.git`（装进 profile；会提示「declares no dsh.bundle — installed as a plain dependency」，正常，因为插件不是 bundle，要靠上面的 patch 手动挂）。
2. `dsh --profile headless --dump-config` 确认 credentials 条目已变成 keyring。
3. 移走 `~/.dsh/.credentials.yaml` + 清 env + 跑生成，能出结果 = 真从钥匙串读了。

**错误做法**：`- id: credentials, name: dsh-credentials-keyring`（被 name mismatch 跳过，静默失效）。

---

### 坑③：Rust spawn DSH 必须并发排空管道，否则死锁（表现为一直超时）

**症状**：Rust 的 `generate_via_dsh` spawn DSH 后，`try_wait` 一直返回 None，60s、180s 都超时；但 PowerShell 里跑同样命令 18 秒就出结果。

**根因**：DSH 生成过程**流式**写 stdout/stderr。若父进程「等子进程退出后再读 stdout」，子进程写满管道缓冲区（Windows 约 64KB）后阻塞，永远不退出，父进程 `try_wait` 永远等不到。

**正确做法**：spawn 后**立即**把 stdout/stderr `take()` 出来，各起一个线程并发 `read_to_string`（持续排空管道），主线程只 `try_wait` 轮询 + 限超时：

```rust
let mut child = Command::new(node_bin)
    .args([bin_js, "--profile", "headless", task])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?;

// 关键：并发排空，避免管道写满阻塞
let mut stdout = child.stdout.take().expect("piped");
let mut stderr = child.stderr.take().expect("piped");
let out_thread = std::thread::spawn(move || { let mut s = String::new(); let _ = stdout.read_to_string(&mut s); s });
let err_thread = std::thread::spawn(move || { let mut s = String::new(); let _ = stderr.read_to_string(&mut s); s });

let status = loop {
    match child.try_wait() {
        Ok(Some(s)) => break s,
        Ok(None) => { /* 到 deadline 就 kill + 返回 Timeout */ }
        Err(e) => { /* 返回 Service 错误 */ }
    }
};
let stdout_text = out_thread.join().unwrap_or_default();
let stderr_text = err_thread.join().unwrap_or_default();
```

**错误做法**：`try_wait` 拿到 `Some(status)` 之后才 `child.stdout.take()` 读——死锁。

---

### 坑④：别 spawn `.bin/dsh.cmd`，直接 spawn `node bin.js`

**症状**：spawn `node_modules/.bin/dsh.cmd` 后进程树异常、卡住。

**根因**：npm 生成的 `.cmd` shim 里有一行 cmd 技巧：

```bat
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\..\@deepseek-ai\dsh\lib\bin.js" %*
```

这行 `goto`/`||` 技巧会让进程树/退出语义异常，`try_wait` 卡住。

**正确做法**：直接 spawn `node` + 真正的入口文件：

```rust
let node_bin = "node";
let bin_js = "<项目>/sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js";
Command::new(node_bin).args([bin_js, "--profile", "headless", task])
```

**错误做法**：`Command::new(".../dsh.cmd").args(["--profile", "headless", task])`。

---

### 坑⑤：超时要放宽（agent 思考模式比单次 HTTP 慢）

**症状**：同一任务，原 Rust 走单次 `chat/completions` 很快；DSH 的 agent 生成超 60s。

**根因**：DSH 的 `dsh-llm-deepseek` 适配器默认带「思考」模式（thinking/reasoning），比直接取答案慢。真机实测：简单问答 3~18s，稍复杂的「提问题」任务 18~25s，最坏可能更久。

**正确做法**：超时放宽到 180s；迁移时与「关闭思考模式」一起调优（`llm-deepseek` 的 thinking 配置，base patch 注释里写「Thinking defaults are a deployment choice」）。

---

### 坑⑥：明文 key 残留

**症状**：命令行测 DSH，明明「没配 key」却还能生成。

**根因**：`~/.dsh/.credentials.yaml` 里有一份明文 `DEEPSEEK_API_KEY`（之前用 DSH 时留下的）。DSH 默认的 `dsh-credentials-local` provider 会读它。

**正确做法**：迁移落地时清理这个明文文件，key 统一走钥匙串（keyring 插件）。

**排查技巧**：测「缺 key 是否 fail loud」时，必须把所有 key 源都清掉——`.credentials.yaml`、环境变量、keyring 插件的 service 槽位，三者全空，DSH 才会报 `MISSING_CREDENTIAL`（退出码 1）。只清一个源，另一个源会兜底，测不出真正的 fail-loud。

---

### 坑⑦：装依赖要显式锁版

**症状**：`npm i @deepseek-ai/dsh-headless` 装到过时旧版。

**根因**：`dsh-headless` 的 `latest` 标签停在过时的 `0.0.1-rc.1`，`next` 才是 `0.1.0-rc.7`。DSH 是 developer preview，7 天发 7 版，官方声明「THERE WILL BE COMPATIBILITY-BREAKING CHANGES」。

**正确做法**：全部精确锁版（`"@deepseek-ai/dsh": "0.1.0-rc.7"`，不用 `^`），需要的话 vendor Node 运行时，升级走显式测试。

---

### 坑⑧：ACP 卡旧版本线

**症状**：想用 ACP（长驻多轮）却装不利索、peer 冲突。

**根因**：`@deepseek-ai/dsh-acp` 停在 `0.0.1-rc.1`，peer 依赖指向旧线，与主线 `0.1.0-rc.7` 错位。

**正确做法**：第一版用 one-shot headless（每次请求 spawn 一次），追问靠「整段对话序列化进一个 task」实现（已验证成立）。ACP 等官方跟上主线再启用。

---

### 坑⑨：DSH 默认 agent 带工具（危险）

**症状**：DSH 默认 agent 自带 bash / 文件读写 / 联网 / 子 agent 等工具，AI 理论上能写文件、跑命令，违反铁律 1。

**根因**：`dsh-base` 的 patch 默认挂载了一堆 `tool-*`、`skill-*` 插件。

**正确做法**（「A」等价迁移）：在 profile patch 里全部禁掉：

```yaml
- id: tool-bash
  disabled: true
- id: tool-pwsh
  disabled: true
- id: tool-fs
  disabled: true
- id: tool-fs-search
  disabled: true
- id: tool-str-replace-editor
  disabled: true
- id: tool-web
  disabled: true
- id: tool-skill
  disabled: true
- id: tool-subagent
  disabled: true
- id: tool-subagent-control
  disabled: true
- id: tool-subagent-list-agents
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: tool-subagent-report
  disabled: true
- id: tool-workflow
  disabled: true
- id: tool-jobs
  disabled: true
- id: tool-goal
  disabled: true
- id: tool-ralph
  disabled: true
- id: skill
  disabled: true
- id: skill-filesystem
  disabled: true
```

**验证**：禁工具后（a）生成照常；（b）要求它「创建文件」会被明确拒绝（它说自己只剩 `exit_plan_mode` 和 `todo_write`，没有写文件/命令工具），且 `Test-Path` 确认文件确实没被创建。

> 注意：`tool-todo` 和 `exit_plan_mode` 是 agent 内部记账用的，没禁，它们不碰文件/命令，安全。

---

## 五、逐项测试结果

| 项 | 测试内容 | 结果 |
|---|---|---|
| 1 | DSH 安装 + 锁版 | ✅ 530 包装成功 |
| 2 | headless 跑通 | ✅ 退出码 0=成功，stdout=最终答案 |
| 3 | 真生成（首问） | ✅ 质量对得上「陪想」 |
| 4 | 追问 | ✅ 整段对话序列化进一个 task，仍锚定原选区 |
| 5 | keyring 插件挂载 | ✅ 从钥匙串读 key（无明文、无 env） |
| 6 | 缺 key fail loud | ✅ 三源全空 → `MISSING_CREDENTIAL`、退出码 1 |
| 7 | 禁工具安全 | ✅ 生成照常 + 写文件被拒 + 文件未创建 |
| 8 | Rust sidecar 端到端 | ✅ `generate_via_dsh` 真机 25.58s |
| 9 | 错误映射 | ✅ `map_dsh_failure` 单测覆盖 5 类 |
| 10 | 现有测试不回归 | ✅ 108 项 Rust 测试全过 |

---

## 六、错误映射参考（`map_dsh_failure` 的关键词 → 错误码）

DSH 失败时退出码非 0，具体错误在 stderr。按关键词（先判「缺 key」再判「key 错」，顺序重要！）：

| 顺序 | stderr 关键词（小写） | 映射 |
|---|---|---|
| 1 | `no api key` / `missing_credential` / `not configured` | `ConfigurationRequired`（缺 key） |
| 2 | `api key` / `401` / `403` / `auth` / `unauthorized` | `Authentication`（key 错） |
| 3 | `timeout` / `timed out` | `Timeout` |
| 4 | `connect` / `network` / `econnrefused` / `dns` / `enotfound` | `Network` |
| 5 | 其它 | `Service` |

> **顺序坑**：`no api key` 里也含 `api key`，所以「缺 key」判断必须排在「key 错」前面，否则缺 key 会被误判成认证失败（已踩过，单测 `map_dsh_failure_classifies_each_error_family` 锁住）。
>
> **防泄露**：错误 `message` 只用固定中文 + 退出码，**绝不回传 stderr 原文**（stderr 可能含 key/请求/响应）。单测 `map_dsh_failure_never_leaks_stderr_into_message` 锁住。

---

## 七、遗留（归入迁移 phase）

- vendor Node 运行时打包（spike 里从 `node_modules` 跑，打包是迁移的事）。
- A/B 开关接线到 `generate_ai_thinking`（默认仍走 Rust）。
- 关闭 DSH 思考模式、调优超时。
- 清理 `~/.dsh/.credentials.yaml` 明文 key，统一走钥匙串。

---

## 八、复现步骤（精确命令）

**1. 装 sidecar**
```bash
cd sidecar
npm install   # 锁版 0.1.0-rc.7，见 package.json
```

**2. 挂 keyring 插件 + 禁工具**
```bash
# 装插件进 profile（转发给 pnpm）
node sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile headless add git+https://github.com/irisnb/dsh-credentials-keyring.git
```
然后改 `~/.dsh/profiles/headless/cordis.patch.yml`（内容 = 坑② 的 `disabled+insert` + 坑⑨ 的禁工具清单）。

**3. 交接 key**（见坑① 的脚本，一次性）。

**4. 命令行测**
```powershell
node sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless "你是陪剧本创作者思考的助手……"
# 退出码 0 = 成功，stdout = 最终答案
```

**5. 看实际生效配置**（排查挂载问题时用）
```bash
node sidecar/node_modules/@deepseek-ai/dsh/lib/bin.js --profile headless --dump-config
```

**6. Rust 集成测试**（需钥匙串 + 网络）
```bash
cd src-tauri
cargo test -- --ignored dsh_headless   # 端到端真生成
cargo test dsh_sidecar                  # 错误映射单测（不联网）
```

---

## 九、本次涉及的文件清单

| 文件 | 改动 |
|---|---|
| `sidecar/package.json` + `package-lock.json` | 新增，锁版 DSH |
| `src-tauri/src/dsh_sidecar.rs` | 新增，`generate_via_dsh`（spawn+超时+排空管道）+ `map_dsh_failure` + 单测 |
| `src-tauri/src/lib.rs` | 加一行 `pub mod dsh_sidecar;` |
| `~/.dsh/profiles/headless/cordis.patch.yml` | 本机配置（不在 git 仓库里）：挂 keyring + 禁工具 |
| `openspec/changes/spike-dsh-headless-generation/` | spike 的 proposal/design/specs/tasks |
