## 1. 失败收束（行为修复，独立提交）

- [x] 1.1 `resolve_reading_request`：授权档案写入失败时仍向驱动回填结构化拒绝（`{granted:false, recovery:…}`，与用户拒绝结果同构），轮次不悬挂、继续有限回答；错误如实返回前端；迟到/未知决定的失败关闭与「不动档案」语义保持
- [x] 1.2 `story-request-reading` 无接收通道：不插入待决、不进入等待，立即回填结构化拒绝（未授权系 reason＋既有恢复提示常量）
- [x] 1.3 驱动未接线防御分支：注释如实化（无驱动即无事件源、仅为装配顺序防御、无回填对象），行为不变
- [x] 1.4 三条路径集成测试（复用既有夹具：临时作品＋假驱动＋通道）：断言结构化回填、轮次收束不悬挂、授权档案未被写入；既有测试全回归

## 2. 拆分（纯移动，独立提交）

- [x] 2.1 提取 `story_tool_round_state.rs`：轮内读取状态纯逻辑（版本固定 / 同轮去重 / 阅读程度累计 / 保险丝判定）＋专项测试随行迁移
- [x] 2.2 提取 `story_tool_authorization.rs`：待决授权表、授权请求事件构造、决定回填逻辑＋相关测试随行迁移
- [x] 2.3 `story_tool_channel.rs` 保留通道编排与驱动/接收器接线并作门面 re-export；`lib.rs` 增加两个模块声明；调用方（`ai_host.rs` / `ai_orchestration.rs` / `dsh_driver.rs` 探针）零改动
- [x] 2.4 纯移动纪律核对：该笔 diff 只含代码移动与 use 路径调整，无逻辑与文案变化；测试计数不减

## 3. 验证与收尾

- [x] 3.1 `npm run check` 全绿（含 cargo fmt / clippy / 全量 Rust 测试）
- [x] 3.2 `verification/validation.md`：三条故障路径证据、拆分前后文件结构对照、测试计数
- [x] 3.3 归档核对：规格增量同步（`agent-on-demand-reading` 新增失败收束要求）
