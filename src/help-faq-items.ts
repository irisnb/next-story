// 设置页「帮助」分区 FAQ 十一条文案（纯数据，first-run-guide-and-help）。
// 逐字对应 openspec/changes/first-run-guide-and-help/design.md 附录 B 定稿；
// 改文案只动本文件，不动渲染与接线（src/help-section.ts）。
// 服务商官网链接经 librarian 逐家核验（2026-10-22）；上线后建议定期复核有效性。

export interface HelpFaqLink {
  readonly label: string;
  readonly url: string;
}

export interface HelpFaqItem {
  readonly question: string;
  readonly answer: string;
  /** 可选：答案后附的官网直达链接（如 AI 服务商列表）。 */
  readonly links?: readonly HelpFaqLink[];
}

export const HELP_FAQ_ITEMS: readonly HelpFaqItem[] = [
  {
    question: "界面四个标签各管什么？",
    answer:
      "「写作」是你的稿纸，写和改都在这；「文档管理」是项目的资料柜，新建、导入、导出文档都在这；「制作」给 AI 定回应方式（详见\"制作页怎么用\"）；「设置」管连接 AI 和稿纸显示。",
  },
  {
    question: "会自动保存吗？",
    answer:
      "平时是手动的：写完点顶栏「保存」。切到别的文档前，会自动先把当前这篇存好；直接关窗口会被拦下来确认，不会悄悄丢稿。",
  },
  {
    question: "API 是什么？怎么获取？",
    answer:
      "API 是你使用 AI 服务的通道：软件里填的「API 地址」是通道入口，「API Key」是证明你身份的钥匙（像密码，别外传），「模型名」是你要用的那个 AI。获取方法：去一家 AI 服务商的官网注册、开通 API 服务、领取 API Key——不少家新用户有免费额度。国内常用的几家（点官网直达）：",
    links: [
      { label: "智谱开放平台（GLM 系列，本软件实测所用）", url: "https://bigmodel.cn" },
      { label: "DeepSeek 开放平台", url: "https://platform.deepseek.com" },
      { label: "阿里云百炼（通义千问）", url: "https://bailian.aliyun.com" },
      { label: "Kimi 开放平台（月之暗面）", url: "https://platform.kimi.com" },
      { label: "火山方舟（豆包）", url: "https://console.volcengine.com/ark" },
      { label: "腾讯混元", url: "https://cloud.tencent.com/product/hunyuan" },
      { label: "百度千帆（文心）", url: "https://cloud.baidu.com/product/qianfan" },
      { label: "讯飞开放平台（星火）", url: "https://www.xfyun.cn" },
    ],
  },
  {
    question: "AI 怎么连？连不上怎么办？",
    answer:
      "去「设置 → API 连接」填三项：API 地址、API Key、模型名，都在你的 AI 服务商那里拿（Key 像密码，别外传）。先点「测试连接」，再点「保存设置」。连不上就按提示逐项核对；Key 失效去服务商重新领；接入说明在服务商网站。",
  },
  {
    question: "AI 怎么用？",
    answer:
      "打开「AI陪想」面板直接打字。回复逐字出现，嫌慢点「停止」，出来的不会丢。新话题点「新建讨论」；旧的都在「讨论」列表里，随时回来接着聊。同时生成的数量有限，多出来的自动排队。",
  },
  {
    question: "它到底看了我哪些东西？",
    answer:
      "你开一场讨论时正在写的那篇（包括还没保存的改动）。想换一篇：在面板里切换，从下一句问话开始生效。其他文档它只按你问题里提到的词去搜已保存的正文（有数量上限）。每轮它参考了什么，点「本次参考了什么」一条条可查。",
  },
  {
    question: "\"让我再读几篇\"是怎么回事？",
    answer:
      "材料不够时它会申请补读。你允许它才去，只读已保存的正文，只读不改；不让，它也照样尽力答，并说明哪里依据不足。授权跟着这场讨论走，随时可以关。",
  },
  {
    question: "有没有它不能看的？",
    answer: "你标为不可读的文档、回收站里的内容，永远不提供给 AI。",
  },
  {
    question: "AI 会改我的稿子吗？",
    answer:
      "永远不会。AI 的回复都是临时材料，不是稿子；哪句想要，你自己复制、粘贴、改好、保存——笔，永远在你手里。",
  },
  {
    question: "制作页怎么用？",
    answer:
      "把你对 AI 的要求做成一套套「链路」。在「制作对话」里说需求、制作助手帮你起草，可以「试问」过目，满意了再「启用」，从下一轮生效。保存会产生新版本，旧版本随时换回；「导图」展示一套链路的提示词怎么组装。制作助手不读你的稿子；制作与日常聊天完全分开；链路一次做好、所有项目通用。",
  },
  {
    question: "怎么重看软件引导？",
    answer: "「设置 → 帮助 → 重看软件引导」，随时重放。",
  },
];
