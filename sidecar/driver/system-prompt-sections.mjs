// system-prompt-sections.mjs — 信封分层：system_prompt 拆段与 per-agent 注册
// （change: wire-system-prompt-channel 任务 1.1，design D1/D2）
//
// 宿主经 start_session.system_prompt 发来一整段制度性文本（Rust 侧纯常量组装，
// design D3）：首行＝陪想身份句，首个换行之后＝宪法红线。本模块把它注册为
// Agent 私有作用域的 system 层段落：
//   ① deployment:persona（order 0）——同名遮蔽默认英文 coding-agent persona
//      （PERSONA_SECTION 导出即为此用途，dsh-system-prompt/lib/index.js:10-18）；
//   ② nextstory:posture（order 5，身份与红线之间）——姿态挂载位，本变更注册为
//      空段占位，由 send_message.posture 轮级更新（add-posture-slot 设计 D1/D2；
//      姿态文本物理上位于红线之前，替代保障为宿主渲染的明文冲突处理原则——
//      卡内容与固定条款冲突时固定条款优先，见 chain-assembly 规格）；
//   ③ nextstory:constitution（order 10）——宪法红线；
//   ④ nextstory:chain-cards（order 20）——链路卡挂载位（仅要求卡），注册为空段
//      占位（空段渲染时被丢弃，只占住次序契约）。
// 次序不变式由 order 常量结构性保证：harness 标识段（order −100）由 DSH 固定，
// 不可移除；任何姿态内容不得置于陪想身份之上，任何要求卡不得置于红线之上。
//
// system_prompt 为空（旧宿主兼容）时不注册任何段，默认 persona 维持现状。
// 本模块纯内存、无 IO；不使用 complete:true（会压掉其余全部段落与动态 context）。
import { PERSONA_ORDER, PERSONA_SECTION } from "@deepseek-ai/dsh-system-prompt";

export const POSTURE_SECTION = "nextstory:posture";
export const POSTURE_ORDER = 5;
export const CONSTITUTION_SECTION = "nextstory:constitution";
export const CONSTITUTION_ORDER = 10;
export const CHAIN_CARDS_SECTION = "nextstory:chain-cards";
export const CHAIN_CARDS_ORDER = 20;

/**
 * 拆段协议（与 protocol.json 的 start_session.system_prompt 字段说明一致）：
 * 首行＝身份句（persona 遮蔽段文本），首个换行之后＝宪法红线段文本。
 * 无换行时整段视为身份句（红线为空）。逐字切片、不修剪——崩溃重放时
 * 宿主以相同常量重发，逐字一致由不加工保证。
 */
export function splitSystemPrompt(systemPrompt) {
  const text = typeof systemPrompt === "string" ? systemPrompt : "";
  const newline = text.indexOf("\n");
  if (newline < 0) return { identity: text, constitution: "" };
  return { identity: text.slice(0, newline), constitution: text.slice(newline + 1) };
}

/**
 * 在 Agent 私有作用域注册信封段落。调用点是 driver.mjs `createAgentFor` 的
 * setup 回调（design D1）：首条 send_message 建会话与 replay_done 重建两条
 * 路径共用同一 setup，一处注册两路一致（先例：installModelSelection）。
 *
 * `agentCtx.get("systemPrompt")` 返回绑定到调用方上下文的 traceable 服务，
 * section 注册因此落在该 Agent 的 scope 层（同名遮蔽全局段，只对本会话生效）。
 *
 * 返回各段 disposer（add-making-module-core 任务 2.2，design D1）：`section()`
 * 返回 Cordis effect disposer，注销→重注册是官方支持的用法。posture 与
 * chain-cards 的 disposer 由调用方持存——`send_message.posture` 与
 * `send_message.chain_cards` 轮级更新时先释放旧段再重注册（见 driver.mjs 的
 * applyPosture / applyChainCards，两字段各自独立幂等）；persona 与 constitution
 * 段随 Agent 生命周期存续，调用方无需手动释放。信封为空（旧宿主兼容）时不注册
 * 任何段，返回全 null。
 *
 * @returns {{persona: null|Function, constitution: null|Function, chainCards: null|Function, posture: null|Function}}
 */
export function registerSystemPromptSections(agentCtx, systemPrompt) {
  const { identity, constitution } = splitSystemPrompt(systemPrompt);
  if (identity === "" && constitution === "") {
    return { persona: null, constitution: null, chainCards: null, posture: null };
  }
  const systemPromptService = agentCtx.get("systemPrompt");
  const persona = systemPromptService.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: identity });
  // 姿态挂载位空段占位（add-posture-slot 任务 1.2，design D1）：order 5 居身份
  // （0）与红线（10）之间；无姿态卡时空段渲染丢弃，只占住次序契约。
  const posture = systemPromptService.section({ name: POSTURE_SECTION, order: POSTURE_ORDER, text: "" });
  const constitutionDisposer = systemPromptService.section({ name: CONSTITUTION_SECTION, order: CONSTITUTION_ORDER, text: constitution });
  const chainCards = systemPromptService.section({ name: CHAIN_CARDS_SECTION, order: CHAIN_CARDS_ORDER, text: "" });
  return { persona, constitution: constitutionDisposer, chainCards, posture };
}
