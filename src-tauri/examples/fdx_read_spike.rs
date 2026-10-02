// add-fdx-import 任务 1.1 spike：实证 .fdx 结构（roxmltree 一次性 DOM）。
// 用法：cargo run --example fdx_read_spike -- [file.fdx]
use std::collections::BTreeMap;
use std::env;
use std::fs;

fn dump(n: roxmltree::Node, depth: usize, out: &mut String) {
    if depth > 6 {
        return;
    }
    let ind = "  ".repeat(depth);
    if n.is_element() {
        let attrs: Vec<String> = n
            .attributes()
            .map(|a| format!("{}={}", a.name(), a.value()))
            .collect();
        out.push_str(&format!(
            "{ind}<{}{}>\n",
            n.tag_name().name(),
            if attrs.is_empty() { String::new() } else { format!(" [{}]", attrs.join(", ")) }
        ));
        for c in n.children() {
            dump(c, depth + 1, out);
        }
    } else if n.is_text() {
        let t: String = n.text().unwrap_or("").trim().chars().take(60).collect();
        if !t.is_empty() {
            out.push_str(&format!("{ind}\"{t}\"\n"));
        }
    }
}

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| {
        "tests/fixtures/fdx/storyboarder-test.fdx".to_string()
    });
    let bytes = fs::read(&path).expect("read fdx");
    let has_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let slice = if has_bom { &bytes[3..] } else { &bytes[..] };
    let text = String::from_utf8(slice.to_vec()).expect("utf8");
    println!("file: {path} ({} bytes, BOM={has_bom})", bytes.len());

    let doc = match roxmltree::Document::parse(&text) {
        Ok(d) => d,
        Err(e) => {
            println!("PARSE FAILED: {e:?}");
            return;
        }
    };
    let root = doc.root_element();
    let root_attrs: Vec<String> = root
        .attributes()
        .map(|a| format!("{}={}", a.name(), a.value()))
        .collect();
    println!("root: <{}> [{}]", root.tag_name().name(), root_attrs.join(", "));

    let mut census: BTreeMap<String, usize> = BTreeMap::new();
    fn walk(n: roxmltree::Node, census: &mut BTreeMap<String, usize>) {
        if n.is_element() {
            *census.entry(n.tag_name().name().to_string()).or_default() += 1;
            for c in n.children() {
                walk(c, census);
            }
        }
    }
    walk(root, &mut census);
    println!("\n== element census ==");
    for (k, v) in &census {
        println!("{k}: {v}");
    }

    println!("\n== Paragraph Type values ==");
    let mut types: BTreeMap<String, usize> = BTreeMap::new();
    let mut numbered: Vec<String> = Vec::new();
    for n in doc.descendants() {
        if n.is_element() && n.tag_name().name() == "Paragraph" {
            let t = n.attribute("Type").unwrap_or("<noType>").to_string();
            *types.entry(t).or_default() += 1;
            if let Some(num) = n.attribute("Number") {
                if numbered.len() < 5 {
                    numbered.push(num.to_string());
                }
            }
        }
    }
    for (k, v) in &types {
        println!("{k}: {v}");
    }
    println!("Paragraph Number attrs(first5): {numbered:?}");

    println!("\n== Style elements (first 5) ==");
    let mut shown = 0;
    for n in doc.descendants() {
        if shown >= 5 {
            break;
        }
        if n.is_element() && n.tag_name().name() == "Style" {
            let attrs: Vec<String> = n
                .attributes()
                .map(|a| format!("{}={}", a.name(), a.value()))
                .collect();
            println!("Style [{}]", attrs.join(", "));
            shown += 1;
        }
    }
    if shown == 0 {
        println!("(none)");
    }

    println!("\n== DualDialogue (首个完整结构) ==");
    if let Some(dd) = doc
        .descendants()
        .find(|n| n.is_element() && n.tag_name().name() == "DualDialogue")
    {
        let mut out = String::new();
        if let Some(p) = dd.parent() {
            dump(p, 0, &mut out);
        }
        println!("{out}");
    } else {
        println!("(none)");
    }

    println!(
        "== TitlePage present: {} ==",
        doc.descendants().any(|n| n.is_element() && n.tag_name().name() == "TitlePage")
    );
    println!(
        "== Alignment attr present: {} ==",
        doc.descendants()
            .any(|n| n.is_element() && n.attributes().any(|a| a.name() == "Alignment"))
    );
}
