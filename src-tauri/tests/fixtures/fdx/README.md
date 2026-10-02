# fdx 导入测试样本（add-fdx-import）

两个公开真实 Final Draft 生成的 `.fdx` 样本，作为 fdx 导入分支的端到端
测试夹具（任务 5.2）。均取自 MIT 许可开源仓库的测试文件，字节原样入库。

| 文件 | 来源 | 内容 | 用途 |
|---|---|---|---|
| `storyboarder-test.fdx` | [wonderunit/storyboarder](https://github.com/wonderunit/storyboarder)（MIT）`test/fixtures/final-draft/test.fdx`，167 KB | FD `Version="3"` 全套：TitlePage、30 组 SceneProperties（含 Summary/SceneArcBeats）、14 条 ScriptNote、Revisions（19 套修订定义）、DualDialogue、Style 词组样式、场景编号 | 全量导入逐字断言＋损耗清单计数断言 |
| `screenplain-dual-dialogue.fdx` | [vilcans/screenplain](https://github.com/vilcans/screenplain)（MIT）`tests/files/dual-dialogue.fdx`，575 B | FD `Version="1"` 极简双栏对白最小例（GIRL/GUY 两组 Character+Dialogue） | DualDialogue 拆分顺序断言 |

注意：两仓库原始文件均为其仓库内测试数据，著作权归原作者，依各仓库 MIT
许可随仓库分发使用；本目录不修改其内容。
