# 设计：稳定写作宽度（稿纸化，三档可调）

## Context

现状（2026-10-01 摸底，exp-1）：编辑器布局是一条纯 flex 拉伸链，**全链无任何 max-width、无居中规则**：

```
#editor-page (100vh, flex column)
  └ section#module-writing.module-view (flex column)        styles.css:2092
      └ .editor-main (flex row)                             styles.css:574
          ├ .format-toolbar  固定 5.5rem（88px）             styles.css:1700
          └ .editor-body (flex:1)                           styles.css:583
              └ .editor-notebooks (flex:1 + data-margin 留白) styles.css:590
                  └ #editor-textarea.notebook-textarea      styles.css:545,604
                      └ .ProseMirror (width:100%, padding 1rem) styles.css:557
```

真正改变正文可用宽度的只有三条路径：窗口宽（最小 1024×670）、AI 停靠区三态（展开 420px / 竖条 46px / 隐藏或浮动 0px，styles.css:1233、1500）、工具栏列（恒定 88px）。正文字号 16px（`:root` styles.css:89；`.ProseMirror` 1rem，styles.css:563）。

外部证据（2026-10-01 调研，lib-1）：

| 证据 | 结论 | 来源 |
|---|---|---|
| W3C《中文排版需求》 | 中文书籍正文典型 17–40 字/行、横排上限 48 字；行距多为字号的 50%–100% | w3.org/TR/clreq |
| 主流写作软件 | 固定宽度居中是一致做法：Typora 860px（≥1400px 放宽 1024、≥1800 放宽 1200）、Obsidian「限制行宽」默认开（仅开关）、Notion ~708px（页面级 Full width 开关）、iA Writer 固定 measure 立场、Ulysses/Bear 提供宽度设置 | 各官方文档/主题 CSS |
| 剧本专业工具 | Final Draft、Fade In、WriterDuet、Highland 清一色纸页隐喻（固定页宽、等宽字体、页数即片长） | 各官网 |
| 用户需求信号 | **双向分裂**：嫌宽与嫌窄并存；Obsidian 2021 年至今的「行宽数值调节」开放请求（跟帖：「最好的写作应用都把它做成可自定义选项」）；Typora 官方 issue #1（2015）即宽度，官方坚持固定、用户 CSS 自救 | Obsidian 论坛、Typora GitHub |
| 证据缺口 | 语雀/石墨/Effie/幕布确切行为、知乎/V2EX 中文讨论、iA Writer 官方字数、海马轻帆——证据不足，未采信 | 调研报告诚实边界 |

约束条件：`design-tokens` 要求全部视觉值走 `:root` 令牌；`editor-margin-preference` 的三档留白（compact 1rem / standard 2rem / loose 3rem，写入 `data-margin`）语义不变。

## Goals / Non-Goals

**Goals:**

- 正文以固定宽度（当前档位值）单栏居中呈现，窗口只是背景。
- 三档宽度可调：窄 640 / 标准 720（默认）/ 宽 860；档位作为应用级显示偏好持久化，重开恢复。
- 列宽不随窗口缩放、AI 停靠区三态切换而改变；空间变化时列重新居中。
- 剩余宽度不足时列收缩到可用宽度、保持居中、绝不横向滚动。
- 显示层实现为主，TS 逻辑仅限档位入口与偏好持久化。

**Non-Goals:**

- 不做连续/数值式宽度调节（调研显示档位是成本最低的成熟解；数值调节是 Obsidian 式重方案，按真实反馈再议）。
- 不做随窗口自动变宽的响应式档位（Typora 的 860→1024→1200 自动放宽与本产品「行长稳定」目标相反，明确不采用）。
- 不改文档存储、保存/恢复、版本、导出链路。
- 不改 AI 停靠区自身的布局机制。
- 不动字号、行距等排版参数（编辑器体验专项/事项 10 的地盘）。

## Decisions

1. **约束加在「稿纸元素」上，用 `max-width` + `margin-inline: auto`，不引入任何状态感知。**
   加在承载正文视觉（边框与阴影所在，按摸底应为 `.notebook-textarea`，styles.css:545–608）：
   `max-width: var(--editor-column-width); margin-inline: auto;`（辅以 `min-width: 0` 防御 flex 默认 `min-width:auto` 溢出）。
   为什么不用「按停靠区状态切 class / 媒体查询」：max-width 方案是**无状态**的——列不需要知道空间为什么变了（窗口缩放还是面板开合），剩余多少就居中多少、不足就收缩。三态路径自动被同一条规则覆盖，没有分支就没有分支 bug。
   实现时若发现稿纸视觉实际落在其他元素，约束随之落位到该元素，验收标准不变。

2. **三档值 640 / 720 / 860（px），默认标准档 720，依据换算与先例如下（正文 16px）：**

   | 档位 | 宽度 | 每行汉字 | 定位 |
   |---|---|---|---|
   | 窄 | 640px | 40 | 书籍典型区间（17–40）上沿，最「书」的手感 |
   | 标准（默认） | 720px | 45 | clreq 上限 48 之内，与 Notion（~44 字）同档 |
   | 宽 | 860px | ~53 | Typora 默认档同值；超出 clreq 书籍上限，但有主流先例，供偏好宽行的用户选择 |

   不下调 720 默认值的理由：在上限之内、与主流工具同档、比 Typora 保守；剧本对白行天然短（中文台词常 20–30 字/行），45 字对正文/动作行够用。

3. **档位实现完全镜像留白档位（`data-margin`）的既有模式：**
   `#editor-page` 上写 `data-column-width="narrow|standard|wide"` 属性；CSS 用属性选择器把 `--editor-column-width` 切到对应值（令牌仍是唯一定义处，遵守 `design-tokens`）；新建 `src/editor-column-width.ts` 镜像 `src/editor-margin.ts`（三档枚举、默认标准、共享存储适配器读写、缺失回退）；`editor-toolbar` 在留白档位入口旁增加同交互形态的宽度档位入口；应用启动时读取并应用已存档位。
   为什么镜像而不另造：一个概念一个名字、一套交互——用户学会留白档位就自动会宽度档位；持久化基建（共享存储适配器、回退语义）已有规格与测试先例可循。

4. **留白档位（`data-margin`）语义保持不变。**
   三档留白继续作为稿纸列内与列周的呼吸空间；宽窗口下两侧大片背景正是稿纸化的预期呈现，不新增背景装饰（视觉观感归事项 9 UI 全量更新管）。

5. **降级不设额外下限规则。**
   剩余宽度小于当前档位值时（极限：最小窗口 1024 ＋ 停靠区展开 ＋ 工具栏列 ≈ 450px，约 28 字/行），列收缩到可用宽度。若验收觉得过窄，调整手段是调档位令牌值或停靠区宽度，不引入第二套宽度逻辑。

## Risks / Trade-offs

- [flex 子项 `min-width:auto` 导致窄空间横向滚动] → 实现时对相关子项显式 `min-width: 0`；验收必含「最小窗口＋面板展开」场景。
- [宽档 860px（~53 字）超出 clreq 书籍行长上限，长行回扫易串行] → 有 Typora 默认档先例且用户可一键切回标准/窄档；默认档不在超限区。
- [档位×留白两套属性选择器叠加的组合复杂度] → 两组属性正交、互不引用；验收含 3×3 组合抽查。
- [既有测试或视觉断言依赖全宽行为] → 全量前端回归；如有显示层断言依赖宽度，按新行为更新断言。
- [稿纸元素定位与假设不符] → 实现第一步先确认边框/阴影实际承载元素再落约束（决策 1 的附带条件）。

## Migration Plan

CSS 改动＋小型偏好模块（镜像既有模式），无数据迁移。回滚＝还原 `src/styles.css` diff 并移除档位入口与偏好模块。
