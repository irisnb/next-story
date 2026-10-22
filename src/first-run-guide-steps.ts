// 首启引导四卡文案（纯数据，first-run-guide-and-help）。
// 逐字取自 openspec/changes/first-run-guide-and-help/design.md 附录 A 定稿；
// 改文案只动本文件，不动控制器（src/first-run-guide.ts）。

export interface FirstRunGuideStep {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const FIRST_RUN_GUIDE_STEPS: readonly FirstRunGuideStep[] = [
  {
    title: "这是一款陪你写故事的软件",
    paragraphs: [
      "你写，AI 陪想——稿子永远是你的，AI 一个字不会替你改。把你心里那个故事写出来吧。",
    ],
  },
  {
    title: "「项目」就是个文件夹",
    paragraphs: [
      "一个「项目」，就是你电脑上的一个文件夹：这个故事的所有稿子、资料、聊天记录都存在里面，一直在你自己的硬盘上。",
      "现在就点下方的「新建项目」开始；写过的，从「最近项目」打开。",
    ],
  },
  {
    title: "核心是 AI 陪想",
    paragraphs: [
      "你写，它看；你问，它答。它自动看着你正在写的那篇——没保存的也算，不用复制粘贴，也不用切出去。",
      "两种问法：选中一段点「AI」，围绕这段来聊；直接在「AI陪想」里打字，围绕当前编辑的文档聊。",
      "第一次用，先完成 API 配置（设置页有相关步骤介绍）。",
    ],
  },
  {
    title: "开始之后",
    paragraphs: [
      "进去就能写——新项目自带一篇空文档。想用 AI，先去「设置 → API 连接」完成 API 配置，帮助里有一步步的说明。",
      "卡住的时候，「设置 → 帮助」能重看这份引导、翻常见问题。",
    ],
  },
];
