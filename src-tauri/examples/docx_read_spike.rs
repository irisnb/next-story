// add-word-import 任务 1.2 spike：
// 用 docx-rs 0.4.22 读取 API 跑真实 WPS 金样本，验证解析可行性与保真度。
// 用法：cargo run --example docx_read_spike -- [path/to/sample.docx]
use std::env;
use std::fs;

use docx_rs::{
    read_docx_with_options, DocumentChild, Paragraph, ParagraphChild, ReadDocxOptions, Run,
    RunChild,
};

#[derive(Default)]
struct Stats {
    paragraphs: usize,
    tables: usize,
    runs: usize,
    text_nodes: usize,
    text_chars: usize,
    empty_paras: usize,
    numpr_paras: usize,
    numpr_id_zero: usize,
    numpr_id_nonzero: Vec<usize>,
    numpr_no_id: usize,
    style_paras: usize,
    bold_runs: usize,
    italic_runs: usize,
    underline_runs: usize,
    strike_runs: usize,
    color_runs: usize,
    sz_runs: usize,
    highlight_runs: usize,
    fonts_runs: usize,
    hyperlink_paras: usize,
    insert_paras: usize,
    delete_paras: usize,
    markers_total: usize,
    markers_all_bold: usize,
}

fn is_episode_marker(s: &str) -> bool {
    let t = s.trim();
    let n = t.chars().count();
    if !(3..=14).contains(&n) {
        return false;
    }
    let mut cs = t.chars();
    if cs.next() != Some('第') {
        return false;
    }
    if cs.next_back() != Some('集') {
        return false;
    }
    let inner: String = t.chars().skip(1).take(n - 2).collect();
    if inner.is_empty() {
        return false;
    }
    inner
        .chars()
        .all(|c| matches!(c, '0'..='9') || "一二三四五六七八九十百零两".contains(c))
}

fn para_text(p: &Paragraph) -> String {
    let mut out = String::new();
    for c in &p.children {
        match c {
            ParagraphChild::Run(r) => {
                for rc in &r.children {
                    if let RunChild::Text(t) = rc {
                        out.push_str(&t.text);
                    }
                }
            }
            ParagraphChild::Hyperlink(h) => {
                for hc in &h.children {
                    if let ParagraphChild::Run(r) = hc {
                        for rc in &r.children {
                            if let RunChild::Text(t) = rc {
                                out.push_str(&t.text);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn walk_run(r: &Run, st: &mut Stats) {
    st.runs += 1;
    let rp = &r.run_property;
    if rp.bold.is_some() {
        st.bold_runs += 1;
    }
    if rp.italic.is_some() {
        st.italic_runs += 1;
    }
    if rp.underline.is_some() {
        st.underline_runs += 1;
    }
    if rp.strike.is_some() {
        st.strike_runs += 1;
    }
    if rp.color.is_some() {
        st.color_runs += 1;
    }
    if rp.sz.is_some() {
        st.sz_runs += 1;
    }
    if rp.highlight.is_some() {
        st.highlight_runs += 1;
    }
    if rp.fonts.is_some() {
        st.fonts_runs += 1;
    }
    for rc in &r.children {
        if let RunChild::Text(_) = rc {
            st.text_nodes += 1;
        }
    }
}

fn walk_para(p: &Paragraph, st: &mut Stats) {
    st.paragraphs += 1;
    if let Some(np) = &p.property.numbering_property {
        st.numpr_paras += 1;
        match &np.id {
            Some(nid) => {
                if nid.id == 0 {
                    st.numpr_id_zero += 1;
                } else {
                    st.numpr_id_nonzero.push(nid.id);
                }
            }
            None => st.numpr_no_id += 1,
        }
    }
    if p.property.style.is_some() {
        st.style_paras += 1;
    }
    let text = para_text(p);
    st.text_chars += text.chars().count();
    if text.trim().is_empty() {
        st.empty_paras += 1;
    }
    if is_episode_marker(&text) {
        st.markers_total += 1;
        let has_text_runs = p.children.iter().any(|c| {
            matches!(c, ParagraphChild::Run(r) if !para_text_of_run(r).trim().is_empty())
        });
        let all_bold = p.children.iter().all(|c| match c {
            ParagraphChild::Run(r) => {
                para_text_of_run(r).trim().is_empty() || r.run_property.bold.is_some()
            }
            _ => true,
        });
        if has_text_runs && all_bold {
            st.markers_all_bold += 1;
        }
    }
    for c in &p.children {
        match c {
            ParagraphChild::Run(r) => walk_run(r, st),
            ParagraphChild::Hyperlink(h) => {
                st.hyperlink_paras += 1;
                for hc in &h.children {
                    if let ParagraphChild::Run(r) = hc {
                        walk_run(r, st);
                    }
                }
            }
            ParagraphChild::Insert(_) => st.insert_paras += 1,
            ParagraphChild::Delete(_) => st.delete_paras += 1,
            _ => {}
        }
    }
}

fn para_text_of_run(r: &Run) -> String {
    let mut out = String::new();
    for rc in &r.children {
        if let RunChild::Text(t) = rc {
            out.push_str(&t.text);
        }
    }
    out
}

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/Administrator/AppData/Local/Temp/opencode/docx-anatomy/sample.docx".to_string()
    });
    let buf = fs::read(&path).unwrap_or_else(|e| panic!("read file failed: {e}"));
    println!("file: {path}");
    println!("file size: {} bytes", buf.len());

    let docx = match read_docx_with_options(
        &buf,
        ReadDocxOptions::default().with_image_previews(false),
    ) {
        Ok(d) => d,
        Err(e) => {
            println!("READ FAILED: {e:?}");
            return;
        }
    };
    println!("READ OK — docx-rs read_docx 解析成功\n");

    let mut st = Stats::default();
    for child in &docx.document.children {
        match child {
            DocumentChild::Paragraph(p) => walk_para(p, &mut st),
            DocumentChild::Table(_) => st.tables += 1,
            _ => {}
        }
    }

    println!("=== SPIKE RESULT vs 解剖基准 ===");
    println!("paragraphs      : {}   (基准 2718)", st.paragraphs);
    println!("tables          : {}   (基准 0)", st.tables);
    println!("runs            : {}   (基准 4681)", st.runs);
    println!("text nodes      : {}   (基准 4680)", st.text_nodes);
    println!("text chars      : {}   (基准 55331)", st.text_chars);
    println!("empty paras     : {}   (基准 191)", st.empty_paras);
    println!("numPr paras     : {}   (基准 732)", st.numpr_paras);
    println!("  numId=0 墓碑  : {}   (基准 730)", st.numpr_id_zero);
    println!(
        "  numId!=0 真编号: {:?}   (基准 [1, 1])",
        st.numpr_id_nonzero
    );
    println!("  numPr 无 id   : {}", st.numpr_no_id);
    println!("pStyle paras    : {}   (基准 0)", st.style_paras);
    println!("bold runs       : {}   (基准 ~2761 含段落级 rPr)", st.bold_runs);
    println!("italic runs     : {}", st.italic_runs);
    println!("underline runs  : {}", st.underline_runs);
    println!("strike runs     : {}", st.strike_runs);
    println!("color runs      : {}   (基准 2066)", st.color_runs);
    println!("sz runs         : {}   (基准 6675 含 szCs)", st.sz_runs);
    println!("highlight runs  : {}   (基准 1974 含 noHighlight)", st.highlight_runs);
    println!("fonts runs      : {}   (基准 3808)", st.fonts_runs);
    println!("hyperlink paras : {}", st.hyperlink_paras);
    println!("insert/delete   : {}/{}", st.insert_paras, st.delete_paras);
    println!(
        "集数标记(独立成段)  : {}   (基准 61)",
        st.markers_total
    );
    println!(
        "集数标记(且全加粗)  : {}   (设计拆分规则输入)",
        st.markers_all_bold
    );
}
