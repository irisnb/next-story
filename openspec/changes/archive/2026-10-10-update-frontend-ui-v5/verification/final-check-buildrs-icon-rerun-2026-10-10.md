# 图标重编跟踪永久修复 + 最终打包（2026-10-10）

本记录承接 `final-check-2026-10-10.md`；**本记录的产物哈希/尺寸取代**上一篇同名产物的哈希（因加入永久修复后重新打包）。保留全部光学 r2 图标内容（`src-tauri/icons/icon.ico` 内容哈希不变 `5C53E2D4…`）。

范围：把上轮定位到的「仅改图标不触发 Windows 资源重编」做**最小永久修复**（`src-tauri/build.rs` 登记 `bundle.icon` 的 rerun 依赖），并加一个 bounded 校验守卫；随后重跑工程门禁与打包，重新证明 EXE/MSI/NSIS 内嵌 8 帧。未改其它源码/UI/链路协议/图标设计/行动计划，未 Git/archive，未安装包，未改缓存。

## 1. 最小补丁

### 1.1 `src-tauri/build.rs`（唯一产品逻辑改动）

```rust
fn main() {
    // tauri-build 只把 tauri.conf.json / capabilities / sidecar 等登记为 rerun 依赖，
    // 不跟踪 bundle.icon 里的图标文件；不显式登记时，仅更新图标不会重编 Windows 资源，
    // 生成的 exe / 安装包会保留旧图标。此处按 tauri.conf.json 的 bundle.icon 显式登记，
    // 保证图标变动触发本构建脚本（进而重新生成 resource.rc / resource.lib 并重链）。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    tauri_build::build()
}
```

- 新增 5 行 `println!("cargo:rerun-if-changed=…")` 与一条说明注释；`tauri_build::build()` 与依赖不变。
- 覆盖 `tauri.conf.json` `bundle.icon` 的全部 5 项（`icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico`）。相对路径以 `src-tauri/` 为基准，与 `bundle.icon` 一致。

### 1.2 `scripts/check-package-resources.mjs`（bounded 守卫，无产品逻辑）

新增 `checkIconRerunTracking()`：读取 `src-tauri/tauri.conf.json` 的 `bundle.icon`，逐个核对 `src-tauri/build.rs` 是否包含 `cargo:rerun-if-changed=<该项>`；缺任一项则 `package:check` 失败并给出中文补救提示。守卫从配置派生（非硬编码），可捕获回归。

## 2. TDD 证据（RED → GREEN）

统一以 build-script 输出文件 `target/release/build/next-story-<hash>/output` 与 `out/resource.lib` 的 mtime 为观察量；只用 `touch` 改 `icon.ico` 的 metadata，**不改内容**（每步均核对内容 SHA-256 不变）。

### RED（修复前）

- 修复前活动构建目录 `next-story-5864cd9f762d7341`：`output` 时间 2026-10-10 03:34:47，`rerun-if-changed=icons` 命中 **0**。
- `touch src-tauri/icons/icon.ico`（内容 SHA 不变）→ `cargo build --manifest-path src-tauri\Cargo.toml --release` → **exit 0**。
- 结果：`output` mtime 仍 **03:34:47**（SHA 不变）、`resource.lib` mtime 仍 **03:35:31**（SHA 不变）→ **build.rs 未重跑、资源未重编**。（另有上轮 RED：首轮构建内嵌旧 7 帧。）
- 日志：`%TEMP%\opencode\final-check-2026-10-10\red-cargo-build.log`。

### GREEN（修复后）

- 应用补丁后第一次 `cargo build --release`（exit 0）：cargo 因 build.rs 变化重跑，构建脚本落到新目录 `next-story-4f899abbcb1f929f`，`output` 时间 04:02:53，**`rerun-if-changed=icons` 命中 5**（与 `bundle.icon` 一致）。
- `touch src-tauri/icons/icon.ico`（内容 SHA 不变）→ `cargo build --release` → **exit 0**：
  - `output` mtime **04:02:53 → 04:04:45**（build.rs 重跑）；
  - `resource.lib` mtime **04:03:32 → 04:05:28**（Windows 资源重编）；
  - 未执行任何 `cargo clean`；exe 仍 **8 帧且逐帧 `matchesIcoFrame=true`**（内容未变，符合预期）。
- 日志：`green-cargo-build1.log`、`green-cargo-build2.log`。

### 守卫 meaning check（不触碰文件）

对当前 `build.rs` → 缺失项 `[]`；把 `cargo:rerun-if-changed=icons/icon.ico` 从内存副本移除后 → 缺失项 `["icons/icon.ico"]`。证明守卫能真正捕获回归。

## 3. 命令与退出码（修复后，依序）

| 命令 | 退出码 | 日志 |
| --- | --- | --- |
| `cargo build --release`（RED，修复前） | 0 | `red-cargo-build.log` |
| `cargo build --release`（GREEN，补丁后首建） | 0 | `green-cargo-build1.log` |
| `touch icon.ico` + `cargo build --release`（GREEN，非 clean 重编） | 0 | `green-cargo-build2.log` |
| `node --check scripts/check-package-resources.mjs` | 0 | — |
| `npm run check` | 0 | `npm-run-check.log` |
| `npm run package:check` | 0 | `package-check-final.log` |
| `npm run tauri:build` | 0 | `tauri-build-final-fix.log` |
| `openspec validate update-frontend-ui-v5 --strict` | 0 | `openspec-validate.log`（"valid"） |

`npm run check`（exit 0）计数：前端 `1362/1362 fail 0`；可靠性 `121/121`；驱动 `33/33`；离线协议 `78/78`；Rust 单元 `510 passed / 0 failed / 1 ignored`；集成套件全过；真实链路 3 例按预期 `ignored`；fmt/clippy 无告警。

`npm run package:check`（exit 0）含新守卫：`合并后的通过文案：… Basecoat 组件资源与图标重编登记齐备`。

## 4. 最终产物（取代上一记录的同名哈希）

| 产物 | 路径 | 字节 | mtime | SHA-256 |
| --- | --- | --- | --- | --- |
| 应用主程序 | `src-tauri\target\release\next-story.exe` | 34760192 | 2026-10-10 04:20:41 | `F1691B8C5D41CEF75FC8E38100CBF45E3737A4051880E84500DA67411B190506` |
| MSI | `src-tauri\target\release\bundle\msi\Next Story_0.1.0_x64_en-US.msi` | 121880672 | 2026-10-10 04:14:26 | `3BC0E7DF929F05C96EC6391BA5FFC800B44852795EF14F055D6BCDAF912B88B2` |
| NSIS 安装器 | `src-tauri\target\release\bundle\nsis\Next Story_0.1.0_x64-setup.exe` | 70811532 | 2026-10-10 04:20:41 | `95C6DA67AA7D56EEE013CA5615F8A6472FC5A2B9381C1E885C18BF5B7D83FE27` |

- `target\release\resources\icon.ico` 与 `src-tauri\icons\icon.ico` 同 SHA-256（`5C53E2D430E70B5575651E04C2AE4850FC613C33AE86DB01D611DB3FC325570D`，107609 字节）。
- 上一记录（`final-check-2026-10-10.md`）的 exe/MSI/NSIS 哈希已被本表取代。

## 5. EXE+MSI+NSIS 8 帧复证（复用 `verification/icon-diagnosis.mjs`）

- release `next-story.exe`：`RT_GROUP_ICON` 声明 **8 帧** `16/20/24/32/48/64/128/256`，逐帧 `matchesIcoFrame=true`（debug 同）。
- NSIS 内嵌 `next-story.exe`（7z 提取）：34760192 字节 → 8 帧。
- MSI 内嵌应用 exe（7z 解包 `app.cab` 的 `Path`）：34760192 字节 → 8 帧。
- `icon.ico` 内容保全：SHA-256 仍 `5C53E2D4…`；测试仅 `touch` metadata，已还原其 mtime 至 `2026-10-10 01:23:16`。

## 6. 边界与未完成

- 未运行 MSI/NSIS 安装包；未改 shell 图标缓存；未重装系统。
- 真实用户点击/视觉验收、安装后任务栏/开始菜单/快捷方式/浅深壁纸/小尺寸光学（tasks 7.6）、125/150/200% DPI、真实模型链路均未做（不虚称）。
- 未改 `tasks.md`、未 Git/archive。
- 构建前确认：无 next-story 进程运行；release exe 未锁定（上轮 owned 实例启动即停止，未留锁）。

## 7. 日志（approved temp，无密钥）

`C:\Users\Administrator\AppData\Local\Temp\opencode\final-check-2026-10-10\`：`red-cargo-build.log`、`green-cargo-build1.log`、`green-cargo-build2.log`、`npm-run-check.log`、`package-check-final.log`、`tauri-build-final-fix.log`、`openspec-validate.log`、`v2-nsis\next-story.exe`、`v2-msi\Path`。
