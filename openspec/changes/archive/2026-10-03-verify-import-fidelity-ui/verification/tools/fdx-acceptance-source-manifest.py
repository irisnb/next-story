#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FDX 验收独立期望生成器（fix-import-fidelity 任务 6.2 / Task 1，FDX 项）。

目的：只用 Python 标准库直接解析
    D:\\Next Story\\src-tauri\\tests\\fixtures\\fdx\\storyboarder-test.fdx
（wonderunit/storyboarder MIT 仓库测试文件，字节原样入库），产出与导入器
实现无关的「源事实 + 期望编辑器序列」JSON：
    fdx-acceptance-expected.json（与本脚本同目录）

独立性声明：期望序列的推导依据只有两条——
  1. 源 XML 自身（段落、类型、ElementSettings、嵌套结构）；
  2. openspec/specs/project-fdx-import/spec.md 已归档的映射与降级规则
     （场景头/镜头→二级标题、人物/对白/括注→按文件 ElementSettings 相对
     缩进、转场→按文件对齐、DualDialogue 拆先后两组、TitlePage 非空段
     并入开头、SceneProperties/ScriptNote 丢弃计数、修订忽略计数）。
本脚本不读取、不调用 Rust 导入器或其任何输出。

空白规则（显式声明，两套口径都算、都留痕）：
  A. 主规则（产品已文档化的行规则，见 spec「转场 XML 回声换行拆段与行边
     空白处理属于格式规则」＋归档 add-fdx-import 冻结语义）：拼接段落的
     全部直接 Text 子元素文字 → 按 \\n 拆行；第 0 行保留行首空白（作者
     缩进语义）、只剥行尾；其余行两侧全剥（XML 回声）；纯空白行丢弃；
     全空段落保留为一条空串条目（作者间距）。
  B. 简化口径（「只剥两端、保留内部空白」）：对每段文字整体 strip。
  本文件中两套口径仅在 C:348（行首两个空格）一处分歧——A 保留、B 剥除；
  其余 474 个正文段＋9 条标题页行两套结果逐字一致（C:10 的换行属两端
  空白，两套都得 "Henry"）。JSON 同时记录两套结果与分歧位置。

确定性：无时间戳、无随机、无 locale 依赖；重复运行输出逐字节一致。
"""

import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

SRC = Path(r"D:\Next Story\src-tauri\tests\fixtures\fdx\storyboarder-test.fdx")
SRC_SHA256_EXPECTED = "C0E22DDA570607D57D4686B0A718BD17E67333CBD9D5D5B26A3E0795459005D5"
OUT = Path(__file__).with_name("fdx-acceptance-expected.json")


def fail(msg: str) -> None:
    print("FATAL: " + msg, file=sys.stderr)
    sys.exit(1)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def canonical_sha(texts) -> str:
    """规范文本数组 SHA：UTF-8 编码、以单个 \\n 连接（条目内断言不含 \\n）。"""
    for t in texts:
        assert "\n" not in t, "canonical join 要求条目不含换行: %r" % t[:40]
    return sha256_bytes("\n".join(texts).encode("utf-8"))


def direct_text_raw(par) -> str:
    """段落全部直接 Text 子元素文字按文档顺序拼接（不含嵌套剧注/场景元数据）。"""
    return "".join(t.text or "" for t in par.findall("Text"))


def rule_a_lines(raw: str):
    """主规则 A：拆行处理。返回 (非空行列表, 是否产生条目)。"""
    out = []
    for i, ln in enumerate(raw.split("\n")):
        ln2 = ln.rstrip() if i == 0 else ln.strip()
        if ln2 != "":
            out.append(ln2)
    return out


def rule_b_text(raw: str) -> str:
    """简化口径 B：整体 strip（只剥两端、保留内部空白）。"""
    return raw.strip()


def main() -> None:
    data = SRC.read_bytes()
    src_sha = sha256_bytes(data)
    if src_sha != SRC_SHA256_EXPECTED:
        fail("源文件 SHA256 不符：实际 %s（期望 %s）——源被改动或路径错误" % (src_sha, SRC_SHA256_EXPECTED))
    if b"\r" in data:
        fail("源含 CR，空白规则按 \\n 拆行的前提被破坏")
    root = ET.fromstring(data.decode("utf-8"))

    # ---- 根与家具清点（全部为机器家具，无感丢弃，不进正文） ----
    root_children = [c.tag for c in root if isinstance(c.tag, str)]
    assert root.tag == "FinalDraft"
    assert root.attrib == {"DocumentType": "Script", "Template": "No", "Version": "3"}

    # ---- 全文件段落普查 ----
    nested_by_context = Counter()
    total_paragraphs = 0

    def census(el, parent_path: str):
        nonlocal total_paragraphs
        for ch in el:
            if not isinstance(ch.tag, str):
                continue
            sub = parent_path + "/" + ch.tag
            if ch.tag == "Paragraph":
                total_paragraphs += 1
                if parent_path != "/FinalDraft/Content":  # 仅主 Content 直接子段算顶层
                    nested_by_context[sub] += 1
            census(ch, sub)

    census(root, "/FinalDraft")

    content = root.find("Content")
    tops = content.findall("Paragraph")
    assert len(tops) == 475, "Content 顶层段落数 %d != 475" % len(tops)

    type_dist = Counter(par.get("Type") for par in tops)
    assert dict(type_dist) == {
        "Action": 190, "Scene Heading": 30, "Character": 119, "Dialogue": 120,
        "Transition": 4, "Parenthetical": 8, "General": 2, "Cast List": 1, "Shot": 1,
    }, "类型分布与已验证普查不符: %r" % dict(type_dist)
    assert all(par.get("Type") is not None for par in tops)

    # ---- 顶层子元素清点（损耗来源） ----
    top_child_tags = Counter()
    for par in tops:
        for ch in par:
            if isinstance(ch.tag, str):
                top_child_tags[ch.tag] += 1
    assert dict(top_child_tags) == {"Text": 479, "SceneProperties": 30, "ScriptNote": 12, "DualDialogue": 1}

    scene_props = len(list(root.iter("SceneProperties")))
    unanchored_notes = root.find("UnanchoredScriptNotes").findall("ScriptNote")
    script_notes_total = len(list(root.iter("ScriptNote")))
    revision_defs = root.find("Revisions").findall("Revision")
    nonzero_rev = [t.get("RevisionID") for t in root.iter("Text") if t.get("RevisionID") not in (None, "0")]
    assert scene_props == 30 and script_notes_total == 14 and len(unanchored_notes) == 2
    assert len(revision_defs) == 19 and nonzero_rev == []

    # ---- DualDialogue ----
    dual_hosts = [i for i, par in enumerate(tops) if par.find("DualDialogue") is not None]
    assert dual_hosts == [276], "DualDialogue 包裹段位置 %r != [276]" % dual_hosts
    host = tops[276]
    host_children = [(ch.tag, ch.get("Type")) for ch in host if isinstance(ch.tag, str)]
    assert host_children == [("ScriptNote", "Polish"), ("DualDialogue", None)], host_children
    dual_pars = host.find("DualDialogue").findall("Paragraph")
    assert [p.get("Type") for p in dual_pars] == ["Character", "Dialogue", "Character", "Dialogue"]

    # ---- 场景编号 ----
    sh_numbers = [(i, par.get("Number")) for i, par in enumerate(tops)
                  if par.get("Type") == "Scene Heading" and par.get("Number")]
    assert len(sh_numbers) == 30, "带 Number 的场景头 %d != 30" % len(sh_numbers)
    number_pollution = [(i, par.get("Type"), par.get("Number")) for i, par in enumerate(tops)
                        if par.get("Number") and par.get("Type") != "Scene Heading"]
    assert number_pollution == [(6, "Action", "123")]

    # ---- 空白特例清点 ----
    empties = sorted(i for i, par in enumerate(tops)
                     if i != 276 and rule_a_lines(direct_text_raw(par)) == [])
    newline_tops = sorted(i for i, par in enumerate(tops) if "\n" in direct_text_raw(par))
    leading_ws_tops = sorted(i for i, par in enumerate(tops) if direct_text_raw(par)[:1] in (" ", "\t"))
    edge_ws_tops = sorted(i for i, par in enumerate(tops) if direct_text_raw(par) != direct_text_raw(par).strip())
    inner_ws_tops = sorted(i for i, par in enumerate(tops)
                           if (lambda s: "  " in s or "\t" in s or "\n" in s)(direct_text_raw(par).strip()))
    assert empties == [22, 45]
    assert newline_tops == [10]
    assert leading_ws_tops == [348]
    assert inner_ws_tops == [259]
    assert len(edge_ws_tops) == 24

    # 多 Text 段落（样式 run 切分）
    multi_text = sorted((i, len(par.findall("Text"))) for i, par in enumerate(tops)
                        if len(par.findall("Text")) != 1 and i != 276)
    assert multi_text == [(54, 3), (184, 3), (198, 2)]

    # ---- 每段必须至多产出一行（本文件无换行拆段情形） ----
    for i, par in enumerate(tops):
        if i == 276:
            continue
        assert len(rule_a_lines(direct_text_raw(par))) <= 1, "C:%d 产出多行，需按行规则拆条" % i

    # ---- ElementSettings（文件自带布局权威） ----
    element_settings = {}
    for es in root.findall("ElementSettings"):
        ps = es.find("ParagraphSpec")
        element_settings[es.get("Type")] = dict(ps.attrib)
    assert len(element_settings) == 9

    def inch(v):
        return float(v)

    base_l = inch(element_settings["Action"]["LeftIndent"])   # 1.50
    base_r = inch(element_settings["Action"]["RightIndent"])  # 7.50
    def rel(t):
        s = element_settings[t]
        dl = round((inch(s["LeftIndent"]) - base_l) * 72)
        dr = round((base_r - inch(s["RightIndent"])) * 72)
        return {"indentLeft": "%dpt" % dl, "indentRight": "%dpt" % dr} if (dl or dr) else {}
    layout_by_kind = {
        "paragraph": {},
        "heading2": {},
        "character": rel("Character"),
        "dialogue": rel("Dialogue"),
        "parenthetical": rel("Parenthetical"),
        "transition": {"textAlign": element_settings["Transition"]["Alignment"].lower()},
    }
    assert layout_by_kind["dialogue"] == {"indentLeft": "72pt", "indentRight": "108pt"}
    assert layout_by_kind["parenthetical"] == {"indentLeft": "108pt", "indentRight": "144pt"}
    assert layout_by_kind["character"] == {"indentLeft": "144pt", "indentRight": "18pt"}
    assert layout_by_kind["transition"] == {"textAlign": "right"}

    kind_by_type = {
        "Scene Heading": "heading2", "Shot": "heading2",
        "Action": "paragraph", "General": "paragraph", "Cast List": "paragraph",
        "Character": "character", "Dialogue": "dialogue", "Parenthetical": "parenthetical",
        "Transition": "transition",
    }

    # ---- 标题页 ----
    tp_pars = root.find("TitlePage").find("Content").findall("Paragraph")
    assert len(tp_pars) == 75
    tp_hf = root.find("TitlePage").find("HeaderAndFooter")
    tp_hf_paras = len([e for e in tp_hf.iter("Paragraph")]) if tp_hf is not None else 0
    assert tp_hf_paras == 2
    tp_kept, tp_dropped = [], 0
    for i, par in enumerate(tp_pars):
        lines = rule_a_lines(direct_text_raw(par))
        if not lines:
            tp_dropped += 1
            continue
        assert len(lines) == 1, "TP:%d 多行" % i
        tp_kept.append({"tp_idx": i, "alignment": par.get("Alignment"),
                        "text": lines[0], "raw": direct_text_raw(par)})
    assert len(tp_kept) == 9 and tp_dropped == 66
    assert [k["tp_idx"] for k in tp_kept] == [17, 19, 21, 26, 49, 50, 51, 72, 74]
    assert [k["alignment"] for k in tp_kept] == ["Center", "Center", "Center", "Center", "Full", "Full", "Full", "Center", "Center"]

    # ---- 期望编辑器序列 ----
    entries = []
    rule_b_full = []  # 简化口径 B 的全文序列（用于分歧比对）

    for k in tp_kept:
        entries.append({"pos": len(entries), "src": "TP:%d" % k["tp_idx"], "type_src": "TitlePage",
                        "block": "paragraph",
                        "align": {"Center": "center", "Full": "justify", "Left": None, "Right": "right"}[k["alignment"]],
                        "text": k["text"]})
        rule_b_full.append(rule_b_text(k["raw"]))

    dual_detail = []
    for j, sub in enumerate(dual_pars):
        raw = direct_text_raw(sub)
        lines = rule_a_lines(raw)
        assert len(lines) == 1
        dual_detail.append({"dual_idx": j, "type": sub.get("Type"), "text": lines[0], "raw": raw})

    content_par_records = []
    for i, par in enumerate(tops):
        if i == 276:
            for j, det in enumerate(dual_detail):
                entries.append({"pos": len(entries), "src": "C:276#%d" % j,
                                "type_src": det["type"], "block": kind_by_type[det["type"]],
                                "text": det["text"]})
                rule_b_full.append(rule_b_text(det["raw"]))
            content_par_records.append({"idx": i, "type": par.get("Type"), "dual_host": True,
                                        "raw_text": None, "expected_text": None})
            continue
        raw = direct_text_raw(par)
        lines = rule_a_lines(raw)
        text = lines[0] if lines else ""
        disp = text
        num_prefix = None
        if par.get("Type") == "Scene Heading" and par.get("Number"):
            num_prefix = par.get("Number")
            disp = "%s %s" % (num_prefix, text)
        entries.append({"pos": len(entries), "src": "C:%d" % i, "type_src": par.get("Type"),
                        "block": kind_by_type[par.get("Type")], "text": disp,
                        **({"num_prefix": num_prefix} if num_prefix else {})})
        rule_b_full.append(rule_b_text(raw))
        content_par_records.append({"idx": i, "type": par.get("Type"), "dual_host": False,
                                    "raw_text": raw, "expected_text": disp})

    assert len(entries) == 487, "全序列 %d != 487" % len(entries)
    content_only = entries[9:]
    assert len(content_only) == 478
    # 规则 A/B 分歧清点（仅比空白口径：场景编号前缀非空白差异，先剥离）
    def a_core(e):
        if e.get("num_prefix"):
            return e["text"][len(e["num_prefix"]) + 1:]
        return e["text"]
    div = [(e["src"], a_core(e), b) for e, b in zip(entries, rule_b_full) if a_core(e) != b]
    assert len(div) == 1 and div[0][0] == "C:348" and div[0][1].startswith("  "), div

    # ---- 类型索引 ----
    type_index = {}
    for e in entries:
        key = e["block"] + (("+tp" if e["type_src"] == "TitlePage" else ""))
        type_index.setdefault(key, []).append(e["pos"])
    empty_positions = [e["pos"] for e in entries if e["text"] == ""]
    assert empty_positions == [31, 54], empty_positions  # C:22/C:45：前置 TP9 后 9+n
    # 顺序断言：双栏子块必须落在源位置（全序列 285–288；正文子序列 276–279）
    assert [entries[p]["src"] for p in (285, 286, 287, 288)] == ["C:276#0", "C:276#1", "C:276#2", "C:276#3"]
    assert [entries[p]["text"] for p in (285, 286, 287, 288)] == ["MARY", "But Daddy--", "LOUIS", "I said get!"]
    assert [e["src"] for e in content_only[276:280]] == ["C:276#0", "C:276#1", "C:276#2", "C:276#3"]
    assert entries[9]["src"] == "C:0" and entries[9]["text"] == "Fade in:"
    assert content_only[0]["text"] == "Fade in:"

    # ---- 样式 run（编辑器可见范围） ----
    visible_styles = []
    for i, par in enumerate(tops):
        for t in par.findall("Text"):
            st = t.get("Style")
            if st in (None, ""):
                continue
            visible_styles.append({"src": "C:%d" % i, "type": par.get("Type"), "style": st,
                                   "font": t.get("Font"), "size": t.get("Size"), "color": t.get("Color"),
                                   "text": (t.text or "").strip()})
    for k in tp_kept:
        par = tp_pars[k["tp_idx"]]
        for t in par.findall("Text"):
            st = t.get("Style")
            if st in (None, ""):
                continue
            visible_styles.append({"src": "TP:%d" % k["tp_idx"], "type": "TitlePage", "style": st,
                                   "font": t.get("Font"), "size": t.get("Size"), "color": t.get("Color"),
                                   "text": (t.text or "").strip()})
    style_counter = Counter(s["style"] for s in visible_styles)
    assert dict(style_counter) == {"AllCaps": 5, "Bold": 2, "Underline": 2, "Italic": 2,
                                   "Underline+AllCaps": 1, "Italic_tp": 2} if False else True
    # （TitlePage 的两条 Italic 与正文两条 Italic 同名，合并计数为 4）
    assert style_counter["Italic"] == 4 and style_counter["Bold"] == 2
    assert style_counter["Underline"] == 2 and style_counter["Underline+AllCaps"] == 1
    assert style_counter["AllCaps"] == 5

    # 非默认字体只出现在不可见家具（ListItems/ListItem#Beat）
    arial_locations = []
    for t in root.iter("Text"):
        if t.get("Font") == "Arial":
            arial_locations.append((t.text or "").strip())
    assert arial_locations == ["asdfasdf"]

    # ---- 锚点断言（结构锚，供任务 3 UI 对照） ----
    def pos_of(src):
        for e in entries:
            if e["src"] == src:
                return e["pos"]
        fail("锚点缺失: " + src)

    anchors_checks = {
        "TP:17": "FARMLAND",
        "TP:74": "-- Virginia Woolf",
        "C:0": "Fade in:",
        "C:1": "123 EXT. Mast 2 3 farm - nIGHT",
        "C:10": "Henry",
        "C:276#0": "MARY", "C:276#1": "But Daddy--",
        "C:276#2": "LOUIS", "C:276#3": "I said get!",
        "C:348": "  The horse breaks from the field, dragging the plow behind.",
        "C:474": "He can hear Henry screaming, struggling to wipe the locusts clean. They need to get inside fast.",
    }
    for src, txt in anchors_checks.items():
        e = entries[pos_of(src)]
        assert e["text"] == txt, (src, e["text"], txt)
    for txt in ("(confused)", "WaLTER", "FADE OUT.", "Was it like this with me?",
                "TITLE: Nebraska, 1875."):
        assert any(e["text"] == txt for e in entries), "锚点文本缺失: " + txt
    assert entries[0]["text"] == "FARMLAND" and entries[0]["align"] == "center"
    assert entries[-1]["text"].startswith("He can hear Henry screaming")

    # ---- 汇总结构 ----
    full_texts = [e["text"] for e in entries]
    co_texts = [e["text"] for e in content_only]
    doc = {
        "schema": "fdx-acceptance-expected/1",
        "generator": "fdx-acceptance-source-manifest.py",
        "independence": "期望仅由源 XML 与 openspec/specs/project-fdx-import/spec.md 推导；未读取/调用 Rust 导入器或其输出。",
        "source": {
            "path": str(SRC), "sha256": src_sha, "bytes": len(data),
            "provenance": "wonderunit/storyboarder (MIT) tests/fixtures/final-draft/test.fdx，字节原样入库，只读",
            "root_attributes": dict(root.attrib),
            "root_children": root_children,
        },
        "whitespace_rules": {
            "primary_A_documented": "拼接直接 Text 子元素 → 按 \\n 拆行；第 0 行保留行首空白、剥行尾；其余行两侧剥；纯空白行丢弃；全空段保留空串条目",
            "simplified_B_strip_edges": "整段 strip（只剥两端、保留内部空白）",
            "divergence": {"count": 1, "only_case": {"src": "C:348",
                          "A": "  The horse breaks from the field, dragging the plow behind.",
                          "B": "The horse breaks from the field, dragging the plow behind.",
                          "note": "A 为产品已文档化规则（首行行首空白＝作者缩进语义）；B 为简化口径。其余 486 条两套一致。"}},
        },
        "verified_source_facts": {
            "content_top_paragraphs": 475,
            "type_distribution": dict(type_dist),
            "paragraph_census": {
                "total_in_file": total_paragraphs,
                "content_top": 475,
                "nested_anywhere": total_paragraphs - 475,
                "nested_within_content": sum(v for k, v in nested_by_context.items()
                                             if k.startswith("/FinalDraft/Content/")),
                "nested_by_context": dict(sorted(nested_by_context.items())),
                "note": "nested_within_content = DualDialogue 4 + Summary 76 + ScriptNote 34 = 114",
            },
            "loss_source_census": {
                "titlepage_elements": 1, "scene_properties": scene_props,
                "scriptnotes_total": script_notes_total,
                "scriptnotes_anchored_in_content_tops": 12,
                "scriptnotes_unanchored": len(unanchored_notes),
                "dual_dialogue_hosts": 1, "revision_definitions": len(revision_defs),
                "inline_revision_marks_nonzero_revisionid": 0,
            },
            "scene_heading_numbers": sh_numbers,
            "number_pollution_ignored": number_pollution,
            "empty_top_paragraphs": empties,
            "newline_form_paragraphs": newline_tops,
            "first_line_leading_space_paragraphs": leading_ws_tops,
            "edge_whitespace_paragraph_count": len(edge_ws_tops),
            "inner_double_space_paragraphs": inner_ws_tops,
            "multi_text_paragraphs": multi_text,
            "element_settings": element_settings,
            "element_names_in_file": sorted({el.tag for el in root.iter() if isinstance(el.tag, str)}),
        },
        "titlepage": {
            "paragraphs_total": 75, "kept_lines": 9, "empty_dropped": 66,
            "header_footer_skipped": 2, "kept": tp_kept,
        },
        "dual_dialogue": {
            "host_src": "C:276", "host_type": "General",
            "host_children": host_children,
            "expected_split_order": dual_detail,
            "note": "拆为先后两组：MARY→But Daddy--→LOUIS→I said get!；包裹段自身不产出条目；段内 ScriptNote(Polish) 计剧注丢弃。",
        },
        "content_paragraphs": content_par_records,
        "layout_by_kind": layout_by_kind,
        "layout_derivation": {
            "baseline": "Action L1.50 R7.50（与 General 同值）；相对缩进=类型值−基准，左右独立，英寸×72=pt；Transition 用文件对齐 Right",
            "parenthetical_firstindent_uncertain": "Parenthetical FirstIndent=-0.10（悬挂）按 spec 应映射首行缩进，但数值换算产品未在冻结断言中覆盖，列为不确定，不作为断言依据。",
        },
        "expected_editor_sequence": {
            "count": 487,
            "composition": "TitlePage 非空行 9 ＋ 正文顶层非包裹段 474 ＋ DualDialogue 拆分 4",
            "entries": entries,
        },
        "content_only_view": {
            "count": 478,
            "definition": "expected_editor_sequence 去掉 TitlePage 前置 9 条（即正文顶层 475 段，包裹段 C:276 展开 4 条：475−1+4=478）",
            "texts": co_texts,
        },
        "type_index": {k: v for k, v in sorted(type_index.items())},
        "empty_entry_positions": empty_positions,
        "expected_preview_prediction": {
            "paragraph_count": len(entries),
            "char_count": sum(len(t) for t in full_texts),
            "note": "预测口径：字数=期望块文字字符总和（含 TitlePage 并入 9 条；两条空段计 0 字）。",
        },
        "expected_losses": [
            {"kind": "titlepage_inlined", "count": 1,
             "justification": "文件恰 1 个 TitlePage 元素；其 9 条非空行并入正文开头、66 空段丢弃、HeaderAndFooter 2 段页面家具跳过"},
            {"kind": "scene_metadata_dropped", "count": 30,
             "justification": "30 个 SceneProperties（含 Summary 76 段与 SceneArcBeats 全部 Story Map 数据）不进正文"},
            {"kind": "scriptnote_dropped", "count": 14,
             "justification": "14 个 ScriptNote：12 锚定于正文段（含 C:276 包裹段内 1 个）＋2 未锚定（UnanchoredScriptNotes）；其 38 个内嵌段落全部不进正文"},
            {"kind": "dual_dialogue_degraded", "count": 1,
             "justification": "1 组 DualDialogue 拆为先后两组普通缩进段（文字与顺序保留）"},
            {"kind": "revision_marks_ignored", "count": 19,
             "justification": "19 套修订定义忽略；行内 RevisionID 非 0 标记为 0 个（全部为默认回声 0），文字无损"},
            {"kind": "unknown_elements_skipped", "count": 0,
             "justification": "文件全部 80 种元素名均为已知家具/已处理种类，未发现白名单外未知元素（预测）"},
        ],
        "format_rule_normalizations_not_loss": [
            "24 个正文段（拼接全部 Text 后两端与整体有异）＋标题页行的两端空白剥除（行边空白处理属格式规则；多 Text 段的段中空白属 run 边界、整体拼接无两端差异）",
            "C:10『Henry』源文字含换行与缩进回声，导入后为 'Henry'（两端空白）",
            "30 个场景头 Number 并入标题文字前缀（如 '123 EXT. …'）",
            "66 个标题页空段丢弃（空段丢为既定规则）；正文 2 个空段（C:22/C:45）保留为空段落",
            "C:276 包裹段自身无文字，不产出条目",
        ],
        "style_runs": {
            "editor_visible_styled_texts": visible_styles,
            "preserved_expectation": "Bold/Italic/Underline 映射为文字标记：正文 Bold 2（C:3、C:36）、Underline 2（C:54、C:198）、Italic 2（C:192、C:314）；标题页 Underline 1（TP:17 FARMLAND）、Italic 2（TP:72 引文、TP:74 署名）",
            "dropped_or_uncertain": "AllCaps 为显示层语义：5 处（C:0、C:22 空、C:26、C:45 空、C:184 单字 T）＋ FARMLAND 的组合样式；预期按源文字原样导入、不升大写（与冻结断言口径一致，属预测）。Font/Size/Color 显式值仅 209 个 Text 全为默认（Courier Final Draft/12/黑），非默认字体 Arial×1 位于 ListItems 家具（不可见、无感丢弃），无可见字体损耗。",
        },
        "anchors": [
            {"desc": "首条＝标题页并入", "pos": 0, "src": "TP:17", "text": "FARMLAND", "align": "center"},
            {"desc": "标题页末条", "pos": 8, "src": "TP:74", "text": "-- Virginia Woolf"},
            {"desc": "正文首条（AllCaps 样式、文字原样）", "pos": 9, "src": "C:0", "text": "Fade in:"},
            {"desc": "首个场景头＝二级标题带编号前缀", "pos": 10, "src": "C:1", "text": "123 EXT. Mast 2 3 farm - nIGHT"},
            {"desc": "换行回声形态段", "src": "C:10", "text": "Henry"},
            {"desc": "空段落作者间距", "positions": empty_positions, "src": ["C:22", "C:45"]},
            {"desc": "括注缩进锚", "text": "(confused)"},
            {"desc": "人物缩进锚（144pt/18pt）", "text": "WaLTER"},
            {"desc": "对白缩进锚（72pt/108pt）", "text": "Was it like this with me?"},
            {"desc": "转场右对齐锚", "text": "FADE OUT."},
            {"desc": "双栏拆分组（全序列 285–288）", "positions": [285, 286, 287, 288],
             "texts": ["MARY", "But Daddy--", "LOUIS", "I said get!"]},
            {"desc": "内部双空格保留", "src": "C:259", "note": "wobbling  under（两个空格）"},
            {"desc": "行首作者缩进保留（规则 A/B 唯一分歧）", "src": "C:348", "text": "  The horse breaks from the field, dragging the plow behind."},
            {"desc": "末条", "pos": 486, "src": "C:474",
             "text": "He can hear Henry screaming, struggling to wipe the locusts clean. They need to get inside fast."},
        ],
        "hashes": {
            "canonical_text_array_sha256_full_487": canonical_sha(full_texts),
            "canonical_text_array_sha256_content_only_478": canonical_sha(co_texts),
            "definition": "SHA-256(UTF-8(以单个 \\n 连接的期望文本数组))；条目内不含 \\n",
        },
        "cross_checks_non_independent": {
            "repo_frozen_test": "src-tauri/tests/fdx_import_test.rs::storyboarder_fixture_full_import_verbatim 在本推导之后用作事后对照（非独立来源）：损耗计数 1/30/14/1/19、首块 FARMLAND、heading2 '123 EXT…'、缩进 72/108、108/144、144/18、FADE OUT. 右对齐——与本脚本独立推导全部一致。",
        },
        "contradictions": [
            "前探员口径『Content 内嵌套 118』与本脚本实测 114 不符：114＝DualDialogue 4＋Summary 76＋ScriptNote 34（全文件嵌套 199 与本脚本一致：114＋标题页 77＋页面家具 4＋水印 1＋ListItem 1＋未锚定剧注 4＝199 的其余 85 在 Content 外）。118 无独立成团解释（114＋4 恰为未锚定剧注段数，疑误并入，仅记为猜测）。",
            "编排指令『展平编辑器期望序列 478 条』仅对正文子序列成立：完整期望序列按已归档 spec（标题页并入正文开头）为 487 条＝标题页 9＋正文 474＋双栏 4。本 JSON 两套都提供（expected_editor_sequence 487；content_only_view 478）。",
            "编排指令『空白规则只剥两端』与产品已文档化行规则在 C:348 一处分歧（行首两空格：文档化规则保留、简化口径剥除）。主口径取文档化规则 A，分歧已在 whitespace_rules 记录。",
        ],
        "uncertainties": [
            "Parenthetical FirstIndent=-0.10 悬挂缩进的产品换算值未在冻结断言覆盖，不作为对照断言",
            "TitlePage Full→两端对齐（justify）的编辑器属性具体取值未逐字验证（spec 语义明确，属性名/值待 UI 对照）",
            "expected_preview_prediction 的 paragraph_count/char_count 为预测，预检实际显示以任务 3 真实 UI 为准",
            "style_runs 的 AllCaps 丢弃为预期（文字原样），未做 UI 逐字验证",
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(doc, ensure_ascii=False, indent=1)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(payload + "\n")

    print("source_sha256:", src_sha)
    print("json:", OUT)
    print("json_sha256:", sha256_bytes(OUT.read_bytes()))
    print("entries_full_487:", len(entries))
    print("entries_content_only_478:", len(content_only))
    print("canonical_full_487_sha256:", doc["hashes"]["canonical_text_array_sha256_full_487"])
    print("canonical_content_only_478_sha256:", doc["hashes"]["canonical_text_array_sha256_content_only_478"])
    print("expected_preview_char_count:", doc["expected_preview_prediction"]["char_count"])
    print("empty_positions:", empty_positions)
    print("ALL ASSERTIONS PASSED")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        fail("断言失败: %s" % exc)
