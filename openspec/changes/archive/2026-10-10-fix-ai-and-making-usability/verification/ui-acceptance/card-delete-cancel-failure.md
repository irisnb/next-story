# 卡删除「取消 / 失败 / 基线失效取消重确认」真机证据（tasks 5.5 / 8.2 补证）

> change: `fix-ai-and-making-usability`。角色：validation owner（真实 UI + 真实 Rust 链路）。
> 日期：2026-10-10。范围：验收脚本 + evidence 记录，**仅补 completion-evidence.md §2 的 1–3 号缺口**。
> 边界遵守：**未改产品源码/配置/keyring/正式用户数据；未发模型请求；未 commit/未归档**。
> 不重做已成功的「正常删卡」路径（已在 `evidence-making-storage-versions.json` 17/17 通过）。

## 0. 隔离与 owned 核实

- 实例：真实 Tauri dev，隔离 identifier `com.nextstory.acceptance`；CDP `127.0.0.1:9225`
  （标题 `Next Story`，url `http://localhost:1420/`，target id `241FEF4D17F06C48A01AA5B58E65EEF8`）。
- owned 记录：`…\Temp\opencode\acceptance-fix-ai\owned-dev.json`（`override` 指向本 change 的
  `tauri.override.json`，其 `identifier=com.nextstory.acceptance`）；应用进程 `next-story.exe` PID 29040
  属该受控实例树。脚本断言 `isolation.ownedDevRecordPresent`、`isolation.targetIsDevPage`、
  `isolation.singleFixtureChain`（界面仅 1 条链路＝fixture）均通过。
- 数据：仅读写隔离 fixture `C:\Users\Administrator\AppData\Local\com.nextstory.acceptance\making-module\chains.json`。
  **未读正式配置、未读写正式用户项目/正文。**

## 1. 方法说明（确认对话框、fixture 注入、故障注入的边界）

- **确认对话框**：原生 confirm 无法自动点击，沿用归档 change 与既有脚本的验证方法，经 devtools 通道
  改写 `globalThis.confirm` 记录**真实文案**并判定接受/取消。这不是模型 mock：**业务结果仍由真实 Rust
  命令与真实磁盘写入产生**。取消场景＝记录文案后 `resolve(false)`（用户在对话框点「取消」）。
- **基线失效注入（明确标注的 fixture 注入，非产品路径/非后端 API）**：确认文案已产生、`await confirm`
  挂起期间，由脚本直接改写**隔离 fixture** `chains.json`，模拟「确认期间锁定版本被别的操作改动」。
  产品随后自身经真实命令 `chain_library_load` 重新读到被改动的隔离存储，走既有基线比对分支取消。
  - changed：把锁定版本 `chainver-cdp-long-1` 的目标卡 `body` 追加标记。
  - missing：从链路中移除锁定版本 `chainver-cdp-long-1`。
- **失败注入（明确标注的故障注入，非 mock 冒充 Rust 失败）**：确认前把隔离 `chains.json` 置**只读**，
  令真实 Rust 原子写（`chain_library.rs::save_library_to_dir`：`NamedTempFile` + `persist` →
  Windows `MoveFileEx`）真失败。已独立验证：Node/`MoveFileEx` 在目标只读时返回 `EPERM`。

## 2. 命令

```text
node openspec/changes/fix-ai-and-making-usability/verification/ui-acceptance/card-delete-cancel-failure.mjs
```

脚本先 `location.reload()` 重载前端到干净状态并重开隔离项目，再 `seed()` 复位 fixture；
结束时再次 `clearReadonly()+seed()` 复位，断言 `restore.seedBaselineRestored` 通过。

## 3. 结果（26/26 断言通过，consoleErrors=0）

证据：`evidence-making/evidence-card-delete-cancel-failure.json`；截图 `evidence-making/card-delete-*.png`。

| 场景 | 真实 UI 动作 | 断言（全通过） | 结论 |
|---|---|---|---|
| 取消 | 点「删除卡片」→ 对话框记录文案 → 用户点取消 | `cancel.confirmWordingRecorded`、`cancel.noVersionAppended`（版本数仍 1）、`cancel.activeUnchanged`（`active` 仍 null）、`cancel.cardStaysCount2`（v1 仍 2 卡含目标卡）、`cancel.noNewError` | **取消不写盘、不改 active、不误删** |
| 基线失效·changed | 确认挂起期间 fixture 改锁定版本卡内容 → 点确认 | `baselineChanged.cancelledWithReconfirmHint`（状态条＝「原确认版本已变化或不存在，删除已取消。请重新查看并确认。」）、`baselineChanged.noVersionAppended`、`baselineChanged.activeUnchanged`、`baselineChanged.targetCardKept` | **取消并要求重新确认、不误删** |
| 基线失效·missing | 确认挂起期间 fixture 删除锁定版本 → 点确认 | `baselineMissing.cancelledWithReconfirmHint`（同上文案）、`baselineMissing.noVersionAppended`（版本数 0，未落任何新版本）、`baselineMissing.activeUnchanged` | **取消并要求重新确认、不误删** |
| 失败（受控 I/O） | 隔离 `chains.json` 置只读 → 点「删除卡片」→ 经确认真实调用 | `failure.realRustErrorShown`（状态条＝「删除卡片失败：链路库写入失败: 拒绝访问。 (os error 5)」＝**真实 Rust 错误**）、`failure.noVersionAppended`、`failure.activeUnchanged`、`failure.targetCardKept` | **真实 Rust 写失败如实提示，不误删、不伪造成功** |

真实确认文案（四场景一致）：
「从「CDP长卡验收链·第1版」删除卡片「可删除的第二张卡」？将保存为新版本，历史版本保持不变，不自动启用；下一轮使用的版本不变。」

## 4. 自动断言 vs 人工视觉

- 上表全部为**自动断言**数值。
- 截图：`card-delete-cancel.png`、`card-delete-failure.png` 为场景态。
  **`card-delete-baseline-changed.png` 与 `card-delete-baseline-missing.png` 逐字节相同**
  （可视 UI 在两条取消路径后一致，差异只在注入的 fixture 与断言记录里）——这是预期，不以截图区分两子例。
- **人工视觉比对未做**（模型无图像输入能力），截图交主助手/用户复核。

## 5. 残留限制（如实标注）

- 基线失效用「脚本直接改隔离 fixture」构造，而非并发真实旧版本删除命令（后端无删除单版本命令，
  版本不可变）；changed/missing 两分支均覆盖，但**不是**多进程真并发竞态。
- 失败注入为受控只读 I/O，覆盖真实 Rust `Write` 错误路径；未覆盖磁盘满/权限以外的其它 I/O 形态。
- 未新增/修改任何产品测试 hook；未改产品代码。

## 6. 证据路径（交后续人工视觉）

- `…/evidence-making/evidence-card-delete-cancel-failure.json`
- `…/evidence-making/card-delete-cancel.png`
- `…/evidence-making/card-delete-baseline-changed.png`
- `…/evidence-making/card-delete-baseline-missing.png`
- `…/evidence-making/card-delete-failure.png`
