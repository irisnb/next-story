//! 轮内补读监管状态（fix-story-tool-channel-failures-and-split D3 自
//! story_tool_channel 拆分，纯移动；原 change add-agent-on-demand-reading
//! 任务组 6，状态在此、执行器保持无状态）：
//! - 版本固定表（D4，首次成功读取固定该轮版本，失配 `story_version_changed`
//!   本轮停读）、同轮同版去重（D9，重复返回「已提供过」附出处，跨轮不屏蔽）、
//!   按轮累计的阅读程度判定（D12，写入讨论档案出处）、宿主侧保险丝（D5，
//!   按轮调用计数 + 累计时长超阈值后该轮后续补读一律 `reading_stopped`）。
//!   轮身份 =（讨论, register_round 序号）：同一讨论同一轮请求周期内共享状态，
//!   新一轮 / 重启后旧轮状态作废（固定语义只活在一轮之内，不持久化）。
//!
//! 本模块只做纯内存状态与判定，不做 IO；何时调用这些判定、结果如何回填驱动
//! 由 `crate::story_tool_channel`（门面）编排。

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use crate::conversation_store::ReadingDepth;
use crate::project::{MaterialRange, SearchResult, SearchStatus};
use crate::story_tools::{ProvidedHint, StoryToolDenialReason};

/// 按轮补读保险丝配置（设计 D5，任务 6.4）。单一配置源：默认值在此，测试与
/// 真实链路校准（任务 9.5）只改这里 / 注入新值——不是散落的魔法数字。
/// 数值为内部初始值，需真实效果验证，非产品效果承诺，也不向用户呈现配额。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReadingFuseConfig {
    /// 每轮补读工具调用（story-list / story-read / story-search 到达）次数上限。
    pub max_tool_calls: u64,
    /// 每轮补读工具累计执行时长上限（只计工具执行，不含授权等待——等待以分钟
    /// 计且由用户驱动，不是异常循环信号）。
    pub max_accumulated_duration: Duration,
}

impl Default for ReadingFuseConfig {
    fn default() -> Self {
        Self {
            // 内部初始值：正常一轮（目录 + 若干读取 / 检索）远低于此；异常循环
            // （DSH 框架无总步数上限，设计 D5 风险）会被截停。校准归任务 9.5。
            max_tool_calls: 24,
            max_accumulated_duration: Duration::from_secs(120),
        }
    }
}

// ========== 轮内监管状态（任务组 6：固定表 / 去重 / 覆盖累计 / 熔断） ==========

/// 一篇文档在该轮的覆盖累计（设计 D12）：按版本记录已读字节区间与全文长度，
/// 版本变化即重置（旧区间的字节不再对应新正文）。
#[derive(Debug, Default, Clone)]
struct DocCoverage {
    version: Option<String>,
    total_len: Option<usize>,
    /// 已合并排序的覆盖区间（字节，左闭右开）。
    intervals: Vec<(usize, usize)>,
}

impl DocCoverage {
    /// 记录一次读取覆盖；版本变化重置累计。
    fn record(&mut self, version: &str, range: MaterialRange, total_len: Option<usize>) {
        if self.version.as_deref() != Some(version) {
            self.version = Some(version.to_string());
            self.intervals.clear();
            self.total_len = total_len;
        } else if self.total_len.is_none() {
            self.total_len = total_len;
        }
        self.intervals.push((range.start, range.end));
        self.intervals.sort_unstable();
        let mut merged: Vec<(usize, usize)> = Vec::with_capacity(self.intervals.len());
        for (start, end) in self.intervals.drain(..) {
            match merged.last_mut() {
                Some(last) if start <= last.1 => last.1 = last.1.max(end),
                _ => merged.push((start, end)),
            }
        }
        self.intervals = merged;
    }

    fn covered_len(&self) -> usize {
        self.intervals
            .iter()
            .map(|(s, e)| e.saturating_sub(*s))
            .sum()
    }

    /// 是否覆盖全文：需要已知全文长度且区间全覆盖（长度未知时不冒充完整）。
    fn is_full(&self) -> bool {
        match self.total_len {
            Some(total) => total > 0 && self.covered_len() >= total,
            None => false,
        }
    }
}

/// 读取前的轮内决策（固定表 / 去重 / 停读）。
#[derive(Debug)]
pub(crate) enum ReadPreparation {
    /// 结构化拒绝（版本失配等）。
    Denied(StoryToolDenialReason),
    /// 同轮同版同范围已提供过：返回简短提示（设计 D9）。
    AlreadyProvided(ProvidedHint),
    /// 放行执行；`version` 为经固定表改写后的期望版本（已固定文档强制携带）。
    Execute { version: Option<String> },
}

/// 已提供键（设计 D9）：（文档 id, 版本, 请求范围）。
type ProvidedKey = (String, String, Option<(usize, usize)>);

/// 一轮的补读监管状态：register_round 时整体重置（跨轮不共享；旧轮状态作废）。
#[derive(Debug, Default, Clone)]
pub(crate) struct RoundReadingState {
    /// 版本固定表（设计 D4）：文档 → 该轮固定版本（首次成功读取固定）。
    pinned: HashMap<String, String>,
    /// 本轮停读的文档（版本失配后；下一轮自然恢复）。
    blocked: HashSet<String>,
    /// 已提供（文档, 版本, 请求范围）→ 首次提供的有效范围（设计 D9）。
    provided: HashMap<ProvidedKey, MaterialRange>,
    /// 文档名（去重提示的出处用）。
    names: HashMap<String, String>,
    /// 按轮累计的读取覆盖（设计 D12）。
    coverage: HashMap<String, DocCoverage>,
    /// 仅检索命中的文档（无读取覆盖时阅读程度为搜索片段，设计 D12）。
    search_only: HashMap<String, String>,
    /// 本轮补读工具调用到达计数（保险丝，设计 D5）。
    pub(crate) reading_calls: u64,
    /// 本轮补读工具累计执行时长（不含授权等待）。
    accumulated: Duration,
    /// 保险丝是否已触发（触发后该轮后续补读一律拒绝）。
    pub(crate) fused: bool,
    /// 本轮出处是否有更新（决定是否写档案）。
    pub(crate) provenance_dirty: bool,
}

impl RoundReadingState {
    /// story-read 的轮内前置决策：停读 / 固定表改写与失配拒绝 / 同轮去重。
    pub(crate) fn prepare_read(
        &mut self,
        turn_index: u32,
        document_id: &str,
        version: Option<String>,
        range: Option<MaterialRange>,
    ) -> ReadPreparation {
        // 本轮已停读：任何后续读取一律版本失配拒绝（下一轮读最新版）。
        if self.blocked.contains(document_id) {
            return ReadPreparation::Denied(StoryToolDenialReason::StoryVersionChanged);
        }
        // 版本固定表（D4）：未固定时透传请求版本；已固定时强制该轮版本，
        // 请求他版即失配（本轮停读该文档）。
        let effective_version = match self.pinned.get(document_id) {
            Some(pinned) => {
                if version.as_deref().is_some_and(|v| v != pinned) {
                    self.blocked.insert(document_id.to_string());
                    return ReadPreparation::Denied(StoryToolDenialReason::StoryVersionChanged);
                }
                Some(pinned.clone())
            }
            None => version,
        };
        // 同轮同版去重（D9）：请求范围按 None / 字节区间归一比较；跨轮不屏蔽
        // （状态随轮重置）。整篇（None）与显式区间视为不同请求。
        let key = (
            document_id.to_string(),
            effective_version.clone().unwrap_or_default(),
            range.map(|r| (r.start, r.end)),
        );
        if let Some(&effective_range) = self.provided.get(&key) {
            return ReadPreparation::AlreadyProvided(ProvidedHint {
                document_id: document_id.to_string(),
                document_name: self.names.get(document_id).cloned().unwrap_or_default(),
                version: effective_version.unwrap_or_default(),
                range: effective_range,
                turn_index,
            });
        }
        ReadPreparation::Execute {
            version: effective_version,
        }
    }

    /// story-read 成功后记账：固定版本、记已提供、累计覆盖（D12）。
    pub(crate) fn record_read_success(
        &mut self,
        document_id: &str,
        document_name: &str,
        version: String,
        requested_range: Option<MaterialRange>,
        material_range: MaterialRange,
        total_len: Option<usize>,
    ) {
        self.pinned
            .entry(document_id.to_string())
            .or_insert_with(|| version.clone());
        self.names
            .insert(document_id.to_string(), document_name.to_string());
        let key = (
            document_id.to_string(),
            version.clone(),
            requested_range.map(|r| (r.start, r.end)),
        );
        self.provided.entry(key).or_insert(material_range);
        self.search_only.remove(document_id);
        self.coverage
            .entry(document_id.to_string())
            .or_default()
            .record(&version, material_range, total_len);
        self.provenance_dirty = true;
    }

    /// story-read 被执行器以 `version_unavailable` 拒绝后的映射（D4「读到一半出新
    /// 版本」）：该文档本轮已固定版本时，映射为 `story_version_changed` 并停读。
    /// 返回是否映射。
    pub(crate) fn note_read_version_unavailable(&mut self, document_id: &str) -> bool {
        if self.pinned.contains_key(document_id) {
            self.blocked.insert(document_id.to_string());
            true
        } else {
            false
        }
    }

    /// story-search 结果的轮内后处理：本轮停读或版本已漂移的文档过滤其命中
    /// （避免一次回答拼接两个版本），并把保留的命中记为「仅检索命中」。
    pub(crate) fn filter_search(&mut self, result: &mut SearchResult) {
        result.snippets.retain(|snippet| {
            if self.blocked.contains(&snippet.document_id) {
                return false;
            }
            if let Some(pinned) = self.pinned.get(&snippet.document_id) {
                if pinned != &snippet.version {
                    // 检索发现该文档已保存为新版：本轮停读（D4）。
                    self.blocked.insert(snippet.document_id.clone());
                    return false;
                }
            }
            self.search_only
                .entry(snippet.document_id.clone())
                .or_insert_with(|| snippet.version.clone());
            true
        });
        if result.snippets.is_empty() {
            result.status = SearchStatus::NotFound;
        }
        self.provenance_dirty = true;
    }

    /// 本轮出处的累计视图（D12）：读取覆盖三档判定 + 仅检索命中文档为搜索片段。
    pub(crate) fn cumulative_updates(&self) -> Vec<(String, String, ReadingDepth)> {
        let mut updates = Vec::new();
        for (document_id, coverage) in &self.coverage {
            if let Some(version) = &coverage.version {
                let depth = if coverage.is_full() {
                    ReadingDepth::Full
                } else {
                    ReadingDepth::Partial
                };
                updates.push((document_id.clone(), version.clone(), depth));
            }
        }
        for (document_id, version) in &self.search_only {
            if !self.coverage.contains_key(document_id) {
                updates.push((
                    document_id.clone(),
                    version.clone(),
                    ReadingDepth::SearchSnippet,
                ));
            }
        }
        updates
    }

    /// 一次补读工具调用收尾（保险丝记账，D5）：累计执行时长并在越过阈值后
    /// 触发熔断（对该轮**后续**补读调用生效；本调用结果照常返回）。
    pub(crate) fn note_reading_arrival_completed(
        &mut self,
        elapsed: Duration,
        config: &ReadingFuseConfig,
    ) {
        self.accumulated += elapsed;
        if self.reading_calls >= config.max_tool_calls
            || self.accumulated >= config.max_accumulated_duration
        {
            self.fused = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 6.1 单元：版本固定表——首读固定、他版失配（本轮停读）、停读后任意读取拒绝。
    #[test]
    fn round_state_pins_version_and_blocks_on_mismatch() {
        let mut state = RoundReadingState::default();
        // 首读未固定：透传请求版本。
        match state.prepare_read(0, "d", None, None) {
            ReadPreparation::Execute { version } => assert_eq!(version, None),
            other => panic!("首读应放行，实际 {other:?}"),
        }
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            None,
            MaterialRange { start: 0, end: 10 },
            Some(10),
        );
        assert_eq!(state.pinned.get("d").map(String::as_str), Some("v1"));
        // 同轮请求他版：story_version_changed + 本轮停读。
        match state.prepare_read(0, "d", Some("v0".into()), None) {
            ReadPreparation::Denied(reason) => {
                assert_eq!(reason, StoryToolDenialReason::StoryVersionChanged)
            }
            other => panic!("他版应失配拒绝，实际 {other:?}"),
        }
        // 停读后：固定版 / 无版本一律失配拒绝（下一轮读新版由状态重置保证）。
        for version in [Some("v1".to_string()), None] {
            match state.prepare_read(0, "d", version, None) {
                ReadPreparation::Denied(reason) => {
                    assert_eq!(reason, StoryToolDenialReason::StoryVersionChanged)
                }
                other => panic!("停读文档应拒绝，实际 {other:?}"),
            }
        }
    }

    /// 6.1 单元：已固定文档读取期间正文保存为新版（执行器 version_unavailable）
    /// → 映射 story_version_changed 并停读；未固定文档保持 version_unavailable。
    #[test]
    fn round_state_maps_version_unavailable_only_when_pinned() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            None,
            MaterialRange { start: 0, end: 10 },
            Some(10),
        );
        assert!(state.note_read_version_unavailable("d"), "已固定文档应映射");
        assert!(state.blocked.contains("d"));

        let mut fresh = RoundReadingState::default();
        assert!(
            !fresh.note_read_version_unavailable("d"),
            "未固定文档保持 version_unavailable（可重试正确版本）"
        );
    }

    /// 6.3 单元：同轮同版同范围去重；不同范围 / 跨轮不屏蔽。
    #[test]
    fn round_state_dedups_same_version_and_range_only() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "d",
            "文档",
            "v1".to_string(),
            Some(MaterialRange { start: 0, end: 5 }),
            MaterialRange { start: 0, end: 5 },
            Some(10),
        );
        match state.prepare_read(
            0,
            "d",
            Some("v1".into()),
            Some(MaterialRange { start: 0, end: 5 }),
        ) {
            ReadPreparation::AlreadyProvided(hint) => {
                assert_eq!(hint.document_id, "d");
                assert_eq!(hint.document_name, "文档");
                assert_eq!(hint.version, "v1");
                assert_eq!(hint.range, MaterialRange { start: 0, end: 5 });
                assert_eq!(hint.turn_index, 0);
            }
            other => panic!("同版同范围应命中去重，实际 {other:?}"),
        }
        // 不同范围、不同版本形态（None ↔ Some）不命中。
        assert!(matches!(
            state.prepare_read(
                0,
                "d",
                Some("v1".into()),
                Some(MaterialRange { start: 5, end: 10 })
            ),
            ReadPreparation::Execute { .. }
        ));
        assert!(matches!(
            state.prepare_read(0, "d", Some("v1".into()), None),
            ReadPreparation::Execute { .. }
        ));
        // 跨轮：状态整体重置，同请求不屏蔽（D9）。
        let mut fresh = RoundReadingState::default();
        assert!(matches!(
            fresh.prepare_read(
                0,
                "d",
                Some("v1".into()),
                Some(MaterialRange { start: 0, end: 5 })
            ),
            ReadPreparation::Execute { .. }
        ));
    }

    /// 6.2 单元：按轮累计的阅读程度——半篇 + 另半篇 = 完整；仅检索命中 = 搜索片段；
    /// 读取升级覆盖仅检索文档的程度；版本变化重置累计。
    #[test]
    fn round_state_judges_depth_by_cumulative_coverage() {
        let mut state = RoundReadingState::default();
        state.record_read_success(
            "a",
            "甲",
            "v1".to_string(),
            Some(MaterialRange { start: 0, end: 50 }),
            MaterialRange { start: 0, end: 50 },
            Some(100),
        );
        // 另一半：区间合并且重叠合并正确 → 覆盖全文。
        state.record_read_success(
            "a",
            "甲",
            "v1".to_string(),
            Some(MaterialRange {
                start: 50,
                end: 100,
            }),
            MaterialRange {
                start: 50,
                end: 100,
            },
            Some(100),
        );
        // 仅检索命中（无读取覆盖）。
        state.search_only.insert("b".to_string(), "vb".to_string());
        let updates = state.cumulative_updates();
        let depth_of = |doc: &str| {
            updates
                .iter()
                .find(|(d, _, _)| d == doc)
                .map(|(_, _, depth)| *depth)
                .expect("应有该文档的累计条目")
        };
        assert_eq!(depth_of("a"), ReadingDepth::Full, "两半覆盖 = 完整阅读");
        assert_eq!(depth_of("b"), ReadingDepth::SearchSnippet);

        // 读取升级：b 从仅检索升级为局部 / 完整。
        state.record_read_success(
            "b",
            "乙",
            "vb".to_string(),
            None,
            MaterialRange { start: 0, end: 40 },
            None,
        );
        let updates = state.cumulative_updates();
        let depth_b = updates
            .iter()
            .find(|(d, _, _)| d == "b")
            .map(|(_, _, depth)| *depth)
            .expect("b 应保留累计条目");
        assert_eq!(depth_b, ReadingDepth::Partial, "长度未知不冒充完整");

        // 版本变化重置累计：旧区间不映射到新正文。
        state.record_read_success(
            "a",
            "甲",
            "v2".to_string(),
            Some(MaterialRange { start: 0, end: 10 }),
            MaterialRange { start: 0, end: 10 },
            Some(100),
        );
        let updates = state.cumulative_updates();
        let depth_a = updates
            .iter()
            .find(|(d, _, _)| d == "a")
            .map(|(_, _, depth)| *depth)
            .expect("a 应保留累计条目");
        assert_eq!(depth_a, ReadingDepth::Partial, "版本变化后重新累计");
    }

    /// 6.4 单元：保险丝——到达计数越过阈值或累计时长超限后触发，触发后只影响
    /// 该轮后续补读；控制工具不受影响（由通道的 is_reading_tool 分流保证）。
    #[test]
    fn round_state_fuse_trips_on_count_or_duration() {
        let config = ReadingFuseConfig {
            max_tool_calls: 2,
            max_accumulated_duration: Duration::from_millis(100),
        };
        let mut state = RoundReadingState {
            reading_calls: 1,
            ..RoundReadingState::default()
        };
        state.note_reading_arrival_completed(Duration::ZERO, &config);
        assert!(!state.fused, "未到阈值不触发");
        state.reading_calls = 2;
        state.note_reading_arrival_completed(Duration::ZERO, &config);
        assert!(state.fused, "计数达到上限即触发（后续补读停止）");

        // 时长维度独立触发。
        let mut slow = RoundReadingState {
            reading_calls: 1,
            ..RoundReadingState::default()
        };
        slow.note_reading_arrival_completed(Duration::from_millis(150), &config);
        assert!(slow.fused, "累计时长超限即触发");
    }
}
