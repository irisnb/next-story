use std::io::{self, BufRead};
use std::process::exit;

use base64::Engine;
use minisign::SecretKeyBox;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("用法: keycheck <私钥路径>；密码经标准输入一行传入");
        exit(2);
    }
    let key_path = args[1].clone();
    // 密码优先经环境变量 KEYCHECK_PASSWORD 传入（与发版脚本既有约定一致）；
    // 未设置时回退到标准输入一行。
    let password = match std::env::var("KEYCHECK_PASSWORD") {
        Ok(p) => p.trim_end_matches(['\r', '\n']).to_string(),
        Err(_) => {
            let mut p = String::new();
            io::stdin()
                .lock()
                .read_line(&mut p)
                .expect("读取密码失败");
            p.trim_end_matches(['\r', '\n']).to_string()
        }
    };

    // tauri 生成的钥匙文件是「外层 base64 包裹整个 minisign 文本」；
    // 解不开外层时按原始文本处理（兼容未包裹的标准格式）。
    let raw = match std::fs::read_to_string(&key_path) {
        Ok(s) => s.trim().to_string(),
        Err(e) => {
            eprintln!("KEY_UNREADABLE: {e}");
            exit(3);
        }
    };
    let unwrapped = match base64::engine::general_purpose::STANDARD.decode(raw.as_bytes()) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => raw,
        },
        Err(_) => raw,
    };

    let key_box = match SecretKeyBox::from_string(&unwrapped) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("KEY_UNREADABLE: {e}");
            exit(3);
        }
    };
    match key_box.into_secret_key(Some(password)) {
        Ok(_) => {
            println!("OK");
            exit(0);
        }
        Err(_) => {
            eprintln!("PASSWORD_WRONG");
            exit(1);
        }
    }
}
