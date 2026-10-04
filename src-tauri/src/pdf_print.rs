//! PDF 打印导出管线（design.md 决策 3）：常驻隐藏打印窗口 ＋ WebView2 `PrintToPdf`。
//!
//! 流程（全局串行队列，同一时间仅一个打印任务）：
//! 1. 复用（或首次创建）隐藏的 `print-window`，加载应用自身前端的打印页
//!    `print.html`（同源、字体与 Paged.js 走捆绑资产，零 CSP 改动）；
//! 2. **每个任务**发送载荷前先 `location.reload()` 重载打印页并等待
//!    `print-page-boot`（常驻页面被 Paged.js 分页改造后二次 preview 会静默失效，
//!    输出陈旧内容——真机验收第 4 个 P0；窗口常驻复用，页面每任务刷新）；
//! 3. 经 Tauri 事件把导出投影（范围过滤后的已保存内容）发往打印页
//!    （boot 蕴含导航完成与载荷监听就绪；复用窗口时不重复导航，固定等待
//!    NavigationCompleted 反而不成立）；
//! 4. 等待页面 `print-ready`（页面在 `document.fonts.ready` ＋ Paged.js 分页完成
//!    后回发，事件驱动，不做固定延时），载荷带任务号防串台；
//! 5. `with_webview` → `ICoreWebView2_7::PrintToPdf`：页尺寸 8.27×11.69 英寸
//!    （A4）、四边边距 0（分页与页边距由 Paged.js 页盒负责）、打印背景、无页眉
//!    页脚；回调经 `webview2-com` 的 `#[implement]` 回调结构 ＋ channel 通知；
//! 6. 校验 `%PDF` 魔数后把临时文件原子重命名到目标路径，失败清理残留。
//!
//! 只读边界：本模块不读取作品文件（投影由 `project::load_scoped_export_project`
//! 在作品锁内完成），导出过程不修改作品任何数据。
//!
//! 打印窗口生命周期：首次导出创建后常驻复用；主窗口销毁时同步销毁
//! （见 `lib.rs` setup 的窗口事件接线），保证应用退出不被隐藏窗口拖住。

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::LazyLock;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Listener, Manager, WebviewWindow};

use crate::project::{ExportFileResult, ExportProject};

/// 打印窗口标签（唯一；主窗口为 `main`）。
const PRINT_WINDOW_LABEL: &str = "print-window";

/// 打印页在前端内的路由（vite 多页入口 `print.html`）。
const PRINT_PAGE_PATH: &str = "print.html";

/// 页面就绪信号（boot / 分页完成）的等待上限。设计给定 30s 量级；取 60s 上限
/// 覆盖长作品分页，量级不变。
const PAGE_READY_TIMEOUT: Duration = Duration::from_secs(60);

/// `PrintToPdf` 回调等待上限（长文档打印可能超过页面就绪时长）。
#[cfg(windows)]
const PRINT_CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);

/// 全局串行打印队列：WebView2 同一 webview 同时仅允许一个打印任务。
static PRINT_QUEUE: LazyLock<parking_lot::Mutex<()>> =
    LazyLock::new(|| parking_lot::Mutex::new(()));

/// 任务号：打印页在就绪回执中原样带回，防止上一任务的迟到回执串台。
static JOB_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// `print-ready` 回执载荷（打印页 `emit("print-ready", payload)` 的 JSON 形状）。
#[derive(serde::Deserialize)]
struct PrintReadyPayload {
    job: u64,
    ok: bool,
    message: Option<String>,
}

/// 执行一次 PDF 打印导出（含串行排队）。始终返回稳定结果结构，错误为中文说明。
pub fn run_print_job(
    app: &AppHandle,
    export_project: &ExportProject,
    target_path: &Path,
) -> ExportFileResult {
    // 全局串行：排队等待前一个打印任务完成。
    let _queue_guard = PRINT_QUEUE.lock();

    let window = match ensure_print_window(app) {
        Ok(window) => window,
        Err(failure) => return failure,
    };

    // 每个任务发送载荷前先重载打印页并等待 boot：真机验收（第 4 个 P0）发现
    // 常驻页面在已被 Paged.js 分页改造过的 document.body 上二次 preview 会静默
    // 失效（print-ready 却照常回发），PrintToPdf 便输出上一个任务的陈旧内容。
    // 每任务 reload 让页面回到干净的初始态（main()：注册载荷监听→回发 boot）；
    // 窗口本身常驻复用不销毁，每任务多几百毫秒是接受过的代价。
    if let Err(failure) = reload_print_page(app, &window) {
        return failure;
    }

    let job = JOB_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let payload = serde_json::json!({ "job": job, "project": export_project });

    // 先注册就绪监听再发送载荷，避免回执早于监听注册的竞态。
    let (ready_tx, ready_rx) = mpsc::channel::<PrintReadyPayload>();
    let ready_listener = app.once("print-ready", move |event| {
        if let Ok(payload) = serde_json::from_str::<PrintReadyPayload>(event.payload()) {
            let _ = ready_tx.send(payload);
        }
    });

    if let Err(error) = window.emit_to(PRINT_WINDOW_LABEL, "print-payload", &payload) {
        app.unlisten(ready_listener);
        return ExportFileResult::failure(format!("无法向打印页面发送导出内容: {error}"));
    }

    let result = loop {
        let Ok(payload) = ready_rx.recv_timeout(PAGE_READY_TIMEOUT) else {
            break ExportFileResult::failure("打印页面渲染超时，请重试".to_string());
        };
        if payload.job != job {
            // 迟到的旧任务回执：继续等待本任务信号。
            continue;
        }
        if !payload.ok {
            break ExportFileResult::failure(format!(
                "打印页面渲染失败: {}",
                payload.message.unwrap_or_else(|| "未知错误".to_string())
            ));
        }
        break match print_webview_to_file(&window, target_path) {
            Ok(()) => ExportFileResult::success(target_path.to_string_lossy().to_string()),
            Err(message) => ExportFileResult::failure(message),
        };
    };

    app.unlisten(ready_listener);
    result
}

/// 「先注册 boot 监听，再触发动作，最后等待 boot 到达」的共用骨架（创建与重载
/// 两处复用）。先注册后触发杜绝「页面先发信号、监听后注册」的竞态；超时报错
/// 文案由调用方给出（中文）。
fn with_boot_signal<T>(
    app: &AppHandle,
    trigger: impl FnOnce() -> Result<T, ExportFileResult>,
    timeout_message: &str,
) -> Result<T, ExportFileResult> {
    let (boot_tx, boot_rx) = mpsc::channel::<()>();
    let boot_listener = app.once("print-page-boot", move |_event| {
        let _ = boot_tx.send(());
    });

    let outcome = trigger().and_then(|value| {
        boot_rx
            .recv_timeout(PAGE_READY_TIMEOUT)
            .map(|()| value)
            .map_err(|_| ExportFileResult::failure(timeout_message.to_string()))
    });

    app.unlisten(boot_listener);
    outcome
}

/// 复用或创建隐藏打印窗口。首次创建时等待页面 boot 信号（脚本与事件监听已就绪）。
fn ensure_print_window(app: &AppHandle) -> Result<WebviewWindow, ExportFileResult> {
    if let Some(window) = app.get_webview_window(PRINT_WINDOW_LABEL) {
        return Ok(window);
    }

    // 注册 boot 监听须先于窗口创建：页面加载完成后随时可能回发 boot。
    with_boot_signal(
        app,
        || {
            tauri::webview::WebviewWindowBuilder::new(
                app,
                PRINT_WINDOW_LABEL,
                tauri::WebviewUrl::App(PathBuf::from(PRINT_PAGE_PATH)),
            )
            .title("Next Story 打印导出")
            .inner_size(1000.0, 1400.0)
            .visible(false)
            .skip_taskbar(true)
            .build()
            .map_err(|error| ExportFileResult::failure(format!("无法创建打印窗口: {error}")))
        },
        "打印页面加载超时，请重试",
    )
}

/// 每个打印任务前重载打印页并等待 boot（确定性恢复页面初始态；窗口常驻复用）。
fn reload_print_page(app: &AppHandle, window: &WebviewWindow) -> Result<(), ExportFileResult> {
    with_boot_signal(
        app,
        || {
            window
                .eval("location.reload()")
                .map_err(|error| ExportFileResult::failure(format!("无法重载打印页面: {error}")))
        },
        "打印页面重载超时，请重试",
    )
}

/// 打印过程中的两类信号：PrintToPdf 调用本身同步返回（是否成功受理），
/// 完成回调异步返回（是否生成文件）。
#[cfg(windows)]
enum PrintSignal {
    Dispatched(Result<(), String>),
    Completed(Result<(), String>),
}

/// 在打印 webview 上执行 `PrintToPdf`：先打到目标目录下的临时文件，
/// 校验 `%PDF` 魔数后原子重命名到目标路径；任何失败清理临时文件。
fn print_webview_to_file(window: &WebviewWindow, target_path: &Path) -> Result<(), String> {
    let Some(parent) = target_path.parent() else {
        return Err("目标文件缺少父目录".to_string());
    };

    // 生成不存在的临时目标路径：先创建再删除只取名字（随机后缀防撞名），
    // PrintToPdf 会自行创建该文件。
    let temp_holder =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法创建临时文件: {e}"))?;
    let temp_path: PathBuf = temp_holder.path().to_path_buf();
    drop(temp_holder);
    let _ = std::fs::remove_file(&temp_path);

    let dispatch_result = dispatch_print_to_pdf(window, &temp_path);

    let outcome = match dispatch_result {
        // 受理失败：PrintToPdf 未执行，回调不会到来。
        Err(message) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(message);
        }
        Ok(wait_completed) => wait_completed(),
    };

    match outcome {
        Ok(()) => {
            if !temp_path.is_file() {
                return Err("打印完成但未生成 PDF 文件".to_string());
            }
            // 魔数校验：确认生成的是 PDF 而非错误页/空文件。
            let mut magic = [0u8; 5];
            match std::fs::File::open(&temp_path)
                .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut magic))
            {
                Ok(()) if &magic == b"%PDF-" => {}
                _ => {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err("生成的文件不是有效的 PDF".to_string());
                }
            }
            match std::fs::rename(&temp_path, target_path) {
                Ok(()) => Ok(()),
                Err(e) => {
                    let _ = std::fs::remove_file(&temp_path);
                    Err(format!("写入目标文件失败: {e}"))
                }
            }
        }
        Err(message) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(message)
        }
    }
}

#[cfg(windows)]
const PDF_SDK_UNSUPPORTED: &str =
    "当前系统的 WebView2 版本不支持导出 PDF，请更新 WebView2 运行时后重试";

/// 调用 WebView2 `PrintToPdf`（打印到临时路径）。`with_webview` 的闭包在主线程
/// 异步执行：仅在「受理失败」（COM 调用同步报错）时经 channel 发
/// [`PrintSignal::Dispatched`]；成功受理不发信号，直接等待完成回调的
/// [`PrintSignal::Completed`]。返回的闭包负责等待最终结果（含超时）。
#[cfg(windows)]
fn dispatch_print_to_pdf(
    window: &WebviewWindow,
    temp_path: &Path,
) -> Result<impl FnOnce() -> Result<(), String>, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, PCWSTR};

    let (tx, rx) = mpsc::channel::<PrintSignal>();
    let dispatch_tx = tx.clone();
    let temp_path = temp_path.to_path_buf();

    window
        .with_webview(move |webview| unsafe {
            let outcome: Result<(), String> = (|| {
                // SAFETY: 窗口附加完成后 controller 已初始化非空；以下均为同步
                // COM getter / 方法调用，调用期间对象存活（与 lib.rs 既有用法一致）。
                let controller = webview.controller();
                let core = controller
                    .CoreWebView2()
                    .map_err(|e| format!("无法访问 WebView2 内核: {e}"))?;

                let core7: ICoreWebView2_7 =
                    core.cast().map_err(|_| PDF_SDK_UNSUPPORTED.to_string())?;
                let core2: ICoreWebView2_2 =
                    core.cast().map_err(|_| PDF_SDK_UNSUPPORTED.to_string())?;
                let environment = core2
                    .Environment()
                    .map_err(|e| format!("无法取得 WebView2 环境: {e}"))?;
                let environment6: ICoreWebView2Environment6 = environment
                    .cast()
                    .map_err(|_| PDF_SDK_UNSUPPORTED.to_string())?;

                // SAFETY: settings 与 handler 在本块内创建并存活至调用结束。
                let settings = environment6
                    .CreatePrintSettings()
                    .map_err(|e| format!("无法创建打印设置: {e}"))?;
                // A4（英寸），四边零边距：分页与页边距由 Paged.js 页盒统一负责。
                settings
                    .SetPageWidth(8.27)
                    .map_err(|e| format!("设置页宽失败: {e}"))?;
                settings
                    .SetPageHeight(11.69)
                    .map_err(|e| format!("设置页高失败: {e}"))?;
                settings
                    .SetMarginTop(0.0)
                    .map_err(|e| format!("设置页边距失败: {e}"))?;
                settings
                    .SetMarginBottom(0.0)
                    .map_err(|e| format!("设置页边距失败: {e}"))?;
                settings
                    .SetMarginLeft(0.0)
                    .map_err(|e| format!("设置页边距失败: {e}"))?;
                settings
                    .SetMarginRight(0.0)
                    .map_err(|e| format!("设置页边距失败: {e}"))?;
                // 背景观感一致；不用原生页眉页脚（页码由 Paged.js 页盒输出）。
                settings
                    .SetShouldPrintBackgrounds(true)
                    .map_err(|e| format!("设置背景打印失败: {e}"))?;
                settings
                    .SetShouldPrintSelectionOnly(false)
                    .map_err(|e| format!("设置打印范围失败: {e}"))?;
                settings
                    .SetShouldPrintHeaderAndFooter(false)
                    .map_err(|e| format!("关闭页眉页脚失败: {e}"))?;

                let handler = PrintToPdfCompletedHandler::create(Box::new(
                    move |error_code: windows_core::Result<()>, succeeded: bool| {
                        let completed = if let Err(error) = error_code {
                            Err(format!("打印失败: {error}"))
                        } else if succeeded {
                            Ok(())
                        } else {
                            Err("打印失败：WebView2 未能生成 PDF".to_string())
                        };
                        let _ = tx.send(PrintSignal::Completed(completed));
                        Ok(())
                    },
                ));

                let wide = windows_core::HSTRING::from(temp_path.as_os_str());
                core7
                    .PrintToPdf(PCWSTR::from_raw(wide.as_ptr()), &settings, &handler)
                    .map_err(|e| format!("启动打印失败: {e}"))
            })();
            if let Err(message) = outcome {
                let _ = dispatch_tx.send(PrintSignal::Dispatched(Err(message)));
            }
        })
        .map_err(|e| format!("无法访问打印窗口视图: {e}"))?;

    Ok(move || match rx.recv_timeout(PRINT_CALLBACK_TIMEOUT) {
        Ok(PrintSignal::Dispatched(result)) => result,
        Ok(PrintSignal::Completed(result)) => result,
        Err(_) => Err("打印超时，请重试".to_string()),
    })
}

/// 非 Windows 平台：产品只发行 Windows 版，打印能力依赖 WebView2。
#[cfg(not(windows))]
fn dispatch_print_to_pdf(
    _window: &WebviewWindow,
    _temp_path: &Path,
) -> Result<Box<dyn FnOnce() -> Result<(), String>>, String> {
    Err("当前平台不支持导出 PDF：打印能力依赖 Windows WebView2".to_string())
}
