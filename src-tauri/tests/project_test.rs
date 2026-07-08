use std::fs;

use next_story_lib::project::{
    create_new_project, open_existing_project, save_existing_project, validate_project_name,
    CreateProjectParams, ProjectError,
};
use tempfile::TempDir;

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

    assert!(matches!(validate_project_name("   "), Err(ProjectError::EmptyName)));
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
