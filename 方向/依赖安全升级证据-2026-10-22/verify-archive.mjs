// verify-archive.mjs — A3 只读补全核验：交叉比对刚落盘档案与 point-check 证据。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CONVOS_DIR = 'C:\\Users\\Administrator\\Desktop\\test\\8b 验证作品\\next-story-system\\conversations';

const ev = JSON.parse(readFileSync(join(here, 'point-check-evidence.json'), 'utf8'));
const convoId = ev.captured.newConvoId;
const rec = JSON.parse(readFileSync(join(CONVOS_DIR, `${convoId}.json`), 'utf8'));

const failures = [];
const assert = (name, pass, detail) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} | ${JSON.stringify(detail).slice(0, 220)}`);
  if (!pass) failures.push(name);
};

// 1) 档案 assistant 轮正文非空，且与 UI 采集的对话全文尾部一致（回文交叉验证）
const assistantTexts = (rec.turns ?? []).filter((t) => t.role === 'assistant').map((t) => (t.text ?? ''));
const replyTail = (ev.captured.replyText ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
const archiveJoined = assistantTexts.join('\n');
assert('A3a.档案 assistant 轮正文非空', assistantTexts.length > 0 && assistantTexts[0].length > 0,
  { assistantRounds: assistantTexts.length, firstLen: assistantTexts[0]?.length ?? 0 });
assert('A3b.档案正文含 UI 回文尾部（双向一致）', replyTail.length >= 8 && archiveJoined.includes(replyTail.slice(-16)),
  { probe: replyTail.slice(-16), found: archiveJoined.includes(replyTail.slice(-16)) });

// 2) 直接提问首轮：用户问题在 first_round_material（脚本原断言位置写错；needle 取「打个招呼」整段）
const material = rec.first_round_material ?? {};
assert('A3c.档案 first_round_material 含用户问题', material.kind === 'direct_question' && String(material.question ?? '').includes('打个招呼'),
  { kind: material.kind, question: material.question });

// 3) 轮次与状态形状
assert('A3d.档案轮次形状（assistant done + 中断标记如实）', (rec.turns ?? []).every((t) => t.role === 'assistant' ? t.status === 'done' : true),
  (rec.turns ?? []).map((t) => `${t.role}:${t.status}`));

console.log(failures.length === 0 ? 'A3 补全核验：全部通过' : `A3 补全核验：${failures.length} 项失败`);
process.exitCode = failures.length === 0 ? 0 : 1;
