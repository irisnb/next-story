use std::fs;
use std::path::Path;

use next_story_lib::project::{
    create_new_project, open_existing_project, save_existing_project, validate_project_name,
    CreateProjectParams, ProjectError,
};
use tempfile::TempDir;

/// 生成一段合法格式版本 1 的本子 JSON 字符串（每行一个正文段落）。
fn valid_notebook_json(text: &str) -> String {
    let content: Vec<serde_json::Value> = text
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                serde_json::json!({ "type": "paragraph" })
            } else {
                serde_json::json!({
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": line }]
                })
            }
        })
        .collect();
    let value = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 1,
        "document": { "type": "doc", "content": content }
    });
    serde_json::to_string_pretty(&value).expect("serialize notebook")
}

fn write_valid_project_metadata(project_root: &Path, name: &str) {
    let metadata = serde_json::json!({
        "name": name,
        "created_at": "2026-07-25T00:00:00Z",
        "updated_at": "2026-07-25T00:00:00Z",
        "version": 2
    });

    fs::write(
        project_root.join("next-story-system").join("project.json"),
        serde_json::to_string_pretty(&metadata).expect("serialize metadata"),
    )
    .expect("write metadata");
}

fn write_raw_metadata(project_root: &Path, json: &str) {
    fs::write(
        project_root.join("next-story-system").join("project.json"),
        json,
    )
    .expect("write raw metadata");
}

fn create_valid_project_folder(root: &Path, name: &str) {
    fs::create_dir_all(root.join("作品文本")).expect("create user text dir");
    fs::create_dir_all(root.join("next-story-system")).expect("create system dir");
    fs::write(
        root.join("作品文本").join("草稿本.json"),
        valid_notebook_json("草稿"),
    )
    .expect("write draft");
    fs::write(
        root.join("作品文本").join("正文本.json"),
        valid_notebook_json("正文"),
    )
    .expect("write main");
    write_valid_project_metadata(root, name);
}

#[cfg(unix)]
fn symlink_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(windows)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[test]
fn create_new_project_creates_expected_chinese_structure() {
    let temp = TempDir::new().expect("create temp dir");

    let project_path = create_new_project(CreateProjectParams {
        name: "测试作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project through production API");

    assert!(project_path.join("作品文本").is_dir());
    assert!(project_path.join("作品文本").join("草稿本.json").is_file());
    assert!(project_path.join("作品文本").join("正文本.json").is_file());
    assert!(project_path.join("next-story-system").is_dir());
    assert!(project_path
        .join("next-story-system")
        .join("project.json")
        .is_file());
}

#[test]
fn create_new_project_writes_valid_blank_structured_notebooks() {
    let temp = TempDir::new().expect("create temp dir");

    let project_path = create_new_project(CreateProjectParams {
        name: "空白文档".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let draft =
        fs::read_to_string(project_path.join("作品文本").join("草稿本.json")).expect("read draft");
    let main =
        fs::read_to_string(project_path.join("作品文本").join("正文本.json")).expect("read main");

    for content in [draft, main] {
        let value: serde_json::Value = serde_json::from_str(&content).expect("parse notebook");
        assert_eq!(value["format"], "next-story-tiptap");
        assert_eq!(value["version"], 1);
        assert_eq!(value["document"]["type"], "doc");
        assert_eq!(value["document"]["content"][0]["type"], "paragraph");
    }
}

#[test]
fn create_new_project_rejects_empty_invalid_reserved_and_existing_names() {
    let temp = TempDir::new().expect("create temp dir");

    assert!(matches!(
        validate_project_name("   "),
        Err(ProjectError::EmptyName)
    ));
    assert!(matches!(
        validate_project_name("坏/名字"),
        Err(ProjectError::InvalidNameChars(_))
    ));
    assert!(matches!(
        validate_project_name("CON"),
        Err(ProjectError::InvalidNameChars(_))
    ));
    assert!(matches!(
        validate_project_name(".."),
        Err(ProjectError::InvalidNameChars(_))
    ));
    assert!(matches!(
        validate_project_name("结尾点."),
        Err(ProjectError::InvalidNameChars(_))
    ));

    create_new_project(CreateProjectParams {
        name: "重复作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("first create succeeds");

    let duplicate = create_new_project(CreateProjectParams {
        name: "重复作品".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    });

    assert!(matches!(duplicate, Err(ProjectError::FolderExists(_))));
}

#[test]
fn open_existing_project_rejects_missing_or_malformed_project_files() {
    let temp = TempDir::new().expect("create temp dir");
    let broken_root = temp.path().join("坏项目");
    fs::create_dir_all(broken_root.join("作品文本")).expect("create partial structure");
    fs::write(
        broken_root.join("作品文本").join("正文本.json"),
        valid_notebook_json("正文"),
    )
    .expect("write main");
    fs::create_dir_all(broken_root.join("next-story-system")).expect("create system dir");
    fs::write(
        broken_root.join("next-story-system").join("project.json"),
        "not json",
    )
    .expect("write malformed metadata");

    assert!(matches!(
        open_existing_project(&broken_root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_existing_project_rejects_required_file_symlink_when_it_escapes_root() {
    let temp = TempDir::new().expect("create temp dir");
    let project_root = temp.path().join("逃逸项目");
    create_valid_project_folder(&project_root, "逃逸项目");

    let outside_draft = temp.path().join("outside-draft.json");
    fs::write(&outside_draft, valid_notebook_json("外部草稿")).expect("write outside draft");
    fs::remove_file(project_root.join("作品文本").join("草稿本.json"))
        .expect("remove normal draft");
    if let Err(error) = symlink_file(
        &outside_draft,
        &project_root.join("作品文本").join("草稿本.json"),
    ) {
        eprintln!("skipping symlink boundary test: {error}");
        return;
    }

    assert!(matches!(
        open_existing_project(&project_root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_existing_project_rejects_project_root_symlink() {
    let temp = TempDir::new().expect("create temp dir");
    let real_project_root = temp.path().join("真实项目");
    let linked_project_root = temp.path().join("链接项目");
    create_valid_project_folder(&real_project_root, "真实项目");

    if let Err(error) = symlink_dir(&real_project_root, &linked_project_root) {
        eprintln!("skipping root symlink boundary test: {error}");
        return;
    }

    assert!(matches!(
        open_existing_project(&linked_project_root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_existing_project_rejects_oversized_draft_before_opening() {
    let temp = TempDir::new().expect("create temp dir");
    let project_root = temp.path().join("过大项目");
    create_valid_project_folder(&project_root, "过大项目");

    let oversized_text = "x".repeat(11 * 1024 * 1024);
    fs::write(
        project_root.join("作品文本").join("草稿本.json"),
        oversized_text,
    )
    .expect("write oversized draft");

    assert!(matches!(
        open_existing_project(&project_root),
        Err(ProjectError::InvalidStructure(_) | ProjectError::ReadError(_))
    ));
}

#[test]
fn open_existing_project_rejects_oversized_main_before_opening() {
    let temp = TempDir::new().expect("create temp dir");
    let project_root = temp.path().join("过大正文项目");
    create_valid_project_folder(&project_root, "过大正文项目");

    let oversized_text = "x".repeat(11 * 1024 * 1024);
    fs::write(
        project_root.join("作品文本").join("正文本.json"),
        oversized_text,
    )
    .expect("write oversized main");

    assert!(matches!(
        open_existing_project(&project_root),
        Err(ProjectError::InvalidStructure(_) | ProjectError::ReadError(_))
    ));
}

#[test]
fn open_existing_project_rejects_oversized_metadata_before_opening() {
    let temp = TempDir::new().expect("create temp dir");
    let project_root = temp.path().join("过大元信息项目");
    create_valid_project_folder(&project_root, "过大元信息项目");

    let oversized_metadata = "x".repeat(65 * 1024);
    fs::write(
        project_root.join("next-story-system").join("project.json"),
        oversized_metadata,
    )
    .expect("write oversized metadata");

    assert!(matches!(
        open_existing_project(&project_root),
        Err(ProjectError::InvalidStructure(_) | ProjectError::ReadError(_))
    ));
}

#[test]
fn save_and_reopen_preserves_both_notebooks_through_production_api() {
    let temp = TempDir::new().expect("create temp dir");
    let project_path = create_new_project(CreateProjectParams {
        name: "iris".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let draft_doc = valid_notebook_json("草稿第一行\n草稿第二行");
    let main_doc = valid_notebook_json("正文第一行\n正文第二行");

    save_existing_project(&project_path, draft_doc.clone(), main_doc.clone())
        .expect("save both notebooks");

    let reopened = open_existing_project(&project_path).expect("reopen saved project");

    assert_eq!(reopened.metadata.name, "iris");
    assert_eq!(reopened.draft_content, draft_doc);
    assert_eq!(reopened.main_content, main_doc);
}

// ---------------------------------------------------------------------------
// 项目结构版本失败测试（任务 1.3）
// ---------------------------------------------------------------------------

fn reject_with_version_error(
    result: Result<next_story_lib::project::ProjectOpenResult, ProjectError>,
) {
    match result {
        Err(ProjectError::InvalidStructure(message)) => {
            assert!(
                message.contains("不支持的项目结构版本"),
                "期望版本错误，实际: {message}"
            );
        }
        other => panic!("期望 InvalidStructure 版本错误，实际: {other:?}"),
    }
}

#[test]
fn open_rejects_old_project_structure_version_1() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("旧版本");
    create_valid_project_folder(&root, "旧版本");
    write_raw_metadata(
        &root,
        r#"{"name":"旧版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":1}"#,
    );

    reject_with_version_error(open_existing_project(&root));
}

#[test]
fn open_rejects_unknown_future_project_structure_version() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("未来版本");
    create_valid_project_folder(&root, "未来版本");
    write_raw_metadata(
        &root,
        r#"{"name":"未来版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":3}"#,
    );

    reject_with_version_error(open_existing_project(&root));
}

#[test]
fn open_rejects_old_txt_only_project() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("旧txt项目");
    fs::create_dir_all(root.join("作品文本")).expect("create user text dir");
    fs::create_dir_all(root.join("next-story-system")).expect("create system dir");
    fs::write(root.join("作品文本").join("草稿本.txt"), "草稿").expect("write old draft");
    fs::write(root.join("作品文本").join("正文本.txt"), "正文").expect("write old main");
    write_raw_metadata(
        &root,
        r#"{"name":"旧txt项目","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":1}"#,
    );

    let result = open_existing_project(&root);
    assert!(matches!(result, Err(ProjectError::InvalidStructure(_))));

    // 不迁移、不改写任何原文件
    assert!(root.join("作品文本").join("草稿本.txt").is_file());
    assert!(root.join("作品文本").join("正文本.txt").is_file());
    assert!(!root.join("作品文本").join("草稿本.json").exists());
}

#[test]
fn open_rejects_missing_version_field() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("缺版本");
    create_valid_project_folder(&root, "缺版本");
    write_raw_metadata(
        &root,
        r#"{"name":"缺版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z"}"#,
    );

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_rejects_version_as_string() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("字符串版本");
    create_valid_project_folder(&root, "字符串版本");
    write_raw_metadata(
        &root,
        r#"{"name":"字符串版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":"2"}"#,
    );

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_rejects_version_as_null() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("空版本");
    create_valid_project_folder(&root, "空版本");
    write_raw_metadata(
        &root,
        r#"{"name":"空版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":null}"#,
    );

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_rejects_version_as_fraction() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("小数版本");
    create_valid_project_folder(&root, "小数版本");
    write_raw_metadata(
        &root,
        r#"{"name":"小数版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":1.5}"#,
    );

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn open_rejects_version_as_negative() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("负版本");
    create_valid_project_folder(&root, "负版本");
    write_raw_metadata(
        &root,
        r#"{"name":"负版本","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":-1}"#,
    );

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_))
    ));
}

#[test]
fn unsupported_version_with_interrupted_transaction_leaves_all_bytes_unchanged() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("中断事务");
    create_valid_project_folder(&root, "中断事务");

    // 制造一个中断保存事务目录
    let tx_dir = root.join("next-story-system").join("save-transaction");
    fs::create_dir_all(&tx_dir).expect("create transaction dir");
    fs::write(
        tx_dir.join("manifest.json"),
        r#"{"manifest_version":1,"phase":"Committing","target_updated_at":"2026-07-25T00:00:00Z"}"#,
    )
    .expect("write manifest");
    fs::write(tx_dir.join("草稿本.json"), valid_notebook_json("暂存草稿"))
        .expect("write staged draft");
    fs::write(tx_dir.join("正文本.json"), valid_notebook_json("暂存正文"))
        .expect("write staged main");
    fs::write(tx_dir.join("project.json"), "{}").expect("write staged metadata");

    // 把版本改为不受支持的 1
    let metadata_path = root.join("next-story-system").join("project.json");
    write_raw_metadata(
        &root,
        r#"{"name":"中断事务","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":1}"#,
    );

    // 记录所有文件字节
    let snapshot_files = [
        metadata_path.clone(),
        root.join("作品文本").join("草稿本.json"),
        root.join("作品文本").join("正文本.json"),
        tx_dir.join("manifest.json"),
        tx_dir.join("草稿本.json"),
        tx_dir.join("正文本.json"),
        tx_dir.join("project.json"),
    ];
    let before: Vec<Vec<u8>> = snapshot_files
        .iter()
        .map(|p| fs::read(p).expect("read before snapshot"))
        .collect();

    // 打开必须拒绝（在恢复事务之前）
    let result = open_existing_project(&root);
    assert!(matches!(result, Err(ProjectError::InvalidStructure(_))));

    // 全部文件字节不变
    for (path, before_bytes) in snapshot_files.iter().zip(before.iter()) {
        let after = fs::read(path).expect("read after snapshot");
        assert_eq!(&after, before_bytes, "文件字节被改动: {}", path.display());
    }
}

// ---------------------------------------------------------------------------
// 打开时本子文档校验失败测试（任务 2.1）
// ---------------------------------------------------------------------------

fn assert_open_rejects_invalid_notebook(notebook_json: &str, file: &str) {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("坏本子");
    create_valid_project_folder(&root, "坏本子");

    let target = root.join("作品文本").join(file);
    fs::write(&target, notebook_json).expect("write invalid notebook");
    let invalid_bytes = fs::read(&target).expect("read invalid notebook");

    let result = open_existing_project(&root);

    match result {
        Err(ProjectError::InvalidStructure(message)) => {
            assert!(
                message.contains("草稿本") || message.contains("正文本"),
                "错误应标明具体本子，实际: {message}"
            );
        }
        other => panic!("期望 InvalidStructure 本子校验错误，实际: {other:?}"),
    }

    // 打开失败后原文件字节不变，不生成空白替代
    let after = fs::read(&target).expect("read after failed open");
    assert_eq!(
        after,
        invalid_bytes,
        "打开失败后本子文件被修改: {}",
        target.display()
    );
}

#[test]
fn open_rejects_corrupted_notebook_json() {
    assert_open_rejects_invalid_notebook("这不是 JSON", "草稿本.json");
}

#[test]
fn open_rejects_unsupported_notebook_document_version() {
    let doc = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 2,
        "document": { "type": "doc", "content": [{ "type": "paragraph" }] }
    });
    assert_open_rejects_invalid_notebook(
        &serde_json::to_string(&doc).expect("serialize"),
        "正文本.json",
    );
}

#[test]
fn open_rejects_unknown_node_type() {
    let doc = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 1,
        "document": { "type": "doc", "content": [{ "type": "image", "attrs": { "src": "x.png" } }] }
    });
    assert_open_rejects_invalid_notebook(
        &serde_json::to_string(&doc).expect("serialize"),
        "草稿本.json",
    );
}

#[test]
fn open_rejects_nested_list() {
    let doc = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 1,
        "document": {
            "type": "doc",
            "content": [
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                { "type": "paragraph" },
                                { "type": "bulletList", "content": [{ "type": "listItem", "content": [{ "type": "paragraph" }] }] }
                            ]
                        }
                    ]
                }
            ]
        }
    });
    assert_open_rejects_invalid_notebook(
        &serde_json::to_string(&doc).expect("serialize"),
        "草稿本.json",
    );
}

#[test]
fn open_rejects_oversized_notebook_before_reading() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("超限本子");
    create_valid_project_folder(&root, "超限本子");

    let target = root.join("作品文本").join("草稿本.json");
    fs::write(&target, "x".repeat(11 * 1024 * 1024)).expect("write oversized notebook");

    assert!(matches!(
        open_existing_project(&root),
        Err(ProjectError::InvalidStructure(_) | ProjectError::ReadError(_))
    ));
}

// ---------------------------------------------------------------------------
// 保存载荷校验与恢复重校验（任务 2.2 / 2.3）
// ---------------------------------------------------------------------------

#[test]
fn save_rejects_invalid_notebook_payload_before_staging() {
    let temp = TempDir::new().expect("create temp dir");
    let project_path = create_new_project(CreateProjectParams {
        name: "非法保存".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let draft_path = project_path.join("作品文本").join("草稿本.json");
    let main_path = project_path.join("作品文本").join("正文本.json");
    let metadata_path = project_path.join("next-story-system").join("project.json");

    let before_draft = fs::read(&draft_path).expect("read draft before");
    let before_main = fs::read(&main_path).expect("read main before");
    let before_metadata = fs::read(&metadata_path).expect("read metadata before");

    // 非法草稿载荷（纯文本，非结构化 JSON）
    let result = save_existing_project(
        &project_path,
        "纯文本草稿".to_string(),
        valid_notebook_json("正文").to_string(),
    );

    assert!(matches!(result, Err(ProjectError::InvalidStructure(_))));

    // 三个可见文件保持原有完整世代
    assert_eq!(
        fs::read(&draft_path).expect("read draft after"),
        before_draft
    );
    assert_eq!(fs::read(&main_path).expect("read main after"), before_main);
    assert_eq!(
        fs::read(&metadata_path).expect("read metadata after"),
        before_metadata
    );

    // 未创建事务暂存目录
    let tx_dir = project_path
        .join("next-story-system")
        .join("save-transaction");
    assert!(!tx_dir.exists(), "非法保存不应创建事务暂存目录");
}

#[test]
fn open_rejects_unrecoverable_transaction_with_invalid_staged_notebook() {
    let temp = TempDir::new().expect("create temp dir");
    let project_path = create_new_project(CreateProjectParams {
        name: "坏恢复".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    // 制造一个提交阶段的中断事务，但暂存草稿是非法内容
    let tx_dir = project_path
        .join("next-story-system")
        .join("save-transaction");
    fs::create_dir_all(&tx_dir).expect("create transaction dir");
    fs::write(
        tx_dir.join("manifest.json"),
        r#"{"manifest_version":1,"phase":"Committing","target_updated_at":"2026-07-25T00:00:00Z"}"#,
    )
    .expect("write manifest");
    fs::write(tx_dir.join("草稿本.json"), "非法暂存草稿").expect("write invalid staged draft");
    fs::write(tx_dir.join("正文本.json"), valid_notebook_json("暂存正文"))
        .expect("write staged main");
    fs::write(
        tx_dir.join("project.json"),
        r#"{"name":"坏恢复","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":2}"#,
    )
    .expect("write staged metadata");

    let result = open_existing_project(&project_path);
    assert!(matches!(result, Err(ProjectError::ReadError(_))));
}

// ---------------------------------------------------------------------------
// 保存大小上限与超限事务恢复（工程审查 P1-01）
// ---------------------------------------------------------------------------

#[test]
fn save_rejects_oversized_draft_before_staging() {
    let temp = TempDir::new().expect("create temp dir");
    let project_path = create_new_project(CreateProjectParams {
        name: "超限草稿".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let draft_path = project_path.join("作品文本").join("草稿本.json");
    let main_path = project_path.join("作品文本").join("正文本.json");
    let metadata_path = project_path.join("next-story-system").join("project.json");

    let before_draft = fs::read(&draft_path).expect("read draft before");
    let before_main = fs::read(&main_path).expect("read main before");
    let before_metadata = fs::read(&metadata_path).expect("read metadata before");

    // 草稿为超过上限但仍是合法结构化 JSON 的本子
    let oversized_draft = valid_notebook_json(&"x".repeat(11 * 1024 * 1024));

    let result = save_existing_project(&project_path, oversized_draft, valid_notebook_json("正文"));

    assert!(matches!(result, Err(ProjectError::ContentTooLarge(_))));

    // 三个可见文件保持原有完整世代
    assert_eq!(
        fs::read(&draft_path).expect("read draft after"),
        before_draft
    );
    assert_eq!(fs::read(&main_path).expect("read main after"), before_main);
    assert_eq!(
        fs::read(&metadata_path).expect("read metadata after"),
        before_metadata
    );

    // 未创建事务暂存目录
    let tx_dir = project_path
        .join("next-story-system")
        .join("save-transaction");
    assert!(!tx_dir.exists(), "超限保存不应创建事务暂存目录");
}

#[test]
fn save_rejects_oversized_main_before_staging() {
    let temp = TempDir::new().expect("create temp dir");
    let project_path = create_new_project(CreateProjectParams {
        name: "超限正文".to_string(),
        save_location: temp.path().to_string_lossy().to_string(),
    })
    .expect("create project");

    let main_path = project_path.join("作品文本").join("正文本.json");
    let before_main = fs::read(&main_path).expect("read main before");

    let oversized_main = valid_notebook_json(&"x".repeat(11 * 1024 * 1024));

    let result = save_existing_project(&project_path, valid_notebook_json("草稿"), oversized_main);

    assert!(matches!(result, Err(ProjectError::ContentTooLarge(_))));
    assert_eq!(fs::read(&main_path).expect("read main after"), before_main);

    let tx_dir = project_path
        .join("next-story-system")
        .join("save-transaction");
    assert!(!tx_dir.exists(), "超限保存不应创建事务暂存目录");
}

#[test]
fn open_discards_staged_oversized_transaction() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("暂存超限");
    create_valid_project_folder(&root, "暂存超限");

    // 制造一个 Staged 阶段的中断事务，暂存草稿超限
    let tx_dir = root.join("next-story-system").join("save-transaction");
    fs::create_dir_all(&tx_dir).expect("create transaction dir");
    fs::write(
        tx_dir.join("manifest.json"),
        r#"{"manifest_version":1,"phase":"Staged","target_updated_at":"2026-07-25T00:00:00Z"}"#,
    )
    .expect("write manifest");
    fs::write(tx_dir.join("草稿本.json"), "x".repeat(11 * 1024 * 1024))
        .expect("write oversized staged draft");
    fs::write(tx_dir.join("正文本.json"), valid_notebook_json("暂存正文"))
        .expect("write staged main");
    fs::write(
        tx_dir.join("project.json"),
        r#"{"name":"暂存超限","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":2}"#,
    )
    .expect("write staged metadata");

    // 打开应成功：丢弃超限 Staged 事务并加载旧世代
    let opened = open_existing_project(&root).expect("open discards staged oversized transaction");

    assert!(!tx_dir.exists(), "Staged 超限事务目录应被丢弃");
    assert!(opened.draft_content.contains("草稿"));
    assert!(opened.main_content.contains("正文"));
}

#[test]
fn open_rejects_committing_oversized_transaction() {
    let temp = TempDir::new().expect("create temp dir");
    let root = temp.path().join("提交超限");
    create_valid_project_folder(&root, "提交超限");

    // 制造一个 Committing 阶段的中断事务，暂存草稿超限
    let tx_dir = root.join("next-story-system").join("save-transaction");
    fs::create_dir_all(&tx_dir).expect("create transaction dir");
    fs::write(
        tx_dir.join("manifest.json"),
        r#"{"manifest_version":1,"phase":"Committing","target_updated_at":"2026-07-25T00:00:00Z"}"#,
    )
    .expect("write manifest");
    fs::write(tx_dir.join("草稿本.json"), "x".repeat(11 * 1024 * 1024))
        .expect("write oversized staged draft");
    fs::write(tx_dir.join("正文本.json"), valid_notebook_json("暂存正文"))
        .expect("write staged main");
    fs::write(
        tx_dir.join("project.json"),
        r#"{"name":"提交超限","created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:00:00Z","version":2}"#,
    )
    .expect("write staged metadata");

    // 打开应返回专用 ContentTooLarge，而不是把作品永久卡死
    let result = open_existing_project(&root);
    assert!(matches!(result, Err(ProjectError::ContentTooLarge(_))));
}
