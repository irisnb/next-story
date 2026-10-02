// add-markdown-import 任务 1.1 spike：实证 pulldown-cmark 事件形态。
// 四点验证：①BOM 实际行为 ②<u> 逐标签 InlineHtml ③表格/任务列表/脚注事件 ④HardBreak/SoftBreak。
// 用法：cargo run --example md_parse_spike -- [gold.md]
use pulldown_cmark::{Options, Parser};

fn brief(ev: &pulldown_cmark::Event) -> String {
    let s = format!("{ev:?}");
    if s.chars().count() > 70 {
        let cut: String = s.chars().take(70).collect();
        format!("{cut}…")
    } else {
        s
    }
}

fn main() {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);

    let synthetic = "# 标题一\n\n段落 **粗** *斜* ~~删~~ <u>下划线</u> [链](https://e.com) `码`\n\n软换行A\n软换行B  \n硬换行C\n\n- 无序项\n- [x] 任务项\n\n3. 第三\n4. 第四\n\n> 引用块\n\n```\n块代码\n```\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n\n---\n\n正文脚注[^1]。\n\n[^1]: 脚注定义。\n";

    println!("=== 合成样本事件流（结构，中文可能乱码） ===");
    for (ev, _) in Parser::new_ext(synthetic, opts).into_offset_iter() {
        println!("{}", brief(&ev));
    }

    println!("\n=== ① BOM 行为（U+FEFF 是否进入首个文本事件） ===");
    let bom = "\u{feff}BOM后正文";
    for (i, (ev, _)) in Parser::new_ext(bom, opts).into_offset_iter().enumerate() {
        let s = format!("{ev:?}");
        let escaped = s.replace('\u{feff}', "<FEFF>"); // Debug 若含字面 BOM 则显式标出
        println!("[{i}] {escaped}");
    }

    println!("\n=== ② 硬/软换行对照（前一行尾两空格=HardBreak） ===");
    let brk = "aaa\nbbb  \nccc";
    for (ev, _) in Parser::new_ext(brk, opts).into_offset_iter() {
        println!("{}", brief(&ev));
    }

    if let Some(path) = std::env::args().nth(1) {
        let content = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读取失败: {e}"));
        println!("\n=== 金样本: {path}（{} 字节） ===", content.len());
        let mut count = 0usize;
        for (ev, _) in Parser::new_ext(&content, opts).into_offset_iter() {
            println!("{}", brief(&ev));
            count += 1;
        }
        println!("事件总数: {count}");
    }
}
