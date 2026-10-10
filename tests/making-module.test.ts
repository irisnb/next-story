import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Window } from "happy-dom";

import { getAppDom } from "../src/dom.ts";
import { buildMaterialView } from "../src/ai-panel-view-model.ts";
import {
  buildConversationRecord,
  conversationFromRecord,
  readonlyConversationView,
  type ReadonlyTemporaryConversation,
} from "../src/ai-panel-conversation.ts";
import {
  initialAiPanelCoreState,
  reduceAiPanelState,
} from "../src/ai-panel-reducer.ts";
import { AiPanelState } from "../src/ai-panel-state.ts";
import { setupAiRequestGateway } from "../src/ai-feature-request-gateway.ts";
import type { AiFeatureContext } from "../src/ai-feature-context.ts";
import type { ConversationRecord } from "../src/conversation-archive.ts";
import type { ChainRoundRef, GenerateAiResult } from "../src/types.ts";
import { setupMaking, type MakingController } from "../src/making/making-module.ts";
import {
  buildCardPanelView,
  buildChainLibraryRows,
  buildMakingDetail,
  buildMakingMapView,
  buildMakingStatusView,
  cardSummary,
  describeChainDeletion,
  describeVersionChange,
  describeVersionTrials,
  makingTransferPrefill,
  MAKING_BASE_ITEMS,
  MAKING_DYNAMIC_ITEMS,
  MAKING_DYNAMIC_NOTE,
} from "../src/making/making-view-model.ts";
import type { Chain, ChainLibrary, ChainVersion, InvokeFn, MakingConversationRecord } from "../src/project-api.ts";

/**
 * 制作模块第四页面的分层测试（add-chain-mindmap-v0 导图重构）：
 * - 纯显示决策（view-model）：导图三区数据、统一详情 DetailModel、三态分离措辞、
 *   启用/回退承接文字、本版变化、试问记录；
 * - DOM 契约：真实 index.html 解析后 `getAppDom().making` 全量解析、缺失 id 明确报错；
 * - 控制器行为（happy-dom + 假 invoke/确认）：浏览不改变状态条、启用/回退/停用/删除
 *   全部经确认后调用后端命令、三类对象同位同尺寸快捷小窗、全页详情打开与返回、
 *   操作转制作对话、标签切换保留未发送输入、底座各版本渲染完全一致。
 */

// ========== 数据夹具 ==========

let idSeed = 0;
function nextId(prefix: string): string {
  idSeed += 1;
  return `${prefix}-${idSeed}`;
}

function version(
  index: number,
  cards: { title: string; trigger: string; body?: string; slotType?: "posture" }[],
  options: { changeNote?: string; trials?: number; trialsWithCard?: number } = {},
): ChainVersion {
  return {
    id: nextId("chainver"),
    index,
    created_at: `2026-10-06T00:00:0${index}Z`,
    // 未指定 slotType 时不写字段＝存量 v1 数据形状（读取视为要求卡）。
    cards: cards.map((card) => ({
      id: nextId("card"),
      title: card.title,
      trigger_desc: card.trigger,
      body: card.body ?? "",
      ...(card.slotType !== undefined ? { slot_type: card.slotType } : {}),
    })),
    change_note: options.changeNote ?? "",
    trials: Array.from({ length: options.trials ?? 0 }, (_, i) => ({
      trial_id: nextId("trial"),
      created_at: "2026-10-06T00:00:00Z",
      with_card: i < (options.trialsWithCard ?? options.trials ?? 0),
    })),
  };
}

function chain(name: string, versions: ChainVersion[]): Chain {
  return { id: nextId("chain"), name, created_at: "2026-10-06T00:00:00Z", versions };
}

function library(chains: Chain[], active?: { chainId: string; versionId: string }): ChainLibrary {
  return {
    format_version: 1,
    chains,
    active: active ? { chain_id: active.chainId, version_id: active.versionId } : null,
  };
}

// ========== 纯显示决策 ==========

test("card deletion saves a new viewed version and protects active history", async () => {
  const original = version(1, [{ title: "保留", trigger: "适用：a", body: "原文" }, { title: "移除", trigger: "适用：b" }]);
  const c = chain("删除测试", [original]);
  const fixture = await makingFixture(library([c], { chainId: c.id, versionId: original.id }));
  try {
    await browseChain(fixture, c.id);
    fixture.document.querySelector<HTMLButtonElement>(`[data-card-id="${original.cards[1].id}"]`)!.click();
    const del = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-quick-actions button")].find((b) => b.textContent === "删除卡片");
    assert.ok(del, "直接删除入口存在");
    fixture.confirmResult = false;
    del.click();
    await flushPromises();
    assert.equal(fixture.store.calls.filter((call) => call.cmd === "chain_save_version").length, 0);
    fixture.confirmResult = true;
    del.click();
    await flushPromises(40);
    assert.equal(fixture.store.data.chains[0].versions.length, 2);
    const saved = fixture.store.data.chains[0].versions[1];
    assert.deepEqual(saved.cards.map((card) => card.title), ["保留"]);
    assert.equal(fixture.controller.view.versionId, saved.id);
    assert.deepEqual(fixture.store.data.active, { chain_id: c.id, version_id: original.id });
    assert.equal(original.cards.length, 2);
    assert.match(fixture.confirms[fixture.confirms.length - 1], /新版本.*历史.*不自动启用/s);
  } finally { await flushPromises(40); fixture.restore(); }
});

test("last card deletion is disabled with a visible explanation", async () => {
  const c = chain("最后卡", [version(1, [{ title: "唯一", trigger: "适用：a" }])]);
  const fixture = await makingFixture(library([c]));
  try {
    await browseChain(fixture, c.id);
    fixture.document.querySelector<HTMLButtonElement>(`[data-card-id="${c.versions[0].cards[0].id}"]`)!.click();
    const del = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-quick-actions button")].find((b) => b.textContent === "删除卡片");
    assert.ok(del);
    assert.equal(del.disabled, true);
    assert.match(makingElement(fixture, "making-quick-panel").textContent!, /至少保留一张卡/);
  } finally { await flushPromises(40); fixture.restore(); }
});

test("version controls share one region outside the read-only status bar", () => {
  const { document } = parseMakingDocument();
  const enable = document.getElementById("making-enable-btn")!;
  const deactivate = document.getElementById("making-deactivate-btn")!;
  assert.equal(enable.closest(".making-version-operations"), deactivate.closest(".making-version-operations"));
  assert.ok(enable.closest(".making-version-operations"));
  assert.equal(deactivate.closest("#making-status-bar"), null);
});

for (const scenario of ["changed", "missing", "appended", "failure"] as const) {
  test(`card deletion confirmation baseline: ${scenario}`, async () => {
    const original = version(1, [{ title: "保留", trigger: "适用：a" }, { title: "删除目标", trigger: "适用：b" }]);
    const c = chain("基线测试", [original]);
    const fixture = await makingFixture(library([c], { chainId: c.id, versionId: original.id }));
    try {
      await browseChain(fixture, c.id);
      fixture.document.querySelector<HTMLButtonElement>(`[data-card-id="${original.cards[1].id}"]`)!.click();
      fixture.beforeConfirm = () => {
        if (scenario === "changed") original.cards[1].body = "确认期间改变";
        if (scenario === "missing") c.versions = [];
        if (scenario === "appended") c.versions.push(version(2, [{ title: "其他版本", trigger: "适用：c" }]));
        if (scenario === "failure") fixture.store.failures.set("chain_save_version", "磁盘不可用");
      };
      [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-quick-actions button")].find((b) => b.textContent === "删除卡片")!.click();
      await flushPromises(60);
      const writes = fixture.store.calls.filter((call) => call.cmd === "chain_save_version");
      if (scenario === "appended") {
        assert.equal(writes.length, 1);
        assert.deepEqual(c.versions[2].cards.map((card) => card.title), ["保留"]);
        assert.equal(fixture.controller.view.versionId, c.versions[2].id);
      } else {
        assert.equal(writes.length, scenario === "failure" ? 1 : 0);
        assert.equal(fixture.controller.view.versionId, original.id);
        assert.match(fixture.document.getElementById("making-status-error")!.textContent!, scenario === "failure" ? /删除卡片失败/ : /重新查看并确认/);
      }
      assert.deepEqual(fixture.store.data.active, { chain_id: c.id, version_id: original.id });
    } finally { await flushPromises(40); fixture.restore(); }
  });
}

test("full card view preserves long trigger and body from beginning through end", async () => {
  const trigger = `适用：触发开头\n${"完整触发描述\n".repeat(100)}触发结尾`;
  const body = `正文开头\n${"原样正文与空行\n\n".repeat(200)}正文中段\n${"原样正文\n".repeat(200)}正文结尾`;
  const c = chain("全文测试", [version(1, [{ title: "长卡", trigger, body }])]);
  const fixture = await makingFixture(library([c]));
  try {
    await browseChain(fixture, c.id);
    fixture.document.querySelector<HTMLButtonElement>(`[data-card-id="${c.versions[0].cards[0].id}"]`)!.click();
    assert.match(makingElement(fixture, "making-quick-panel").textContent!, /摘要/);
    fixture.document.querySelector<HTMLButtonElement>(".making-quick-open")!.click();
    await flushPromises(40);
    const full = makingElement(fixture, "making-card-panel").textContent!;
    assert.ok(full.includes(trigger), "触发描述逐字完整");
    assert.ok(full.includes(body), "正文逐字完整，包括中段、空行、结尾");
  } finally { await flushPromises(40); fixture.restore(); }
});

test("status view reflects the global active pointer and degrades honestly", () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }]), version(3, [{ title: "卡", trigger: "适用：x" }])]);
  const active = buildMakingStatusView(
    library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id }),
    null,
  );
  assert.equal(active.kind, "active");
  assert.match((active as { label: string }).label, /^当前链路：情节探索·第3版$/);

  const idle = buildMakingStatusView(library([chainA]), null);
  assert.equal(idle.kind, "idle");
  assert.equal((idle as { label: string }).label, "当前未启用链路，使用日常陪想");

  const failed = buildMakingStatusView(null, "chains.json 损坏");
  assert.equal(failed.kind, "error");
  assert.match((failed as { label: string }).label, /读取失败/);
});

test("library rows mark newer drafts only for the active chain", () => {
  const chainA = chain("情节探索", [
    version(3, [{ title: "卡", trigger: "适用：x" }]),
    version(4, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const rows = buildChainLibraryRows(
    library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[0].id }),
  );
  assert.equal(rows[0].statusLabel, "当前启用 第3版");
  assert.equal(rows[0].hasNewerDraft, true);
  assert.equal(rows[0].newerDraftIndex, 4);
  assert.equal(rows[1].isActiveChain, false);
  assert.equal(rows[1].statusLabel, "未启用");
  assert.equal(rows[1].hasNewerDraft, false, "未启用链路的新版本不算「新草稿」提示");
});

test("map view carries the three isomorphic zones with unified naming", () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
    version(3, [
      { title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时" },
      { title: "保留不同可能", trigger: "适用：y" },
    ]),
    version(4, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const data = library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id });

  const view = buildMakingMapView(data, chainA.id, chainA.versions[1].id)!;
  // 三区命名逐字：「自定义要求与姿态」「固定底座」「每轮动态」；不出现「链路可变区」。
  assert.equal(view.customZone.heading, "自定义提示词");
  assert.equal(view.customZone.affordanceLabel, "可改 · 可加");
  // 说明性副标（add-posture-slot）：不构成分区第二名称。
  assert.equal(view.customZone.subtitle, "规定回应的方向与说话方式");
  // 两组同级：要求类（现行）＋姿态类（无姿态卡时组在、卡行空）。
  assert.equal(view.customZone.requirementGroup.slotTitle, "回应要求");
  assert.equal(view.customZone.requirementGroup.cardCountLabel, "· 2 张卡");
  assert.deepEqual(
    view.customZone.requirementGroup.cards.map((card) => card.title),
    ["反差与反转", "保留不同可能"],
  );
  assert.equal(view.customZone.postureGroup.slotTitle, "回应风格");
  assert.equal(view.customZone.postureGroup.cardCountLabel, "· 0 张卡");
  assert.deepEqual(view.customZone.postureGroup.cards, []);
  assert.equal(view.baseZone.heading, "公用基础提示词");
  assert.equal(view.baseZone.suffix, "共用 · 只读");
  assert.deepEqual(view.baseZone.items, MAKING_BASE_ITEMS.map((item) => item.title));
  assert.equal(view.dynamicZone.heading, "本次问题与材料");
  assert.equal(view.dynamicZone.suffix, "自动");
  assert.deepEqual(view.dynamicZone.items, MAKING_DYNAMIC_ITEMS.map((item) => item.title));
  assert.equal(view.assemblyLabel, "组装");
  assert.equal(view.outputLabel, "完整提示词");
  assert.equal(view.outputSublabel, "发给 AI 的说明");
  assert.doesNotMatch(JSON.stringify(view), /链路可变区/, "用户可见命名统一「自定义要求与姿态」");

  // 连线数据：仅四条流线（三区→组装、组装→输出），无卡片间连线。
  assert.equal(view.wires.length, 4);
  assert.ok(view.wires.every((wire) => wire.d.startsWith("M370 ") || wire.d.startsWith("M588 ")));
});

test("map view splits requirement and posture cards into their slot groups", () => {
  // 同一版本并存：两张要求卡＋一张姿态卡（存量无类型字段的要求卡视为要求类）。
  const v = version(2, [
    { title: "反差与反转", trigger: "适用：x" },
    { title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文", slotType: "posture" },
    { title: "保留不同可能", trigger: "适用：y" },
  ]);
  const chainA = chain("情节探索", [v]);
  const view = buildMakingMapView(library([chainA]), chainA.id, v.id)!;
  assert.deepEqual(
    view.customZone.requirementGroup.cards.map((card) => card.title),
    ["反差与反转", "保留不同可能"],
    "要求组只含要求卡，顺序稳定",
  );
  assert.deepEqual(
    view.customZone.postureGroup.cards.map((card) => card.title),
    ["傲娇搭档"],
    "姿态组呈现姿态卡卡行",
  );
  assert.equal(view.customZone.requirementGroup.cardCountLabel, "· 2 张卡");
  assert.equal(view.customZone.postureGroup.cardCountLabel, "· 1 张卡");

  // 纯姿态版本允许：要求组空态说明限定要求类，姿态组照常呈现。
  const pure = version(1, [
    { title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文", slotType: "posture" },
  ]);
  const chainB = chain("纯姿态", [pure]);
  const pureView = buildMakingMapView(library([chainB]), chainB.id, pure.id)!;
  assert.deepEqual(pureView.customZone.requirementGroup.cards, []);
  assert.match(pureView.customZone.requirementGroup.emptyNote, /还没有回应要求/);
});

test("map view lists multiple posture cards side by side with honest counts", () => {
  // 2026-10-07 修订：姿态卡每版本可多张——三张并列呈现卡行，计数如实。
  const v = version(2, [
    { title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文一", slotType: "posture" },
    { title: "反差与反转", trigger: "适用：x" },
    { title: "吐槽视角", trigger: "适用：一起看剧本时", body: "正文二", slotType: "posture" },
    { title: "冷面旁观", trigger: "适用：复盘时", body: "正文三", slotType: "posture" },
  ]);
  const chainA = chain("情节探索", [v]);
  const view = buildMakingMapView(library([chainA]), chainA.id, v.id)!;
  assert.deepEqual(
    view.customZone.postureGroup.cards.map((card) => card.title),
    ["傲娇搭档", "吐槽视角", "冷面旁观"],
    "多张姿态卡并列呈现卡行，顺序稳定",
  );
  assert.equal(view.customZone.postureGroup.cardCountLabel, "· 3 张卡");
  assert.deepEqual(
    view.customZone.requirementGroup.cards.map((card) => card.title),
    ["反差与反转"],
    "要求组不受姿态卡多张影响",
  );

  // 区级详情如实计数并列出全部卡名；「添加」恒提供两类目标（有卡可继续追加）。
  const zone = buildMakingDetail(library([chainA]), chainA.id, v.id, { kind: "custom-zone" })!;
  assert.equal(zone.quickMeta, "回应要求 · 1 张卡；回应风格 · 3 张卡");
  assert.equal(zone.quickSummary, "反差与反转、傲娇搭档、吐槽视角、冷面旁观。");
  assert.deepEqual(
    zone.actions!.map((action) => action.label),
    ["请制作助手添加回应要求", "请制作助手添加回应风格"],
  );
});

test("map view separates draft viewing from the active version with concrete wording", () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时" }]),
    version(3, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
    version(4, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const data = library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id });

  // 查看启用版本：无启用入口，状态标注「当前启用版本」，标题无版本后缀。
  const activeView = buildMakingMapView(data, chainA.id, chainA.versions[1].id)!;
  assert.equal(activeView.title, "正在查看：情节探索·第3版");
  assert.equal(activeView.stateLabel, "当前启用版本");
  assert.equal(activeView.enableLabel, null);
  assert.equal(activeView.isActiveVersion, true);

  // 查看更新的草稿（第4版）：标题标注草稿，明示「尚未启用」，启用文字写明替换对象与生效范围。
  const draftView = buildMakingMapView(data, chainA.id, chainA.versions[2].id)!;
  assert.equal(draftView.title, "正在查看：情节探索·第4版（草稿）");
  assert.equal(draftView.stateLabel, "尚未启用");
  assert.equal(draftView.enableLabel, "启用「情节探索·第4版」");
  assert.equal(
    draftView.enableConfirm,
    "启用「情节探索·第4版」，替换当前「情节探索·第3版」；所有作品的下一轮提问开始使用。",
  );
  assert.equal(draftView.isRollback, false);

  // 查看更早版本（第1版，启用第3版）：标题标注历史版本；回退场景，确认文字呈现保留承诺。
  const rollbackView = buildMakingMapView(data, chainA.id, chainA.versions[0].id)!;
  assert.equal(rollbackView.title, "正在查看：情节探索·第1版（历史版本）");
  assert.equal(rollbackView.isRollback, true);
  assert.equal(rollbackView.enableLabel, "回退到「情节探索·第1版」");
  assert.match(rollbackView.rollbackConfirm!, /较新版本及试问证据保留/);
  assert.match(rollbackView.rollbackConfirm!, /回退到「情节探索·第1版」，替换当前第3版/);

  // 版本记录倒序（最新在前）。
  assert.deepEqual(
    activeView.versionOptions.map((option) => option.label),
    ["第4版（最新）", "第3版", "第1版"],
  );
});

test("enable wording states first-time activation without a replacement target", () => {
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const view = buildMakingMapView(library([chainB]), chainB.id, chainB.versions[0].id)!;
  assert.equal(view.enableLabel, "启用「对话打磨·第1版」");
  assert.equal(
    view.enableConfirm,
    "启用「对话打磨·第1版」；所有作品的下一轮提问开始使用。",
  );
});

test("card summary truncates the first line of the trigger description only", () => {
  assert.equal(cardSummary("适用：探索情节可能性时\n不适用：只讨论台词情绪时"), "适用：探索情节可能性时");
  const long = `适用：${"长".repeat(50)}`;
  const summary = cardSummary(long);
  assert.equal(summary.length, 41, "40 字＋省略号");
  assert.ok(summary.endsWith("…"), "截断加省略号");
  assert.ok(summary.startsWith("适用："), "截断保留开头");
  assert.equal(cardSummary(""), "");
  assert.equal(cardSummary("\n\n适用：换行后首行\n不适用：x"), "适用：换行后首行", "跳过空行取首个非空行");
});

test("version change and trial descriptions stay honest and complete", () => {
  const first = version(1, [{ title: "旧思路", trigger: "适用：x" }], { changeNote: "初稿" });
  const second = version(
    2,
    [{ title: "反差与反转", trigger: "适用：x" }, { title: "保留卡", trigger: "适用：y" }],
    { changeNote: "换思路" },
  );
  assert.equal(describeVersionChange(first, null), "本版是第 1 个版本；变更说明：初稿。");
  assert.equal(
    describeVersionChange(second, first),
    "相对上一版：新增「反差与反转」「保留卡」；移除「旧思路」；变更说明：换思路。",
  );
  const untouched = version(3, [
    { title: "反差与反转", trigger: "适用：x" },
    { title: "保留卡", trigger: "适用：y" },
  ]);
  assert.equal(describeVersionChange(untouched, second), "相对上一版：卡片组成无增删。");

  assert.equal(describeVersionTrials(first), "尚无试问记录");
  const trialed = version(4, [{ title: "保留卡", trigger: "适用：y" }], { trials: 3, trialsWithCard: 2 });
  assert.equal(describeVersionTrials(trialed), "本版共有 3 次试问记录（带卡 2 次、对照 1 次）。");
});

test("card panel carries the full body and the five required items", () => {
  const body = "先指出当前场景的人物动机，再给出两种可能走向，由用户决定。".repeat(3);
  const v1 = version(1, [{ title: "反差与反转", trigger: "适用：a\n不适用：b", body }]);
  const chainA = chain("情节探索", [v1]);
  const panel = buildCardPanelView(library([chainA]), chainA.id, v1.id, v1.cards[0])!;
  assert.match(panel.identity, /卡名「反差与反转」/);
  assert.match(panel.identity, /插槽：回应要求/);
  assert.match(panel.identity, /情节探索·第1版/);
  assert.equal(panel.whenToUse, "适用：a\n不适用：b");
  assert.equal(panel.howTo, body, "正文全文透传，不做概括");
  assert.equal(panel.trialsLabel, "尚无试问记录");

  const empty = version(2, [{ title: "无正文卡", trigger: "适用：a", body: "" }]);
  const chainB = chain("乙", [empty]);
  const emptyPanel = buildCardPanelView(library([chainB]), chainB.id, empty.id, empty.cards[0])!;
  assert.equal(emptyPanel.howTo, "（无正文）");
});

test("posture card panel shows its slot, stored description, and the fixed note", () => {
  const body = "你的出场姿态：嘴硬心软……底线不换皮。";
  const v = version(1, [
    { title: "傲娇搭档", trigger: "适用：日常陪想全程\n不适用：无", body, slotType: "posture" },
  ]);
  const chainA = chain("情节探索", [v]);
  const panel = buildCardPanelView(library([chainA]), chainA.id, v.id, v.cards[0])!;
  // 身份行插槽＝姿态类；「何时用」＝所存描述＋固定说明（不自动切换）；「怎么做」正文原样。
  assert.match(panel.identity, /插槽：回应风格/);
  assert.match(panel.whenToUse, /^适用：日常陪想全程/);
  assert.match(panel.whenToUse, /供你判断何时选择此姿态，不会据此自动切换/);
  assert.equal(panel.howTo, body, "姿态卡正文原样，不概括不改写");
});

test("detail model unifies the three clickable sources with per-source operability", () => {
  const v3 = version(3, [
    { title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时", body: "正文" },
    { title: "保留不同可能", trigger: "适用：y" },
  ]);
  const chainA = chain("情节探索", [version(1, [{ title: "旧卡", trigger: "适用：x" }]), v3, version(4, [{ title: "反差与反转", trigger: "适用：x" }])]);
  const data = library([chainA], { chainId: chainA.id, versionId: v3.id });

  // 卡片：快捷摘要＋五项全页详情＋底部三操作（修改／删除／添加，转制作对话）。
  const card = buildMakingDetail(data, chainA.id, v3.id, { kind: "card", cardId: v3.cards[0].id })!;
  assert.equal(card.kind, "card");
  assert.equal(card.title, "反差与反转");
  assert.equal(card.quickMeta, "摘要 · 回应要求 · 情节探索·第3版");
  assert.equal(card.quickSummary, "适用：探索情节可能性时");
  assert.equal(card.quickHelp, "不适用：只讨论台词情绪时");
  assert.equal(card.quickNote, null, "要求卡不带姿态固定说明");
  assert.equal(card.hasFullDetail, true);
  assert.equal(card.eyebrow, "回应要求 / 反差与反转");
  assert.equal(card.card!.howTo, "正文", "怎么做＝完整正文");
  assert.deepEqual(
    card.actions!.map((action) => action.label),
    ["请制作助手修改", "删除卡片", "请制作助手添加回应要求"],
  );
  assert.equal(card.actions![0].cardTitle, "反差与反转");
  assert.equal(card.actions![2].cardTitle, null, "添加落在插槽层");

  // 草稿版本的卡片 meta 明示「尚未启用」。
  const draft = buildMakingDetail(data, chainA.id, chainA.versions[2].id, {
    kind: "card",
    cardId: chainA.versions[2].cards[0].id,
  })!;
  assert.equal(draft.quickMeta, "摘要 · 回应要求 · 情节探索·第4版 · 尚未启用");

  // 固定底座／每轮动态：只读、无任何操作或配置控件，但有完整详情入口。
  const base = buildMakingDetail(data, chainA.id, v3.id, { kind: "base" })!;
  assert.equal(base.title, "公用基础提示词 · 共用 · 只读");
  assert.equal(base.actions, null);
  assert.equal(base.hasFullDetail, true);
  assert.deepEqual(
    base.readonlyItems!.map((item) => item.title),
    MAKING_BASE_ITEMS.map((item) => item.title),
  );

  const dynamic = buildMakingDetail(data, chainA.id, v3.id, { kind: "dynamic" })!;
  assert.equal(dynamic.title, "本次问题与材料 · 自动");
  assert.equal(dynamic.actions, null);
  assert.equal(dynamic.hasFullDetail, true);
  assert.deepEqual(
    dynamic.readonlyItems!.map((item) => item.title),
    MAKING_DYNAMIC_ITEMS.map((item) => item.title),
  );
  assert.equal(dynamic.readonlyNote, MAKING_DYNAMIC_NOTE);

  // 自定义要求区／添加说明：快捷小窗说明＋「添加」操作；无全页形态。
  const zone = buildMakingDetail(data, chainA.id, v3.id, { kind: "custom-zone" })!;
  assert.equal(zone.title, "自定义提示词 · 可改 · 可加");
  assert.equal(zone.quickMeta, "回应要求 · 2 张卡；回应风格 · 0 张卡");
  assert.equal(zone.hasFullDetail, false);
  // 无姿态卡时：区级「添加」明确两类目标（要求卡＋姿态卡）。
  assert.deepEqual(
    zone.actions!.map((action) => action.label),
    ["请制作助手添加回应要求", "请制作助手添加回应风格"],
  );

  const add = buildMakingDetail(data, chainA.id, v3.id, { kind: "add-card" })!;
  assert.equal(add.title, "回应要求 · 添加回应要求");
  assert.equal(add.hasFullDetail, false);
  assert.deepEqual(add.actions!.map((action) => action.action), ["add"]);

  const addPosture = buildMakingDetail(data, chainA.id, v3.id, { kind: "add-posture-card" })!;
  assert.equal(addPosture.title, "回应风格 · 添加回应风格");
  assert.equal(addPosture.hasFullDetail, false);
  assert.equal(addPosture.quickSummary, "在回应风格中加入一张卡（每版本可多张）。");
  assert.deepEqual(
    addPosture.actions!.map((action) => action.label),
    ["请制作助手添加回应风格"],
  );

  // 来源失效（卡片不存在）：诚实返回 null。
  assert.equal(buildMakingDetail(data, chainA.id, v3.id, { kind: "card", cardId: "card-none" }), null);
});

test("posture card detail names its slot and omits the posture add entry", () => {
  const v = version(2, [
    { title: "反差与反转", trigger: "适用：x" },
    { title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文", slotType: "posture" },
  ]);
  const chainA = chain("情节探索", [v]);
  const data = library([chainA]);
  const postureCard = v.cards[1]!;

  const detail = buildMakingDetail(data, chainA.id, v.id, { kind: "card", cardId: postureCard.id })!;
  assert.equal(detail.quickMeta, "摘要 · 回应风格 · 情节探索·第2版 · 尚未启用");
  assert.equal(detail.eyebrow, "回应风格 / 傲娇搭档");
  assert.equal(detail.quickNote, "供你判断何时选择此姿态，不会据此自动切换");
  // 已有姿态卡：卡片详情不提供「添加」入口（修改／删除照常，均转制作对话）。
  assert.deepEqual(
    detail.actions!.map((action) => action.label),
    ["请制作助手修改", "删除卡片"],
  );
  assert.equal(detail.actions![0].cardTitle, "傲娇搭档");

  // 有姿态卡时区级「添加」仍提供两类目标（2026-10-07 修订：姿态卡可多张、可继续追加）。
  const zone = buildMakingDetail(data, chainA.id, v.id, { kind: "custom-zone" })!;
  assert.equal(zone.quickMeta, "回应要求 · 1 张卡；回应风格 · 1 张卡");
  assert.deepEqual(
    zone.actions!.map((action) => action.label),
    ["请制作助手添加回应要求", "请制作助手添加回应风格"],
  );
});

test("detail transfer prefill names the action and the target card", () => {
  assert.equal(
    makingTransferPrefill({ action: "modify", label: "请制作助手修改", cardTitle: "反差与反转" }),
    "请制作助手修改「反差与反转」：",
  );
  assert.equal(
    makingTransferPrefill({ action: "delete", label: "请制作助手删除", cardTitle: "反差与反转" }),
    "请制作助手删除「反差与反转」：",
  );
  assert.equal(
    makingTransferPrefill({ action: "add", label: "请制作助手添加回应要求", cardTitle: null }),
    "请制作助手添加回应要求：",
  );
  // 「添加」明确目标卡类型：姿态类入口的预填写明姿态卡。
  assert.equal(
    makingTransferPrefill({ action: "add", label: "请制作助手添加回应风格", cardTitle: null }),
    "请制作助手添加回应风格：",
  );
  // 姿态卡的修改／删除照常点名目标卡。
  assert.equal(
    makingTransferPrefill({ action: "modify", label: "请制作助手修改", cardTitle: "傲娇搭档" }),
    "请制作助手修改「傲娇搭档」：",
  );
});

test("chain deletion wording states scope and irreversibility", () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const message = describeChainDeletion(chainA);
  assert.match(message, /删除链路「情节探索」\？/);
  assert.match(message, /1 个版本与全部试问证据将被删除，不可恢复/);
  assert.match(message, /作品正文与日常讨论不受影响/);
});

// ========== 「本次参考了什么」的本轮链路行（任务 7.7） ==========

function conversationWithChainRounds(
  chainRounds?: readonly ChainRoundRef[],
  provenanceDefined = true,
): ReadonlyTemporaryConversation {
  return {
    id: "c-1",
    createdAt: "t0",
    anchor: null,
    initialUserMaterial: { kind: "direct_question", question: "问", selection_text: null },
    firstResponse: "答",
    firstRoundInterrupted: false,
    turns: [],
    pending: null,
    ...(provenanceDefined
      ? {
          provenance: [
            { document_id: "doc-1", material_type: "focus_document", document_version: "v1", turn_index: 0, entered_model_context: true },
            { document_id: "doc-1", material_type: "focus_document", document_version: "v2", turn_index: 1, entered_model_context: true },
          ],
        }
      : {}),
    ...(chainRounds !== undefined ? { chain_rounds: chainRounds } : {}),
  } as unknown as ReadonlyTemporaryConversation;
}

test("material view maps chain rounds by turn index with the locked field shape", () => {
  const view = buildMaterialView(conversationWithChainRounds([
    { turn_index: 0, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 },
    { turn_index: 1, chain_id: "chain-1", chain_name: "情节探索", version_index: 4 },
  ]))!;
  assert.equal(view.unavailable, false);
  assert.equal(view.rounds.length, 2);
  assert.equal(view.rounds[0].chainLabel, "本轮链路：情节探索·第3版");
  assert.equal(view.rounds[1].chainLabel, "本轮链路：情节探索·第4版");
  // 材料出处行不受链路行影响（同构并存）。
  assert.equal(view.rounds[0].sources.length, 1);
});

test("material view degrades chain line to hidden when the record lacks chain rounds", () => {
  const view = buildMaterialView(conversationWithChainRounds(undefined))!;
  assert.equal(view.rounds.length, 2);
  assert.ok(view.rounds.every((round) => round.chainLabel === null), "缺失降级不显示");

  const empty = buildMaterialView(conversationWithChainRounds([]))!;
  assert.ok(empty.rounds.every((round) => round.chainLabel === null), "空数组同样不显示");

  // 旧档案缺材料出处（unavailable）：链路行一并降级，不虚构轮次。
  const legacy = buildMaterialView(conversationWithChainRounds(
    [{ turn_index: 0, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 }],
    false,
  ))!;
  assert.equal(legacy.unavailable, true);
  assert.deepEqual(legacy.rounds, []);
});

test("material view keeps a chain-only round visible without inventing sources", () => {
  const view = buildMaterialView(conversationWithChainRounds([
    { turn_index: 2, chain_id: "chain-1", chain_name: "情节探索", version_index: 3 },
  ]))!;
  const labels = view.rounds.map((round) => round.roundLabel);
  assert.deepEqual(labels, ["首轮", "第 1 轮", "第 2 轮"], "纯链路轮次也进入分轮视图");
  const chainOnly = view.rounds[2];
  assert.equal(chainOnly.chainLabel, "本轮链路：情节探索·第3版");
  assert.equal(chainOnly.sources.length, 0, "不虚构材料出处");
});

// ========== DOM 契约（真实 index.html） ==========

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

interface ParsedMakingPage {
  window: Window;
  document: Document;
}

function parseMakingDocument(): ParsedMakingPage {
  const window = new Window();
  const document = new window.DOMParser().parseFromString(htmlSource, "text/html") as unknown as Document;
  return { window, document };
}

function installDocument(document: Document): () => void {
  const previous = globalThis.document;
  globalThis.document = document;
  return () => { globalThis.document = previous; };
}

function dispatchEvent(page: ParsedMakingPage, element: Element, type: string): void {
  const event = new page.window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event;
  element.dispatchEvent(event);
}

test("real index.html resolves the complete making DOM contract", () => {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  try {
    const making = getAppDom().making;
    assert.ok(making.moduleRoot);
    assert.ok(making.statusBar);
    assert.ok(making.statusText);
    assert.ok(making.deactivateBtn);
    assert.ok(making.chainLibrary);
    assert.ok(making.newChainBtn);
    assert.ok(making.chainList);
    assert.ok(making.inspectorTitle);
    assert.ok(making.versionSelect);
    assert.ok(making.enableBtn);
    // 导图契约：图区容器、连线 SVG、三区、统一详情两挂载位。
    assert.ok(making.graph);
    assert.ok(making.wires);
    assert.ok(making.wirePaths);
    assert.ok(making.zoneCustom);
    assert.ok(making.zoneCustomTrigger);
    assert.ok(making.zoneScroll);
    assert.ok(making.cardList);
    assert.ok(making.addCardBtn);
    // add-posture-slot：分区副标与姿态组为 index.html 静态节点（与要求类组同构），
    // 这里验证解析结果真实存在于文档且挂在正确的锚点下。
    assert.equal(making.zoneSubtitle.textContent, "规定回应的方向与说话方式");
    assert.ok(making.zoneCustom.contains(making.zoneSubtitle), "副标在分区标题下方");
    assert.ok(making.postureGroup);
    assert.equal(making.postureGroup.getAttribute("aria-label"), "回应风格");
    assert.ok(making.zoneScroll.contains(making.postureGroup), "姿态组在分区单一滚动区内");
    assert.ok(making.zoneScroll.contains(making.postureCardList));
    assert.equal(making.addPostureCardBtn.textContent, "＋ 添加回应风格");
    assert.ok(making.addPostureCardBtn.closest(".making-card-group") === making.postureGroup, "入口归姿态组");
    // 同一文档重复解析返回同一元素。
    const again = getAppDom().making;
    assert.equal(again.postureGroup, making.postureGroup);
    assert.equal(again.zoneSubtitle, making.zoneSubtitle);
    assert.ok(making.baseNode);
    assert.ok(making.dynamicNode);
    assert.ok(making.quickPanel);
    assert.ok(making.fullDetail);
    assert.ok(making.fullBackBtn);
    assert.ok(making.cardPanel);
    assert.ok(making.fullReadonly);
    assert.ok(making.readingNotes);
    assert.ok(making.conversationBody);
    assert.ok(making.conversationStartBtn);
    assert.ok(making.conversationInput);
    assert.ok(making.viewMapBtn);
    assert.ok(making.viewChatBtn);
    assert.ok(making.libraryToggle);
  } finally {
    restore();
  }
});

test("missing making node fails assembly with its identifier", () => {
  const page = parseMakingDocument();
  page.document.getElementById("making-status-text")?.remove();
  const restore = installDocument(page.document);
  try {
    assert.throws(() => getAppDom(), /#making-status-text/);
  } finally {
    restore();
  }
});

// ========== 控制器行为（happy-dom + 假 invoke / 假确认） ==========

/** 内存链路库：按后端语义响应命令（追加版本、只动指针、删除保留其他链路）。 */
class FakeChainStore {
  data: ChainLibrary;
  /** 内存制作会话档案（making_conversation_list 的数据源）。 */
  makingConversations: MakingConversationRecord[] = [];
  readonly calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  /** 需要模拟失败的命令名→错误信息（注入后下次调用即抛错）。 */
  readonly failures = new Map<string, string>();
  invoke: InvokeFn;

  constructor(data: ChainLibrary) {
    this.data = data;
    this.invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      this.calls.push({ cmd, args });
      const failure = this.failures.get(cmd);
      if (failure !== undefined) throw new Error(failure);
      switch (cmd) {
        case "chain_library_load":
          return structuredClone(this.data) as T;
        case "making_conversation_list": {
          const ofChain = this.makingConversations
            .filter((record) => record.chain_id === args?.chainId)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          return {
            conversations: ofChain.map((record) => ({
              id: record.id,
              chain_id: record.chain_id,
              title: record.title,
              created_at: record.created_at,
              updated_at: record.updated_at,
              turn_count: record.turns.length,
            })),
            skipped: [],
          } as T;
        }
        case "chain_create": {
          const created: Chain = {
            id: nextId("chain"),
            name: String(args?.name ?? "").trim(),
            created_at: "2026-10-06T00:00:00Z",
            versions: [],
          };
          this.data.chains.push(created);
          return structuredClone(created) as T;
        }
        case "chain_save_version": {
          const target = this.data.chains.find((item) => item.id === args?.chainId);
          if (!target) throw new Error("链路不存在");
          const saved: ChainVersion = {
            id: nextId("version"), index: target.versions.length + 1,
            created_at: "2026-10-10T00:00:00Z", change_note: String(args?.changeNote), trials: [],
            cards: (args?.cards as ChainVersion["cards"]).map((card) => ({ ...card, id: nextId("card") })),
          };
          target.versions.push(saved);
          return structuredClone(saved) as T;
        }
        case "chain_set_active":
        case "chain_rollback": {
          this.data.active = {
            chain_id: String(args?.chainId),
            version_id: String(args?.versionId),
          };
          return undefined as T;
        }
        case "chain_deactivate":
          this.data.active = null;
          return undefined as T;
        case "trial_list_for_version":
          // 详情面板的「试问记录」栏按版本读证据列表；本夹具无证据。
          return { trials: [] } as T;
        case "chain_delete": {
          this.data.chains = this.data.chains.filter((chain) => chain.id !== args?.chainId);
          if (this.data.active?.chain_id === args?.chainId) this.data.active = null;
          return undefined as T;
        }
        default:
          throw new Error(`测试存储未实现的命令：${cmd}`);
      }
    };
  }
}

interface MakingFixture {
  controller: MakingController;
  store: FakeChainStore;
  confirms: string[];
  confirmResult: boolean;
  beforeConfirm?: () => void;
  page: ParsedMakingPage;
  document: Document;
  restore: () => void;
}

async function makingFixture(data: ChainLibrary): Promise<MakingFixture> {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  const store = new FakeChainStore(data);
  const confirms: string[] = [];
  const fixture: MakingFixture = {
    store,
    confirms,
    confirmResult: true,
    page,
    document: page.document,
    restore,
    controller: null as unknown as MakingController,
  };
  fixture.controller = setupMaking(getAppDom().making, {
    call: store.invoke,
    confirm: async (message) => {
      confirms.push(message);
      fixture.beforeConfirm?.();
      return fixture.confirmResult;
    },
  });
  await flushPromises();
  return fixture;
}

async function flushPromises(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

function makingElement(fixture: MakingFixture, id: string): HTMLElement {
  const element = fixture.document.getElementById(id);
  assert.ok(element, `缺少 #${id}`);
  return element;
}

function click(fixture: MakingFixture, id: string): void {
  (makingElement(fixture, id) as unknown as { click(): void }).click();
  void flushPromises();
}

async function browseChain(fixture: MakingFixture, chainId: string): Promise<void> {
  const row = fixture.document.querySelector<HTMLButtonElement>(`[data-chain-id="${chainId}"]`);
  assert.ok(row, "链路行已渲染");
  row.click();
  await flushPromises();
}

test("status bar tracks the global active chain and ignores browsing", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时\n不适用：只讨论台词情绪时" }]),
    version(3, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const chainB = chain("对话打磨", [version(1, [{ title: "语气克制", trigger: "适用：对白打磨" }])]);
  const fixture = await makingFixture(library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[1].id }));
  try {
    const active = makingElement(fixture, "making-status-active");
    const idle = makingElement(fixture, "making-status-idle");
    assert.equal(active.classList.contains("hidden"), false);
    assert.equal(idle.classList.contains("hidden"), true);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第3版/);

    fixture.controller.setMakingObject(chainA.id);
    assert.match(fixture.document.querySelector(`[data-chain-id="${chainA.id}"]`)?.textContent ?? "", /正在制作/);

    // 浏览另一条链路：导图标题变化，状态条不变（三态分离）。
    await browseChain(fixture, chainB.id);
    assert.match(makingElement(fixture, "making-inspector-title").textContent ?? "", /正在查看：对话打磨·第1版/);
    assert.equal(makingElement(fixture, "making-inspector-state").textContent, "尚未启用");
    assert.match(fixture.document.querySelector(`[data-chain-id="${chainB.id}"]`)?.textContent ?? "", /正在查看/);
    assert.doesNotMatch(fixture.document.querySelector(`[data-chain-id="${chainB.id}"]`)?.textContent ?? "", /正在制作|已启用/);
    assert.match(fixture.document.querySelector(`[data-chain-id="${chainA.id}"]`)?.textContent ?? "", /正在制作.*已启用/);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第3版/);
  } finally {
    fixture.restore();
  }
});

test("empty library guides the user to describe needs and stays idle", async () => {
  const fixture = await makingFixture(library([]));
  try {
    assert.equal(makingElement(fixture, "making-chain-empty").classList.contains("hidden"), false);
    assert.match(makingElement(fixture, "making-status-idle").textContent ?? "", /当前未启用链路，使用日常陪想/);
    assert.equal(makingElement(fixture, "making-status-active").classList.contains("hidden"), true);
  } finally {
    fixture.restore();
  }
});

test("load failure surfaces an explicit error instead of a fake state", async () => {
  const page = parseMakingDocument();
  const restore = installDocument(page.document);
  const failing: InvokeFn = async <T,>(cmd: string): Promise<T> => {
    if (cmd === "chain_library_load") throw new Error("chains.json 损坏");
    throw new Error(`不应调用 ${cmd}`);
  };
  setupMaking(getAppDom().making, { call: failing });
  await flushPromises();
  try {
    const error = page.document.getElementById("making-status-error");
    assert.ok(error);
    assert.equal(error.classList.contains("hidden"), false);
    assert.match(error.textContent ?? "", /损坏/);
    const active = page.document.getElementById("making-status-active");
    const idle = page.document.getElementById("making-status-idle");
    assert.equal(active?.classList.contains("hidden"), true);
    assert.equal(idle?.classList.contains("hidden"), true);
  } finally {
    restore();
  }
});

test("the map renders zones, wires, and the reading notes with exact semantics", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时" }]),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    // happy-dom 不计算布局；给出两档真实形状，验证连线端点随节点移动。
    const bounds = (selector: string, x: number, y: number, width: number, height: number) => {
      const element = fixture.document.querySelector(selector);
      assert.ok(element);
      Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({
        x, y, left: x, top: y, right: x + width, bottom: y + height, width, height,
      }) });
    };
    bounds("#making-graph", 100, 100, 600, 368);
    bounds("#making-zone-custom", 100, 100, 306, 236);
    bounds("#making-base-node", 100, 350, 306, 52);
    bounds("#making-dynamic-node", 100, 416, 306, 52);
    bounds(".making-assembly-node", 454, 259, 108, 50);
    bounds("#making-output-node", 592, 249, 108, 70);
    await browseChain(fixture, chainA.id);
    // 三区命名与插槽组。
    const zone = makingElement(fixture, "making-zone-custom");
    assert.equal(zone.getAttribute("aria-label"), "自定义提示词");
    assert.equal(makingElement(fixture, "making-custom-trigger").textContent, "自定义提示词");
    assert.match(zone.textContent ?? "", /规定回应的方向与说话方式/, "分区说明性副标呈现");
    assert.match(zone.textContent ?? "", /回应要求/);
    assert.match(zone.textContent ?? "", /回应风格/, "姿态组与要求组同级呈现");
    assert.match(makingElement(fixture, "making-card-count").textContent ?? "", /· 1 张卡/);
    assert.match(makingElement(fixture, "making-base-node").textContent ?? "", /公用基础提示词/);
    assert.match(makingElement(fixture, "making-dynamic-node").textContent ?? "", /本次问题与材料/);
    // 自定义要求区定高单一滚动：两组卡行与 ghost 都在同一滚动容器内（组内无独立滚动）。
    const scroll = makingElement(fixture, "making-zone-scroll");
    assert.equal(scroll.getAttribute("aria-label"), "自定义提示词内容，可滚动");
    assert.ok(scroll.contains(makingElement(fixture, "making-card-list")), "要求组卡行在滚动内容内");
    assert.ok(scroll.contains(makingElement(fixture, "making-add-card-btn")), "要求组 ghost 在滚动内容尾部");
    assert.ok(scroll.contains(makingElement(fixture, "making-posture-card-list")), "姿态组在滚动内容内");
    assert.ok(scroll.contains(makingElement(fixture, "making-add-posture-btn")), "姿态组入口在滚动内容内");
    assert.equal(scroll.querySelectorAll(".making-zone-scroll").length, 0, "组内无嵌套独立滚动区");
    // 无姿态卡：姿态组呈现同式 ghost 入口，不显示灰色占位假卡或「解锁」入口。
    const postureGhost = makingElement(fixture, "making-add-posture-btn") as HTMLButtonElement;
    assert.equal(postureGhost.hidden, false);
    assert.equal(postureGhost.textContent, "＋ 添加回应风格");
    assert.equal(postureGhost.className, makingElement(fixture, "making-add-card-btn").className, "两组入口同式 ghost 样式");
    assert.equal(makingElement(fixture, "making-posture-card-list").children.length, 0, "无占位假卡");
    assert.match(makingElement(fixture, "making-posture-card-count").textContent ?? "", /· 0 张卡/);
    // 箭头只在连线 SVG：四条流线全部带 marker-end，卡行之间无任何 svg/path。
    const paths = [...fixture.document.querySelectorAll("#making-wire-paths path")];
    assert.equal(paths.length, 4, "三区→组装 ×3＋组装→输出 ×1");
    assert.ok(paths.every((path) => path.getAttribute("marker-end") === "url(#making-arrow)"));
    assert.equal(paths[0]!.getAttribute("d"), "M 306 118 H 330 V 184 H 354");
    assert.equal(paths[3]!.getAttribute("d"), "M 462 184 H 492");
    bounds("#making-graph", 100, 100, 540, 368);
    bounds("#making-zone-custom", 100, 100, 266, 236);
    bounds(".making-assembly-node", 398, 259, 96, 50);
    bounds("#making-output-node", 524, 249, 96, 70);
    await fixture.controller.refresh();
    assert.equal(fixture.document.querySelector("#making-wires")!.getAttribute("viewBox"), "0 0 540 368");
    assert.equal(fixture.document.querySelector("#making-wire-paths path")!.getAttribute("d"), "M 266 118 H 282 V 184 H 298");
    assert.equal(fixture.document.querySelectorAll("#making-card-list svg, #making-card-list path").length, 0);
    // 阅读说明条三句逐字，位于图区容器之外。
    const notes = makingElement(fixture, "making-reading-notes");
    assert.equal(makingElement(fixture, "making-graph").contains(notes), false, "阅读说明条在图区容器外");
    assert.match(notes.textContent ?? "", /箭头只表示流向组装，不表示卡片执行顺序/);
    assert.match(notes.textContent ?? "", /启用对象是整个链路版本/);
    assert.match(notes.textContent ?? "", /展示链路的组装结构与适用条件，不代表 AI 内部思考过程。/);
    // 输出块不可点形态：非按钮元素。
    assert.equal(makingElement(fixture, "making-output-node").tagName, "DIV");
  } finally {
    fixture.restore();
  }
});

test("the posture group lists multiple card rows and keeps the add entry always present", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文", slotType: "posture" }]),
    version(2, [
      { title: "反差与反转", trigger: "适用：x" },
      { title: "傲娇搭档", trigger: "适用：日常陪想全程", body: "正文", slotType: "posture" },
      { title: "冷面旁观", trigger: "适用：复盘讨论时", body: "正文", slotType: "posture" },
    ]),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    // 浏览默认落在最新版（第2版，两类并存且姿态卡两张）：要求组一张、姿态组两张并列，互不混组。
    await browseChain(fixture, chainA.id);
    assert.equal(fixture.document.querySelectorAll("#making-card-list .making-card-row").length, 1);
    const postureRows = [...fixture.document.querySelectorAll<HTMLButtonElement>("#making-posture-card-list .making-card-row")];
    assert.equal(postureRows.length, 2, "多张姿态卡卡行并列呈现");
    assert.deepEqual(
      postureRows.map((row) => row.dataset.cardId),
      [chainA.versions[1]!.cards[1]!.id, chainA.versions[1]!.cards[2]!.id],
    );
    assert.match(postureRows[0]!.textContent ?? "", /傲娇搭档/);
    assert.match(postureRows[1]!.textContent ?? "", /冷面旁观/);
    // 入口常驻（2026-10-07 修订）：有姿态卡时仍可继续追加，与要求类入口同式。
    const addBtn = makingElement(fixture, "making-add-posture-btn") as HTMLButtonElement;
    assert.equal(addBtn.hidden, false, "有姿态卡时追加入口常驻");
    assert.match(makingElement(fixture, "making-posture-card-count").textContent ?? "", /· 2 张卡/);

    // 切回第1版（纯姿态版本）：要求组空态说明限定要求类；姿态组照常呈现卡行、入口仍常驻。
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[0]!.id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();
    assert.equal(makingElement(fixture, "making-card-list").children.length, 0);
    assert.match(makingElement(fixture, "making-no-cards").textContent ?? "", /还没有回应要求/, "要求组空态不误称「还没有卡片」");
    assert.equal(fixture.document.querySelectorAll("#making-posture-card-list .making-card-row").length, 1);
    assert.equal((makingElement(fixture, "making-add-posture-btn") as HTMLButtonElement).hidden, false, "纯姿态版本入口同样常驻");

    // 姿态卡行点开统一详情：身份插槽＝姿态类（快捷 meta）＋固定说明。
    const purePostureRow = fixture.document.querySelector<HTMLButtonElement>("#making-posture-card-list .making-card-row");
    assert.ok(purePostureRow);
    purePostureRow.click();
    await flushPromises();
    const host = makingElement(fixture, "making-quick-panel");
    assert.equal(host.dataset.source, "card");
    assert.match(host.textContent ?? "", /回应风格 · 情节探索·第1版/);
    assert.match(host.textContent ?? "", /供你判断何时选择此姿态，不会据此自动切换/);
  } finally {
    fixture.restore();
  }
});

test("the posture add entry transfers to the making conversation with an explicit type", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "反差与反转", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    // 姿态组 ghost：沿用现行「＋添加要求卡」机制——点开统一快捷小窗。
    click(fixture, "making-add-posture-btn");
    const host = makingElement(fixture, "making-quick-panel");
    assert.equal(host.dataset.source, "add-posture-card");
    assert.match(host.textContent ?? "", /回应风格 · 添加回应风格/);
    assert.match(host.textContent ?? "", /导图不直接编辑/);
    assert.equal(makingElement(fixture, "making-add-posture-btn").getAttribute("aria-expanded"), "true");
    // 「添加」明确目标类型：转入制作对话（不改全局启用指针），焦点落输入区。
    const add = [...fixture.document.querySelectorAll<HTMLButtonElement>("#making-quick-panel button")]
      .find((button) => button.textContent === "请制作助手添加回应风格");
    assert.ok(add);
    add.click();
    await flushPromises();
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "chat", "切到「制作对话」标签");
    assert.equal(fixture.controller.makingChainId, chainA.id, "转接是显式的制作对象切换");
    const input = makingElement(fixture, "making-conversation-input") as HTMLTextAreaElement;
    assert.match(input.value, /^请制作助手添加回应风格：$/);
    assert.equal(makingElement(fixture, "making-quick-panel").classList.contains("hidden"), true, "小窗已收起");
    // 不改全局启用指针：浏览未启用链路发起转接后，状态条仍是未启用。
    assert.equal(makingElement(fixture, "making-status-idle").classList.contains("hidden"), false);
  } finally {
    fixture.restore();
  }
});

test("the fixed base renders identically across chains, versions, and states", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "卡", trigger: "适用：x" }]),
    version(2, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    await browseChain(fixture, chainA.id);
    const baseline = makingElement(fixture, "making-base-node").outerHTML;
    // 切版本（草稿）与切链路后逐字节一致。
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[1].id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();
    assert.equal(makingElement(fixture, "making-base-node").outerHTML, baseline);
    await browseChain(fixture, chainB.id);
    assert.equal(makingElement(fixture, "making-base-node").outerHTML, baseline);
  } finally {
    fixture.restore();
  }
});

test("three detail sources open the same quick window host in turn", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：探索情节可能性时", body: "正文" }]),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    const host = makingElement(fixture, "making-quick-panel");
    // 卡片 → 底座 → 每轮动态：同一个挂载元素轮流承载，位置与尺寸由结构统一。
    const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
    assert.ok(cardRow, "卡片行已渲染");
    cardRow.click();
    await flushPromises();
    assert.equal(host.classList.contains("hidden"), false);
    assert.equal(host.dataset.source, "card");
    assert.match(host.textContent ?? "", /反差与反转/);
    assert.match(host.textContent ?? "", /打开完整详情/);
    assert.equal(cardRow.getAttribute("aria-expanded"), "true");

    click(fixture, "making-base-node");
    assert.equal(host.dataset.source, "base");
    assert.match(host.textContent ?? "", /公用基础提示词 · 共用 · 只读/);
    assert.match(host.textContent ?? "", /红线/);
    assert.equal(cardRow.getAttribute("aria-expanded"), "false", "上一个来源的展开态复位");

    click(fixture, "making-dynamic-node");
    assert.equal(host.dataset.source, "dynamic");
    assert.match(host.textContent ?? "", /本次问题与材料 · 自动/);
    // 只读来源的小窗没有任何操作按钮（仅「关闭详情」与「打开完整详情」）。
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    assert.deepEqual([...buttons].sort(), ["关闭详情", "打开完整详情"]);

    // 关闭即回：小窗收起、展开态复位；再次点开仍走同一挂载位。
    const close = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "关闭详情");
    assert.ok(close, "关闭入口已渲染");
    close.click();
    await flushPromises();
    assert.equal(host.classList.contains("hidden"), true);
    assert.equal(makingElement(fixture, "making-dynamic-node").getAttribute("aria-expanded"), "false");
    click(fixture, "making-base-node");
    assert.equal(host.classList.contains("hidden"), false);
    assert.equal(host.dataset.source, "base");
  } finally {
    fixture.restore();
  }
});

test("quick window stays in place for upper and lower cards", async () => {
  const chainA = chain("情节探索", [
    version(1, [
      { title: "上卡", trigger: "适用：上" },
      { title: "下卡", trigger: "适用：下" },
    ]),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    const rows = [...fixture.document.querySelectorAll<HTMLButtonElement>(".making-card-row")];
    assert.equal(rows.length, 2);
    rows[0].click();
    await flushPromises();
    const host = makingElement(fixture, "making-quick-panel");
    const firstWindow = host.querySelector(".making-quick-window");
    assert.ok(firstWindow);
    assert.match(host.textContent ?? "", /上卡/);
    // 点下方卡：同一挂载元素、同一窗口形态，仅内容变化（不随来源位移）。
    rows[1].click();
    await flushPromises();
    assert.equal(makingElement(fixture, "making-quick-panel"), host);
    assert.equal(host.querySelector(".making-quick-window")?.classList.contains("making-quick-window"), true);
    assert.match(host.textContent ?? "", /下卡/);
    assert.doesNotMatch(host.textContent ?? "", /上卡/);
  } finally {
    fixture.restore();
  }
});

test("full detail occupies the map view and returns to the quick window", async () => {
  const body = "先指出人物动机，再给两种走向，由用户决定。";
  const chainA = chain("情节探索", [
    version(2, [{ title: "反差与反转", trigger: "适用：探索情节可能性时", body }], { trials: 1 }),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
    cardRow!.click();
    await flushPromises();

    // 打开完整详情：图区整体让位，卡片五项完整可达（怎么做＝完整正文）。
    const openFull = fixture.document.querySelector<HTMLButtonElement>(".making-quick-open");
    assert.ok(openFull, "「打开完整详情」入口已渲染");
    openFull.click();
    await flushPromises();
    const full = makingElement(fixture, "making-full-detail");
    assert.equal(full.classList.contains("hidden"), false);
    assert.equal(makingElement(fixture, "making-graph").classList.contains("hidden"), true, "图区整体隐藏");
    const panel = makingElement(fixture, "making-card-panel");
    const headings = [...panel.querySelectorAll(".making-card-panel-heading")].map((node) => node.textContent);
    assert.deepEqual(headings, ["身份", "何时用", "怎么做", "本版变化", "试问记录"]);
    const bodies = [...panel.querySelectorAll(".making-card-panel-body")].map((node) => node.textContent);
    assert.match(bodies[0]!, /卡名「反差与反转」/);
    assert.equal(bodies[2], body, "完整正文");
    assert.match(bodies[4]!, /1 次试问记录/);
    assert.match(makingElement(fixture, "making-full-eyebrow").textContent ?? "", /回应要求 \/ 反差与反转/);

    // 返回导图：恢复图区与原来源（卡片）的快捷小窗，不跳回别的来源。
    // 返回会重渲染卡片五项并再排一轮试问记录的异步读取（trial_list_for_version
    // 的续段要建 DOM）——等完该异步再结束用例，避免续段在夹具销毁、全局 document
    // 复位后才执行。
    click(fixture, "making-full-back");
    await flushPromises();
    assert.equal(makingElement(fixture, "making-full-detail").classList.contains("hidden"), true);
    assert.equal(makingElement(fixture, "making-graph").classList.contains("hidden"), false);
    const host = makingElement(fixture, "making-quick-panel");
    assert.equal(host.classList.contains("hidden"), false);
    assert.equal(host.dataset.source, "card", "返回后恢复原来源的快捷窗");
  } finally {
    fixture.restore();
  }
});

test("readonly full details carry no operation controls", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    // 固定底座：只读详情无任何修改／删除／添加控件。
    click(fixture, "making-base-node");
    const openBase = fixture.document.querySelector<HTMLButtonElement>(".making-quick-open");
    assert.ok(openBase);
    openBase.click();
    await flushPromises();
    const readonlyMount = makingElement(fixture, "making-full-readonly");
    assert.equal(readonlyMount.classList.contains("hidden"), false);
    assert.equal(readonlyMount.querySelectorAll("button, input, select, textarea").length, 0, "只读详情零控件");
    assert.match(readonlyMount.textContent ?? "", /AI 不改写你的文档/);
    assert.equal(makingElement(fixture, "making-card-panel").classList.contains("hidden"), true, "卡片挂载位不出现");

    // 每轮动态：同一形式，含「自动」尾注。
    click(fixture, "making-full-back");
    click(fixture, "making-dynamic-node");
    const openDynamic = fixture.document.querySelector<HTMLButtonElement>(".making-quick-open");
    assert.ok(openDynamic);
    openDynamic.click();
    await flushPromises();
    assert.match(readonlyMount.textContent ?? "", /不是可配置的链路要求/);
    assert.equal(readonlyMount.querySelectorAll("button, input, select, textarea").length, 0);
  } finally {
    fixture.restore();
  }
});

test("card detail actions transfer to the making conversation", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "反差与反转", trigger: "适用：x", body: "正文" }]),
  ]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
    cardRow!.click();
    await flushPromises();
    // 快捷小窗内「请制作助手修改」：转入制作对话（复用既有通道）。
    const modify = [...fixture.document.querySelectorAll<HTMLButtonElement>("#making-quick-panel button")]
      .find((button) => button.textContent === "请制作助手修改");
    assert.ok(modify, "修改操作已渲染");
    modify.click();
    await flushPromises();
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "chat", "切到「制作对话」标签");
    assert.equal(fixture.controller.makingChainId, chainA.id, "转接是显式的制作对象切换");
    assert.ok(fixture.controller.conversation.currentConversationId, "无会话时开启新制作会话");
    const input = makingElement(fixture, "making-conversation-input") as HTMLTextAreaElement;
    assert.match(input.value, /^请制作助手修改「反差与反转」：$/);
    assert.equal(makingElement(fixture, "making-quick-panel").classList.contains("hidden"), true, "小窗已收起");
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /情节探索/);

    // 回到导图后，「添加」经 ghost 说明面板走同一通道。
    fixture.controller.setActiveView("map");
    await flushPromises();
    click(fixture, "making-add-card-btn");
    assert.match(makingElement(fixture, "making-quick-panel").textContent ?? "", /导图不直接编辑/);
    const add = [...fixture.document.querySelectorAll<HTMLButtonElement>("#making-quick-panel button")]
      .find((button) => button.textContent === "请制作助手添加回应要求");
    assert.ok(add);
    add.click();
    await flushPromises();
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "chat");
    assert.match(
      (makingElement(fixture, "making-conversation-input") as HTMLTextAreaElement).value,
      /^请制作助手添加回应要求：$/,
    );
  } finally {
    fixture.restore();
  }
});

test("cards carry no enable switch; enabling stays at the version level", async () => {
  const chainA = chain("情节探索", [
    version(3, [{ title: "反差与反转", trigger: "适用：x" }]),
  ]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    await browseChain(fixture, chainA.id);
    const cardRow = fixture.document.querySelector<HTMLButtonElement>(".making-card-row");
    cardRow!.click();
    await flushPromises();
    const host = makingElement(fixture, "making-quick-panel");
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    assert.ok(labels.every((label) => !/启用|停用|回退/.test(label ?? "")), "卡片上无启用开关");
    // 启用入口只在导图头部（链路版本层级），且沿用既有确认措辞。
    const enable = makingElement(fixture, "making-enable-btn") as HTMLButtonElement;
    assert.equal(enable.hidden, true, "查看版本即启用版本时无入口");
  } finally {
    fixture.restore();
  }
});

test("enabling a draft version requires confirmation with concrete wording", async () => {
  const chainA = chain("情节探索", [
    version(3, [{ title: "卡", trigger: "适用：x" }]),
    version(4, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    // 先查看该链路，再通过版本下拉切到第 4 版草稿。
    await browseChain(fixture, chainA.id);
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[1].id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();
    assert.equal(makingElement(fixture, "making-inspector-title").textContent, "正在查看：情节探索·第4版（草稿）");
    assert.equal(makingElement(fixture, "making-inspector-state").textContent, "尚未启用");

    const enable = makingElement(fixture, "making-enable-btn") as HTMLButtonElement;
    assert.equal((enable as HTMLElement).hidden, false);
    assert.match(enable.textContent ?? "", /启用「情节探索·第4版」/);

    // 拒绝确认：不调用命令，状态条不变。
    fixture.confirmResult = false;
    enable.click();
    await flushPromises();
    assert.equal(fixture.store.calls.filter((call) => call.cmd === "chain_set_active").length, 0);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /第3版/);

    // 同意确认：命令携带链路与版本，状态条更新为第 4 版。
    fixture.confirmResult = true;
    enable.click();
    await flushPromises();
    const setActive = fixture.store.calls.find((call) => call.cmd === "chain_set_active");
    assert.ok(setActive, "chain_set_active 已调用");
    assert.equal(setActive!.args?.chainId, chainA.id);
    assert.equal(setActive!.args?.versionId, chainA.versions[1].id);
    assert.match(fixture.confirms[0]!, /替换当前「情节探索·第3版」/);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第4版/);
  } finally {
    fixture.restore();
  }
});

test("rolling back to an older version calls chain_rollback after confirmation", async () => {
  const chainA = chain("情节探索", [
    version(1, [{ title: "卡", trigger: "适用：x" }]),
    version(3, [{ title: "卡", trigger: "适用：x" }]),
  ]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[1].id }));
  try {
    await browseChain(fixture, chainA.id);
    const select = makingElement(fixture, "making-version-select") as HTMLSelectElement;
    select.value = chainA.versions[0].id;
    dispatchEvent(fixture.page, select, "change");
    await flushPromises();

    const enable = makingElement(fixture, "making-enable-btn") as HTMLButtonElement;
    assert.match(enable.textContent ?? "", /回退到「情节探索·第1版」/);
    enable.click();
    await flushPromises();
    const rollback = fixture.store.calls.find((call) => call.cmd === "chain_rollback");
    assert.ok(rollback, "chain_rollback 已调用");
    assert.equal(rollback!.args?.versionId, chainA.versions[0].id);
    assert.match(fixture.confirms[0]!, /较新版本及试问证据保留/);
    assert.match(makingElement(fixture, "making-status-text").textContent ?? "", /当前链路：情节探索·第1版/);
  } finally {
    fixture.restore();
  }
});

test("deactivating returns to the daily companion and keeps archives", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    click(fixture, "making-deactivate-btn");
    await flushPromises();
    assert.ok(fixture.store.calls.some((call) => call.cmd === "chain_deactivate"));
    assert.equal(makingElement(fixture, "making-status-idle").classList.contains("hidden"), false);
    assert.equal(makingElement(fixture, "making-status-active").classList.contains("hidden"), true);
    assert.equal(fixture.store.data.chains.length, 1, "链路保留");
  } finally {
    fixture.restore();
  }
});

test("deleting a chain requires confirmation and clears dangling references", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA, chainB], { chainId: chainA.id, versionId: chainA.versions[0].id }));
  try {
    // 浏览 A 并把 A 设为制作对象，再删除 A。
    await browseChain(fixture, chainA.id);
    click(fixture, "making-conversation-start-btn");
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /情节探索/);

    fixture.confirmResult = false;
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    assert.equal(fixture.store.calls.filter((call) => call.cmd === "chain_delete").length, 0, "未确认不删除");

    fixture.confirmResult = true;
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    assert.ok(fixture.store.calls.some((call) => call.cmd === "chain_delete" && call.args?.chainId === chainA.id));
    assert.match(fixture.confirms[0]!, /不可恢复/);
    assert.equal(fixture.controller.makingChainId, null, "制作对象悬空已清理");
    assert.equal(fixture.controller.view.chainId, null, "浏览对象悬空已清理");
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /未选择/);
    assert.equal(fixture.store.data.chains.length, 1, "其他链路不受影响");
  } finally {
    fixture.restore();
  }
});

test("starting a new making session switches the object only by explicit action", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const chainB = chain("对话打磨", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA, chainB]));
  try {
    // 浏览 A 后再浏览 B：制作对象保持「未选择」（浏览不切换制作对象）。
    await browseChain(fixture, chainA.id);
    await browseChain(fixture, chainB.id);
    assert.equal(fixture.controller.makingChainId, null);
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /未选择/);

    // 「开始新制作」是显式动作：以当前浏览对象为制作对象。
    click(fixture, "making-conversation-start-btn");
    assert.equal(fixture.controller.makingChainId, chainB.id);
    assert.match(makingElement(fixture, "making-conversation-object").textContent ?? "", /对话打磨/);
    // 新会话会自动发「链路现状」附言轮（本夹具未实现制作命令，走快速失败路径）：
    // 等完该异步再结束用例，避免续段在夹具销毁、全局 document 复位后才执行。
    await flushPromises(24);
  } finally {
    fixture.restore();
  }
});

test("creating a chain calls the backend with the trimmed name and views it", async () => {
  const fixture = await makingFixture(library([]));
  try {
    click(fixture, "making-new-chain-btn");
    const input = makingElement(fixture, "making-new-chain-name") as HTMLInputElement;
    input.value = "  情节探索  ";
    const form = makingElement(fixture, "making-new-chain-form");
    dispatchEvent(fixture.page, form, "submit");
    await flushPromises();
    const created = fixture.store.calls.find((call) => call.cmd === "chain_create");
    assert.ok(created, "chain_create 已调用");
    assert.equal(created!.args?.name, "情节探索");
    assert.equal(fixture.controller.view.chainId, fixture.store.data.chains[0].id, "新建后直接查看");
    assert.match(makingElement(fixture, "making-inspector-empty").textContent ?? "", /还没有版本/);
    assert.equal(fixture.controller.makingChainId, null, "新建是查看动作，不切换制作对象");
  } finally {
    fixture.restore();
  }
});

test("tab switch keeps unsent input and browsing position", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  try {
    await browseChain(fixture, chainA.id);
    const inspector = makingElement(fixture, "making-inspector");
    inspector.scrollTop = 42;
    const input = makingElement(fixture, "making-conversation-input") as HTMLTextAreaElement;
    input.value = "未发送的草稿";

    fixture.controller.setActiveView("chat");
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "chat");
    assert.equal(input.value, "未发送的草稿", "未发送输入保留");

    fixture.controller.setActiveView("map");
    assert.equal(makingElement(fixture, "module-making").dataset.makingView, "map");
    assert.equal(inspector.scrollTop, 42, "浏览位置保留");
    assert.equal(input.value, "未发送的草稿");
  } finally {
    fixture.restore();
  }
});

test("command failures surface as honest errors without success states", async () => {
  const chainA = chain("情节探索", [version(1, [{ title: "卡", trigger: "适用：x" }])]);
  const fixture = await makingFixture(library([chainA]));
  fixture.store.failures.set("chain_delete", "链路库写入失败: 磁盘满");
  try {
    await browseChain(fixture, chainA.id);
    click(fixture, "making-delete-chain-btn");
    await flushPromises();
    const error = makingElement(fixture, "making-status-error");
    assert.equal(error.classList.contains("hidden"), false);
    assert.match(error.textContent ?? "", /链路库写入失败/);
    assert.equal(fixture.store.data.chains.length, 1, "链路仍在（未谎报成功）");
  } finally {
    fixture.restore();
  }
});

// ========== 7.7 链路行携带：类型携带、映射、降级与保存不携带 ==========

function chainRoundOf(turn: number, version: number): ChainRoundRef {
  return { turn_index: turn, chain_id: "chain-1", chain_name: "情节探索", version_index: version };
}

function recordWithChainRounds(chainRounds?: readonly ChainRoundRef[] | null): ConversationRecord {
  return {
    version: 1,
    conversation_id: "c-1",
    created_at: "t0",
    updated_at: "t0",
    focus_document_id: null,
    focus_document_title: null,
    first_round_material: { kind: "direct_question", question: "问", selection_text: null },
    turns: [
      { role: "user", text: "问", status: "done" },
      { role: "assistant", text: "答", status: "done" },
    ],
    provenance: [],
    ...(chainRounds !== undefined ? { chain_rounds: chainRounds } : {}),
  };
}

test("conversationFromRecord carries archive chain rounds and degrades when missing", () => {
  const carried = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3)]));
  assert.deepEqual(carried.chain_rounds, [chainRoundOf(0, 3)]);

  // 旧档案缺失字段（undefined）与显式 null：都降级为无记录，显示层不显示。
  assert.equal(conversationFromRecord(recordWithChainRounds(undefined)).chain_rounds, undefined);
  assert.equal(conversationFromRecord(recordWithChainRounds(null)).chain_rounds, undefined);
});

test("buildConversationRecord never carries chain rounds (backend narrow update owns them)", () => {
  const conversation = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3)]));
  const record = buildConversationRecord(conversation, null, null);
  assert.equal("chain_rounds" in record, false, "普通整档保存不携带链路轮次记录");
});

test("readonlyConversationView freezes carried chain rounds", () => {
  const conversation = conversationFromRecord(recordWithChainRounds([chainRoundOf(0, 3), chainRoundOf(1, 4)]));
  const view = readonlyConversationView(conversation)!;
  assert.deepEqual(view.chain_rounds, [chainRoundOf(0, 3), chainRoundOf(1, 4)]);
  assert.ok(Object.isFrozen(view.chain_rounds));
  assert.ok(Object.isFrozen(view.chain_rounds![0]));
});

test("record_round_chain merges by turn, replaces same turn, and dedupes identical entries", () => {
  const base = initialAiPanelCoreState();
  const withDiscussion = reduceAiPanelState(base, {
    type: "begin_direct_question",
    question: "问",
    selection: null,
    conversationId: "c-1",
    createdAt: "t0",
    focusDocumentId: null,
    focusDocumentTitle: null,
  });
  const loading = reduceAiPanelState(withDiscussion, {
    type: "succeed_direct_question",
    response: "答",
    conversationId: "c-1",
  });
  const discussionBefore = loading.discussions.get("c-1")!;
  assert.ok(discussionBefore.conversation, "前置：直接提问成功后已建立对话");

  const first = reduceAiPanelState(loading, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 3),
  });
  assert.deepEqual(first.discussions.get("c-1")!.conversation!.chain_rounds, [chainRoundOf(0, 3)]);

  // 同轮新版本：覆盖同轮旧记录；同轮排序稳定。
  const replaced = reduceAiPanelState(first, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 4),
  });
  assert.deepEqual(replaced.discussions.get("c-1")!.conversation!.chain_rounds, [chainRoundOf(0, 4)]);

  // 完全相同的记录：不产生新状态（引用不变）。
  const identical = reduceAiPanelState(replaced, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(0, 4),
  });
  assert.equal(identical, replaced, "重复记录不产生新状态");

  // 不同轮：按 turn_index 排序追加。
  const secondTurn = reduceAiPanelState(replaced, {
    type: "record_round_chain",
    conversationId: "c-1",
    entry: chainRoundOf(1, 5),
  });
  assert.deepEqual(
    secondTurn.discussions.get("c-1")!.conversation!.chain_rounds,
    [chainRoundOf(0, 4), chainRoundOf(1, 5)],
  );

  // 不存在的讨论：原样返回。
  const missing = reduceAiPanelState(secondTurn, {
    type: "record_round_chain",
    conversationId: "c-none",
    entry: chainRoundOf(0, 3),
  });
  assert.equal(missing, secondTurn);
});

/** 网关测试用的最小上下文桩：只实现直接提问路径实际触及的访问器。 */
function stubGatewayContext(state: AiPanelState, result: GenerateAiResult): AiFeatureContext {
  const transport = {
    sendViaResidentSession: async (): Promise<GenerateAiResult> => result,
  };
  return {
    state,
    getProjectToken: () => 1,
    advanceProjectToken: () => {},
    isDestroyed: () => false,
    markDestroyed: () => {},
    getTransport: () => transport,
    getScheduler: () => null,
    getCoordinator: () => null,
    getSelectionEntry: () => null,
    getAiDock: () => null,
    loadConfig: null,
    getCurrentProjectPath: () => null,
    getCurrentDocumentTitle: () => null,
    getCurrentTree: () => null,
    getCurrentDocumentVersion: () => null,
    getCurrentDocumentId: () => null,
    getCurrentEditor: () => null,
    hiddenDocumentIds: () => new Set<string>(),
  } as unknown as AiFeatureContext;
}

test("gateway merges result chain_round into the live discussion and the material view shows it", async () => {
  const state = new AiPanelState();
  state.beginDirectQuestion("问", null, null, null);
  const conversationId = state.activeConversationId;
  assert.ok(conversationId);

  const result: GenerateAiResult = {
    ok: true,
    content: "答",
    provenance: [{ document_id: "doc-1", material_type: "focus_document", version: "v1" }],
    sent_confirmed: true,
    chain_round: chainRoundOf(0, 3),
  };
  const persisted: string[] = [];
  const gateway = setupAiRequestGateway({
    context: stubGatewayContext(state, result),
    persistDiscussion: (id) => persisted.push(id),
    refreshOnDemandState: () => {},
  });

  const accepted = gateway.requestDirectQuestion(conversationId!, { kind: "direct_question", question: "问" });
  assert.ok(accepted, "请求已受理");
  await accepted;

  const conversation = state.getDiscussion(conversationId!)?.conversation;
  assert.ok(conversation, "成功后已建立对话");
  assert.deepEqual(conversation!.chain_rounds, [chainRoundOf(0, 3)], "结果携带的链路引用并入讨论对象");
  assert.deepEqual(persisted, [conversationId!], "终态编排照常触发档案保存");

  // 显示层（fix-4 已接好）经并入的记录自动出「本轮链路」行。
  const view = buildMaterialView(readonlyConversationView(conversation!) as ReadonlyTemporaryConversation);
  assert.equal(view!.rounds.length, 1);
  assert.equal(view!.rounds[0].chainLabel, "本轮链路：情节探索·第3版");
});
