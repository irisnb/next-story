use std::fs;

use next_story_lib::project::{
    create_new_project, open_existing_project, save_existing_project, validate_project_name,
    CreateProjectParams, ProjectError,
};
use tempfile::TempDir;

fn write_valid_project_metadata(project_root: &std::path::Path, name: &str) {
    let metadata = serde_json::json!({
        "name": name,
        "created_at": "2026-07-25T00:00:00Z",
        "updated_at": "2026-07-25T00:00:00Z",
        "version": 1
    });

    fs::write(
        project_root.join("next-story-system").join("project.json"),
        serde_json::to_string_pretty(&metadata).expect("serialize metadata"),
    )
    .expect("write metadata");
}

fn create_valid_project_folder(root: &std::path::Path, name: &str) {
    fs::create_dir_all(root.join("作品文本")).expect("create user text dir");
    fs::create_dir_all(root.join("next-story-system")).expect("create system dir");
    fs::write(root.join("作品文本").join("草稿本.txt"), "草稿").expect("write draft");
    fs::write(root.join("作品文本").join("正文本.txt"), "正文").expect("write main");
    write_valid_project_metadata(root, name);
}

#[cfg(unix)]
fn symlink_file(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(unix)]
fn symlink_dir(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink_file(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(windows)]
fn symlink_dir(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
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
    assert!(project_path.join("作品文本").join("草稿本.txt").is_file());
    assert!(project_path.join("作品文本").join("正文本.txt").is_file());
    assert!(project_path.join("next-story-system").is_dir());
    assert!(project_path
        .join("next-story-system")
        .join("project.json")
        .is_file());
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
    fs::write(broken_root.join("作品文本").join("正文本.txt"), "正文").expect("write main");
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

    let outside_draft = temp.path().join("outside-draft.txt");
    fs::write(&outside_draft, "外部草稿").expect("write outside draft");
    fs::remove_file(project_root.join("作品文本").join("草稿本.txt")).expect("remove normal draft");
    if let Err(error) = symlink_file(
        &outside_draft,
        &project_root.join("作品文本").join("草稿本.txt"),
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
        project_root.join("作品文本").join("草稿本.txt"),
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
        project_root.join("作品文本").join("正文本.txt"),
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

    save_existing_project(
        &project_path,
        "草稿第一行\n草稿第二行".to_string(),
        "正文第一行\n正文第二行".to_string(),
    )
    .expect("save both notebooks");

    let reopened = open_existing_project(&project_path).expect("reopen saved project");

    assert_eq!(reopened.metadata.name, "iris");
    assert_eq!(reopened.draft_content, "草稿第一行\n草稿第二行");
    assert_eq!(reopened.main_content, "正文第一行\n正文第二行");
}
