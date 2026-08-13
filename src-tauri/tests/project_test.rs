use std::fs;
use std::path::Path;

use next_story_lib::project::{
    create_new_project, open_existing_project, save_existing_project, validate_project_name,
    CreateProjectParams, ProjectError,
};
use tempfile::TempDir;

/// 生成一段合法格式版本 1 的本子 JSON 字符串（单个正文段落）。
fn valid_notebook_json(text: &str) -> String {
    let value = serde_json::json!({
        "format": "next-story-tiptap",
        "version": 1,
        "document": {
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": text }] }
            ]
        }
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
    fs::write(project_root.join("next-story-system").join("project.json"), json)
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

    let draft = fs::read_to_string(project_path.join("作品文本").join("草稿本.json"))
        .expect("read draft");
    let main = fs::read_to_string(project_path.join("作品文本").join("正文本.json"))
        .expect("read main");

    for content in [draft, main] {
        let value: serde_json::Value = serde_json::from_str(&content).expect("parse notebook");
        assert_eq!(value["format"], "next-story-tiptap");
        assert_eq!(value["version"], 1);
        assert_eq!(value["document"]["type"], "doc");
        assert_eq!(
            value["document"]["content"][0]["type"],
            "paragraph"
        );
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
    fs::remove_file(project_root.join("作品文本").join("草稿本.json")).expect("remove normal draft");
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

fn reject_with_version_error(result: Result<next_story_lib::project::ProjectOpenResult, ProjectError>) {
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
    fs::write(tx_dir.join("manifest.json"), r#"{"manifest_version":1,"phase":"Committing","target_updated_at":"2026-07-25T00:00:00Z"}"#)
        .expect("write manifest");
    fs::write(tx_dir.join("草稿本.json"), valid_notebook_json("暂存草稿")).expect("write staged draft");
    fs::write(tx_dir.join("正文本.json"), valid_notebook_json("暂存正文")).expect("write staged main");
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
