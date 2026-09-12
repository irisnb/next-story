# Snapshot Version Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拒绝版本字段不是由未保存快照正文派生的材料请求，确保版本身份不能由前端任意声明。

**Architecture:** 保持现有 `ReadMaterialRequest` 和 `MaterialSnapshot` 契约不变，在 Rust 受控材料边界的 `validate_snapshot` 内重新计算正文版本并与快照版本比较。失败继续使用现有 `InvalidSnapshot` 结构化拒绝，不改变前端提示、DSH 协议或自动材料组装。

**Tech Stack:** Rust、Cargo 内置测试、OpenSpec。

---

### Task 1: 快照正文派生版本校验

**Files:**
- Modify: `src-tauri/src/project/story_material.rs:320-351`
- Test: `src-tauri/src/project/story_material.rs` 内现有 `tests` 模块

- [ ] **Step 1: 写失败测试**

新增测试：创建合法 Tiptap 快照正文，但把 `snapshot.version` 与 `expected_version` 同时设为伪造值；调用 `read_material_from_tree` 后断言返回 `MaterialDenialReason::InvalidSnapshot`。该测试必须证明“请求内部字段彼此一致，但与正文不一致”仍会被拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml snapshot_version_must_match_snapshot_content -- --exact --nocapture`

Expected: FAIL，因为当前实现仅检查版本非空，伪造快照会被放行。

- [ ] **Step 3: 写最小实现**

在 `validate_snapshot` 完成 Tiptap JSON 验证后增加：

```rust
if compute_version(&snapshot.content) != snapshot.version {
    return Err(MaterialDenial::new(MaterialDenialReason::InvalidSnapshot));
}
```

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml snapshot_version_must_match_snapshot_content -- --exact --nocapture`

Expected: PASS。

- [ ] **Step 5: 运行材料服务测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::story_material::tests -- --nocapture`

Expected: 所有 `story_material` 测试通过。

### Task 2: 真实链路走查与 change 收口

**Files:**
- Modify after evidence succeeds: `openspec/changes/controlled-story-read-visibility/tasks.md:45`

- [ ] **Step 1: 创建临时作品并记录正文哈希**

使用应用真实 Tauri 命令路径建立临时作品，包含至少一篇保持允许的文档和一篇随后关闭权限的文档；记录所有正文文件 SHA-256。

- [ ] **Step 2: 走查权限状态**

验证新文档默认允许；经文件管理对应的 Tauri 命令关闭一篇文档；AI 目录投影只显示允许文档并将隐藏数量记为 1，且不包含隐藏文档名称、ID 或路径。

- [ ] **Step 3: 走查 AI 请求边界**

验证隐藏文档选区在真实发送前被拒绝；已使用该文档的旧讨论转为永久受限且不能继续或恢复重放；新讨论仍可开始。

- [ ] **Step 4: 核对零写回并更新任务**

重新计算正文 SHA-256，必须与步骤 1 完全相同。所有场景成立后才把任务 `7.2` 从 `- [ ]` 改为 `- [x]`。

- [ ] **Step 5: 最终验证**

Run: `npm run check`

Run: `npm test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`

Run: `openspec validate "controlled-story-read-visibility" --strict`

Expected: 全部命令退出码为 0。
