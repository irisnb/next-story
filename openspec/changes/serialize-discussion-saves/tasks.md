# 任务：同一讨论的保存串行化

## 1. 核实与实现

- [x] 1.1 核实 `undoDelete` 路径与 `deletedConversationIds` 的一致性：恢复成功后名单是否清除该 key；若确有缺陷则修复（结论与处置写入本文件）
  - 结论（2026-09-16）：**无缺陷**——archive 层 `conversationRestore` 在调用后端恢复前即同步清除前端删后守卫，`undoDelete` 先 await 恢复再保存，顺序正确。原名单按裸 id 键控的隐患已随本 change 改为 (projectPath, conversationId) 组合键一并消除；行为由任务 2.4 回归测试锁死。
- [x] 1.2 `src/conversation-archive.ts`：`inFlightSaves` 改造为按 (projectPath, conversationId) 组合 key 的严格串行链（promise chaining；删除守卫在发起时判定；链空闲时首笔 invoke 同步发起保持旧行为；每环 catch 分类 + finally 清槽位）
- [x] 1.3 `conversationDelete` 进入同一链：key 先入删后名单（新保存立即 no-op）再排队等待在途保存排干后执行删除
- [x] 1.4 保存被后端 `AlreadyDeleted` 拒绝时识别为预期终局（后端 Display 文案「讨论已删除，无法保存」前缀精确匹配，兼容字符串与 Error 形态），不置 `saveError`；真实失败仍如实报错
- [x] 1.5 确认 archive 既有测试全部保持通过（删后 no-op、单在途保存、正常保存、删除等待）

## 2. 回归测试

- [x] 2.1 「旧保存慢完成不覆盖新状态」：两笔重叠保存乱序 resolve，断言到达顺序 = 发起顺序、最终档案为后发起者内容
- [x] 2.2 「删除等待在途保存且具终局」：两笔保存在途时删除，断言删除最后执行、无保存失败状态
- [x] 2.3 「迟到保存不误报不复活」：删后迟到保存被拒，断言无 saveError、档案不重建
- [x] 2.4 「撤销删除后可继续保存」：锁死 1.1 结论
- [x] 2.5 「链中失败不阻断后续」：一笔保存 reject 后，下一笔保存仍正常执行

## 3. 验证与收尾

- [x] 3.1 全量验证：`npm run test:frontend`（751 通过 0 失败，+5 为新竞态回归测试）+ `npm run typecheck` + `npm run lint` 全过
- [x] 3.2 更新 `方向/全量地基审计-2026-09-14.md`：队列 5 行 ✅ 与 P0-4 危害边界修正记录；顺带补录 5b 行新情报（2.27.3 补丁版实测已修 + 新发现 HIGH 级 prosemirror-view 粘贴 XSS）
- [ ] 3.3 提交推送，确认 CI 双平台绿灯
- [ ] 3.4 归档 change（openspec archive，同步主 specs）
