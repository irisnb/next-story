// seed-chains.mjs — 向隔离验收实例的应用数据目录写入一条「隔离卡配置」fixture 链路（长卡）。
// 仅写 com.nextstory.acceptance（隔离 identifier）的 making-module/chains.json；
// 不触碰用户真实实例（com.nextstory.desktop / com.nextstory.app）与任何作品正文。
// 用途：制作页长卡全文首/中/尾与版本操作区几何的真实 WebView 验收。
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const APP_DATA = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance';
const DIR = `${APP_DATA}/making-module`;
const FILE = `${DIR}/chains.json`;

if (!APP_DATA.includes('com.nextstory.acceptance')) throw new Error('拒绝：非隔离 acceptance 数据目录');

const FULL_BODY = [
  '【正文开头】这是隔离验收用的长卡正文起点，用于证明全页详情逐字呈现正文全文，不摘要不截断。',
  '第一段说明：陪想在这个视角下要用的观察方式与说话样子，与具体要求保持分离。',
  ...Array.from({ length: 8 }, (_, i) => `第${i + 2}段补充：这一段是中间内容，用来把正文撑到足够长以检验首/中/尾都能看到。`),
  '【正文中段】这是正文的中点标记，位于整段正文的中间位置，必须逐字出现。',
  ...Array.from({ length: 8 }, (_, i) => `后段第${i + 1}段：继续补充内容，确保中段之后仍有足够长度到结尾。`),
  '【正文结尾】这是隔离验收用的长卡正文终点标记，位于正文最后，必须逐字出现。',
].join('\n');

const TRIGGER = [
  '适用：【触发开头】进行需要该要求卡的讨论时使用。',
  '说明：当讨论涉及结构、节奏、人物动机等需要该要求介入的场合时启用。',
  ...Array.from({ length: 3 }, (_, i) => `补充条件${i + 1}：用于把触发描述撑长，覆盖首/中/尾。`),
  '【触发结尾】不适用：与该要求无关的场合不用。',
].join('\n');

if (TRIGGER.length > 400) throw new Error(`trigger_desc 超限: ${TRIGGER.length}`);
if (FULL_BODY.length > 2000) throw new Error(`body 超限: ${FULL_BODY.length}`);

const fixture = {
  format_version: 2,
  chains: [
    {
      id: 'chain-cdp-long-acceptance',
      name: 'CDP长卡验收链',
      created_at: '2026-10-10T00:00:00Z',
      versions: [
        {
          id: 'chainver-cdp-long-1',
          index: 1,
          created_at: '2026-10-10T00:00:01Z',
          cards: [
            {
              id: 'card-cdp-long-1',
              title: '长卡首中尾验收卡',
              trigger_desc: TRIGGER,
              body: FULL_BODY,
              slot_type: 'requirement',
            },
            {
              id: 'card-cdp-second-2',
              title: '可删除的第二张卡',
              trigger_desc: '适用：用于验证直接删除会追加新版本的历史保持。',
              body: '第二张要求卡正文，用于真实 Rust 追加新版本后核对历史版本仍保留两张卡。',
              slot_type: 'requirement',
            },
          ],
          change_note: 'CDP 隔离验收 fixture',
          trials: [],
        },
      ],
    },
  ],
  active: null,
};

mkdirSync(DIR, { recursive: true });
if (existsSync(FILE)) copyFileSync(FILE, `${FILE}.cdp-bak`);
writeFileSync(FILE, JSON.stringify(fixture, null, 2), 'utf8');
console.log(JSON.stringify({ file: FILE, bodyChars: FULL_BODY.length, triggerChars: TRIGGER.length },
  null, 2));
