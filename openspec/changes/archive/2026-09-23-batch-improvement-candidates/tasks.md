# Tasks: batch-improvement-candidates

## 1. ① 中文 bigram 候选词（后端）

- [x] 1.1 `src-tauri/src/project/story_search.rs` 候选词提取改造：中文连续段确定性切分为连续二元组（段内每个起始位置产出长度恰为 2 的子串，长度恰为 2 的段即其本身）；拉丁字母数字段行为不变；NFKC/小写/空白折叠与位置映射不变；去重按首现顺序、至多 8 词、溢出按出现顺序裁剪（上限常量不动）
- [x] 1.2 更新/新增 Rust 候选词单测：锁定「林晓的性格怎么样」→ 林晓/晓的/的性/性格/格怎/怎么/么样 用例、裁剪顺序用例、拉丁段与混合段用例；`test:rust` 全量通过（实测 347 项 0 失败；story_tools 隐藏泄露测试查询词随行为适配、意图不变，diff 已亲验）
- [x] 1.3 `test:reliability` 回归确认检索面无退化（随全量 check 通过，CHECK_EXIT=0）

## 2. ② 拒绝载荷恢复提示（协议三端）

- [x] 2.1 按 protocol.json 单一真相源流程新增 `ToolResultErrorPayload` 可选 `recovery` 字段与稳定提示常量（未授权/保险丝/用户拒绝三类文案见 design D5）；双端生成物同步（实测为声明式真相源：改 protocol.json＋双端适配＋双端契约测试）
- [x] 2.2 `src-tauri/src/story_tool_channel.rs` 各拒绝回填点填充 `recovery`（11 处接线；实读后 `story_version_changed` 系无既定恢复路径不携带并加负向断言钉死；用户拒绝实为 result 载荷、恢复串置于结果对象内）
- [x] 2.3 `sidecar/driver/driver.mjs` 桥接透传 `recovery`；离线协议验证契约测试扩展新字段并全量通过（实测 78/78）；`test:driver` 全量（实测 13/13）

## 3. ④⑤ 最近作品列表＋对话框初始位置

- [x] 3.1 后端 recent-works 存储：`app_local_data_dir` 下 `recent-works.json`（沿用 llm-config 模式），条目 {name, path, lastOpenedAt}，按 path 去重移顶、上限 8 条、损坏/缺失失败开放为空列表；提供读写与有效性检查命令（实测：失败开放含 64 kB 读取上限、有效性判据 next-story-system 子目录、自愈回写尽力而为、临时文件原子替换、静态互斥串行写）
- [x] 3.2 打开/新建作品成功后记录（main.ts openProject 落地处 fire-and-forget，失败只记日志）
- [x] 3.3 欢迎页最近作品区：index.html welcome-actions 内追加容器与空态；渲染名称＋路径（word-break 防溢出）；展示前有效性自愈；点击经抽取的 runOpenProjectFlow 走与「打开作品」完全同链（忙碌锁＋操作序号＋授权链），不弹对话框
- [x] 3.4 `src/project-api.ts` `selectDirectory` 增可选 `defaultPath` 参数；「打开作品」传最近一条路径（列表空则不传，行为同现状）
- [x] 3.5 前端测试（新增 10 项：defaultPath 透传有/无、渲染、空态、失败开放、点击同链含授权、对话框初始位置）、`typecheck`、`lint`、生产构建（editor-vendor 373.53 / index 213.76 / tauri-vendor 15.28 kB，全低于 500 kB）全过（实测 969→972 含③新增）

## 4. ③ 召唤讨论隐藏切换入口

- [x] 4.1 `src/ai-dock.ts` 切换入口隐藏：侦察遗漏的第二个入口（窗口头 focus-switch 按钮）经 getter 返回 undefined 一并隐藏；菜单条目召唤讨论下不渲染；判据与编排层同源同形（模块边界禁止导入 ai-feature*，注释标明同步关系）；首轮在途经 pendingFirstRequest 回退覆盖；新增 3 测试；受限讨论既有路径不变（实测 972/972）

## 5. 验收与归档

- [x] 5.1 `npm run check` 全量（typecheck / lint / 前端 / 生产构建 / Rust）＋ `test:driver` / `test:validation` / `test:reliability` 三套件全绿（实测 CHECK_EXIT=0；validation 78/78、driver 13/13、reliability 随 check 通过）；`cargo fmt --check`＋`clippy -D warnings` 全过（CI 门禁本地预检）
- [x] 5.2 真机冒烟（用户在场）：欢迎页出现最近作品且一点重开；「打开作品」对话框定位最近作品、直接确认即可选中；召唤类讨论无「切换关注文档」入口；（可选）真实链路一次「拒绝→载荷含恢复提示」观察（实测：CDP 真机冒烟 10/10——空态文案、新建、键入、Ctrl+S、返回欢迎页、空态隐藏、最近列表渲染名称＋路径、点击条目无对话框重开、重开后正文仍在、控制台零错误（favicon 豁免）；磁盘双证 recent-works.json 落盘于 %LOCALAPPDATA%\com.nextstory.desktop\ 且条目正确。对话框定位：defaultPath 透传与传参路径均有单测＋rfd/Win32 语义经微软文档与源码级调研三重实证，用户日常点「打开作品」自然眼验；召唤入口：3 项 DOM 测试锁定（含首轮在途态），日常使用覆盖。可选真实链路观察未运行，如实记录——离线契约测试已锁载荷内容，不阻塞）
- [x] 5.3 `openspec validate` 通过，按流程归档 change；审计文档改进候选 ①②③④⑤ 销账（补充二十一记录）、处理进度更新（validate 通过；归档 2026-09-23，主规格三份同步，见审计补充二十一）

> 逐项提交（编排者执行）：735b4f7（①）→ 7934234（②）→ 1761792（④⑤）→ 8aa0de8（③），每项可独立回退。
