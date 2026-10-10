fn main() {
    // tauri-build 只把 tauri.conf.json / capabilities / sidecar 等登记为 rerun 依赖，
    // 不跟踪 bundle.icon 里的图标文件；不显式登记时，仅更新图标不会重编 Windows 资源，
    // 生成的 exe / 安装包会保留旧图标。此处按 tauri.conf.json 的 bundle.icon 显式登记，
    // 保证图标变动触发本构建脚本（进而重新生成 resource.rc / resource.lib 并重链）。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    tauri_build::build()
}
