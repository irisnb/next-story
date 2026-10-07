import {
  trialGet,
  trialListForVersion,
  trialSetFeedback,
  type InvokeFn,
  type TrialRecord,
} from "../project-api.ts";
import {
  TRIAL_RECORD_READONLY_NOTE,
  trialFeedbackSummary,
  trialQuestionPreview,
  trialRecordTag,
  trialReplyTextOf,
  trialRunKindLabel,
  trialTimeLabel,
} from "./making-trial.ts";

/**
 * 卡片检视面板「试问记录」栏（add-making-module-core 任务 6.2 前端）：
 * 按 `trial_list_for_version` 列出某链路版本的试问证据（问题摘要、带卡/对照标注、
 * 时间、反馈摘要），点击展开**只读详情**（`trial_get`：问题全文、回复全文、反馈）。
 *
 * 硬性边界（spec「试问机制」只读查看）：详情内**不提供任何继续追问的输入**；
 * 唯一的输入框是「记录反馈」（空白提交＝清除）。列表读取失败如实呈现错误行，
 * 不静默吞掉，也不影响面板其余四项。
 */

/** 挂载试问记录区（清空容器后填充：汇总行＋记录列表；异步加载完成后填充行）。 */
export function mountTrialRecords(options: {
  /** 挂载容器（每次检视面板重渲染由调用方新建；加载完成后校验连接状态防串台）。 */
  readonly container: HTMLElement;
  readonly chainId: string;
  readonly versionId: string;
  /** 汇总行文字（`describeVersionTrials` 的「N 次试问记录」口径）。 */
  readonly summary: string;
  readonly call?: InvokeFn;
}): void {
  const { container, chainId, versionId, summary, call } = options;
  container.replaceChildren();
  container.className = "making-trial-records-mount";
  const summaryLine = document.createElement("p");
  summaryLine.className = "making-card-panel-body";
  summaryLine.textContent = summary;
  const listBox = document.createElement("div");
  listBox.className = "making-trial-records";
  container.append(summaryLine, listBox);
  void loadRecords(listBox, chainId, versionId, call, null);
}

/** 载入记录列表；`keepTrialId` 表示重载后保持该条展开（反馈保存后的就地刷新）。 */
async function loadRecords(
  listBox: HTMLElement,
  chainId: string,
  versionId: string,
  call: InvokeFn | undefined,
  keepTrialId: string | null,
): Promise<void> {
  try {
    const result = await trialListForVersion(chainId, versionId, call);
    // 检视面板可能已被重渲染（换卡/换版本/链路库刷新）：旧容器不再接线就丢弃结果。
    if (!listBox.isConnected) return;
    renderRecordRows(listBox, result.trials, chainId, versionId, call, keepTrialId);
  } catch (error) {
    if (!listBox.isConnected) return;
    listBox.replaceChildren(recordErrorLine(`读取试问记录失败：${errorMessage(error)}`));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordErrorLine(text: string): HTMLElement {
  const line = document.createElement("p");
  line.className = "making-trial-record-error";
  line.textContent = text;
  return line;
}

/** 渲染记录行（倒序由后端保证：最新在前）。 */
function renderRecordRows(
  listBox: HTMLElement,
  trials: readonly TrialRecord[],
  chainId: string,
  versionId: string,
  call: InvokeFn | undefined,
  keepTrialId: string | null,
): void {
  listBox.replaceChildren();
  if (trials.length === 0) {
    const empty = document.createElement("p");
    empty.className = "making-trial-record-empty";
    empty.textContent = "这条版本还没有试问记录。";
    listBox.append(empty);
    return;
  }
  for (const trial of trials) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "making-trial-record-row";
    row.dataset.trialId = trial.id;
    row.setAttribute("aria-expanded", "false");
    row.textContent =
      `【${trialRecordTag(trial.with_card)}】${trialQuestionPreview(trial.question)} · ` +
      `${trialTimeLabel(trial.created_at)} · ${trialFeedbackSummary(trial.feedback)}`;
    listBox.append(row);
    const detailHolder = document.createElement("div");
    detailHolder.className = "making-trial-record-detail-holder";
    listBox.append(detailHolder);
    row.addEventListener("click", () => {
      const expanded = detailHolder.hasChildNodes();
      if (expanded) {
        detailHolder.replaceChildren();
        row.setAttribute("aria-expanded", "false");
        return;
      }
      row.setAttribute("aria-expanded", "true");
      void openRecordDetail(detailHolder, trial.id, chainId, versionId, call);
    });
    if (trial.id === keepTrialId) {
      row.setAttribute("aria-expanded", "true");
      void openRecordDetail(detailHolder, trial.id, chainId, versionId, call);
    }
  }
}

/** 展开只读详情（`trial_get` 取全文；失败如实呈现错误行）。 */
async function openRecordDetail(
  detailHolder: HTMLElement,
  trialId: string,
  chainId: string,
  versionId: string,
  call: InvokeFn | undefined,
): Promise<void> {
  const loading = document.createElement("p");
  loading.className = "making-trial-record-note";
  loading.textContent = "读取试问详情…";
  detailHolder.replaceChildren(loading);
  let record: TrialRecord;
  try {
    record = await trialGet(trialId, call);
  } catch (error) {
    if (!detailHolder.isConnected) return;
    detailHolder.replaceChildren(recordErrorLine(`读取试问详情失败：${errorMessage(error)}`));
    return;
  }
  if (!detailHolder.isConnected) return;
  const detail = document.createElement("div");
  detail.className = "making-trial-record-detail";

  const meta = document.createElement("p");
  meta.className = "making-trial-record-meta";
  const focusLabel = record.focus_document_title !== null && record.focus_document_title.length > 0
    ? record.focus_document_title
    : "（不指定）";
  meta.textContent =
    `${trialRunKindLabel(record.with_card)} · ${record.chain_name}·第${record.version_index}版 · ` +
    `作品：${record.work_title} · 关注文档：${focusLabel} · ${trialTimeLabel(record.created_at)}`;

  const questionLabel = detailLabel("问题全文");
  const questionText = document.createElement("pre");
  questionText.className = "making-trial-record-text";
  questionText.textContent = record.question;

  const replyLabel = detailLabel("回复全文");
  const replyText = document.createElement("pre");
  replyText.className = "making-trial-record-text";
  replyText.textContent = trialReplyTextOf(record);

  const readonlyNote = document.createElement("p");
  readonlyNote.className = "making-trial-record-note";
  readonlyNote.textContent = TRIAL_RECORD_READONLY_NOTE;

  detail.append(meta, questionLabel, questionText, replyLabel, replyText, readonlyNote, buildFeedbackBlock(record, chainId, versionId, call, detailHolder));
  detailHolder.replaceChildren(detail);
}

function detailLabel(text: string): HTMLElement {
  const label = document.createElement("p");
  label.className = "making-trial-record-label";
  label.textContent = text;
  return label;
}

/** 反馈区：当前反馈只读显示＋「记录反馈」表单（空白提交＝清除；试问记录唯一输入）。 */
function buildFeedbackBlock(
  record: TrialRecord,
  chainId: string,
  versionId: string,
  call: InvokeFn | undefined,
  detailHolder: HTMLElement,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "making-trial-feedback";
  const current = document.createElement("p");
  current.className = "making-trial-record-meta";
  current.textContent = `反馈：${trialFeedbackSummary(record.feedback, 40)}`;

  const form = document.createElement("form");
  form.className = "making-trial-feedback-form";
  const input = document.createElement("textarea");
  input.className = "making-trial-feedback-input";
  input.rows = 2;
  input.value = record.feedback ?? "";
  input.setAttribute("aria-label", `记录对这次试问的反馈（${record.id}）`);
  const actions = document.createElement("div");
  actions.className = "making-trial-feedback-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "making-mini-btn";
  submit.textContent = "保存反馈";
  const hint = document.createElement("span");
  hint.className = "making-trial-record-note";
  hint.textContent = "留空保存＝清除反馈";
  actions.append(submit, hint);
  const errorLine = document.createElement("p");
  errorLine.className = "making-trial-record-error hidden";
  form.append(input, actions, errorLine);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      submit.disabled = true;
      errorLine.classList.add("hidden");
      try {
        await trialSetFeedback(record.id, input.value, call);
        // 保存成功：就地重读列表（保持该条展开），行摘要与反馈显示同步刷新。
        void loadRecords(detailHolder.parentElement ?? detailHolder, chainId, versionId, call, record.id);
      } catch (error) {
        submit.disabled = false;
        errorLine.classList.remove("hidden");
        errorLine.textContent = `反馈保存失败：${errorMessage(error)}`;
      }
    })();
  });

  block.append(current, form);
  return block;
}
