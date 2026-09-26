# 讨论档案权限与所有权·验证记录（离线不变量与门禁）

> 2026-09-26。本记录整理本次 change 的门禁结果与 F03/F05 回归转正证据。
> 范围如实声明：**未执行应用级真机 UI 场景**（见第四节边界）；本次验收依据为仓库正式测试（后端 Rust 不变量 + 前端夹具）与全部门禁。

## 一、方法与范围

- **修复对象**：复核报告（`方向/开发前全面工程复核-2026-09-23.md`）F03（权限判定漏掉补读出处、无持久锁存表达）与 F05（授权可被旧保存复活、工具通道读改写非原子）。对应验收：隐藏影响覆盖所有材料来源；关闭授权不能被旧保存复活；并发读改写不丢更新。
- **证据形态**：复核报告当年用 `tmp/project-audit/` 临时仪器复现的三类不变量，本次全部转为仓库内正式测试（后端 `conversation_store.rs` / `story_tool_channel.rs` 内联测试，前端 `tests/*.test.ts`）；不依赖临时仪器。
- **未跑真实模型**：`real_link_on_demand_reading_test` 三项按既有约定保持 ignored（需 `ZHIPU_API_KEY` + 网络 + DSH sidecar，手动运行）；本次修复路径不经过模型协议。
- **执行者**：后端与前端两条实现车道分别完成并自测；主控收尾两个集成测试夹具后复跑全部门禁。

## 二、门禁结果（全部通过）

| 门禁 | 结果 | 说明 |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml` | 通过 | lib 302 通过 / 1 ignored；集成 12+33+2+33 全过；真实链路 3 项按设计 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | 通过 | 无格式漂移 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 通过 | 零告警 |
| `npm run check` | 通过 | typecheck / lint / 前端 1093 / 可靠性 120 / 驱动 13 / 生产构建 / Rust 全量 |
| `npm run test:validation` | 通过 | 78 项 |

## 三、F03 与 F05 回归证据（按不变量）

### F03：权限判定覆盖所有材料来源 + 持久锁存

| 不变量 | 证据（测试名） | 位置 |
|---|---|---|
| 只含补读出处的讨论被关闭可见性后锁存 | `latch_restrictions_is_idempotent_and_preserves_other_and_on_demand_provenance`（已翻转旧断言） | conversation_store.rs |
| 旧逐条 `revoked` 标记档案（无 `restriction` 字段）重开仍受限、重新开启可见性不解除 | `legacy_revoked_archive_and_meta_without_restriction_remain_restricted` | conversation_store.rs |
| 引用索引降级（`references_incomplete`）时回退读正文、两类出处都参与锁存与影响查询 | `reference_overflow_omits_whole_index_and_falls_back_for_usage_and_latching` | conversation_store.rs |
| 摘要携带两类引用集合与锁存标记（列表判定不读正文） | `meta_deduplicates_both_reference_sets_and_summary_matches_meta` | conversation_store.rs |
| 重开 / 恢复 / 实时锁存 / 列表脱敏对补读-only 隐藏来源全部生效 | `tests/conversation-material-restriction.test.ts` 新增场景（补读-only 隐藏来源、档案锁存、旧标记兼容、缺出处保守、载荷断言） | tests/ |
| 编排层：补读-only 隐藏后禁止恢复、锁存、关闭窗口再读档仍受限 | `tests/ai-feature-persistence.test.ts` 新增场景 | tests/ |

### F05：字段所有权 + 原子读改写

| 不变量 | 证据（测试名） | 位置 |
|---|---|---|
| 撤销授权后旧副本普通保存到达 → 仍为未授权；授权后无授权字段保存到达 → 授权保持 | `ordinary_save_cannot_revive_revoked_grant_or_clear_current_grant` | conversation_store.rs |
| 普通保存携带与现值不同的授权/出处/锁存 → 一律被忽略（含档案不可读与首建） | `ordinary_save_ignores_all_backend_fields_for_new_unreadable_and_existing_archives` | conversation_store.rs |
| 工具通道落档与普通保存两种先后顺序交错 → 最新轮次与最新补读出处都不丢失 | `channel_upsert_and_ordinary_save_keep_latest_turns_and_provenance_in_both_orders` | story_tool_channel.rs |
| 同轮同文档累计合并、其余字段保持 | `upsert_merges_by_turn_and_document_and_preserves_other_fields` | conversation_store.rs |
| 锁存状态不被迟到普通保存覆盖，删除/恢复后保持 | `latched_restriction_survives_stale_save_and_delete_restore` | conversation_store.rs |
| 前端终态普通保存载荷不携带授权字段（序列化断言） | `tests/agent-on-demand-reading.test.ts`（更新断言） | tests/ |

### 收尾修复（主控）

- 两个集成测试夹具随新契约修正：`restriction: None` 字段补齐；授权初始化由「普通保存携带授权」改为公开窄更新 `set_on_demand_reading`（`src-tauri/tests/real_link_on_demand_reading_test.rs`、`on_demand_reading_negative_test.rs`）。修正后上述门禁全量复跑通过。

## 四、边界与未验事项

- **未执行应用级真机 UI 场景**（如：真实关闭文档可见性后重启、列表脱敏、授权开关点击流）。本次两个不变量均可在离线层以正式测试覆盖，且修复不改变用户可见交互；如需 UI 级复核，可沿用既有 CDP 仪器（`archive/2026-09-24-rework-conversation-storage/verification/`）另行执行。
- 未发起任何真实模型调用；补读授权流的真实链路（`real_link_*`）保持手动运行约定。
- 回滚已知限制（已记录于 design.md）：回退代码后，本变更新写入的档案级锁存不会被旧版本识别；旧逐条标记路径不受影响。
- 前一项 change 遗留的 C 类缺陷（原生确认弹窗被 ACL 拦截，见 storage 验证记录 C 节）不在本 change 范围。
