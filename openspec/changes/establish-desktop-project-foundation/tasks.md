## 1. Desktop App Foundation

- [ ] 1.1 Initialize a Tauri desktop application with TypeScript frontend support.
- [ ] 1.2 Configure development, build, and type-check scripts for the Tauri application.
- [ ] 1.3 Add a minimal application shell that starts to a welcome page.
- [ ] 1.4 Verify the desktop app launches on Windows in development mode.

## 2. Rust Core Project Lifecycle

- [ ] 2.1 Define Rust data structures for project metadata and project open results.
- [ ] 2.2 Implement project path creation for `作品文本/` and `next-story-system/`.
- [ ] 2.3 Implement new-project validation for empty names, illegal filesystem characters, inaccessible locations, and existing target folders.
- [ ] 2.4 Implement the create-project Tauri command that creates the project folder and initial files.
- [ ] 2.5 Implement project structure validation for opening existing project folders.
- [ ] 2.6 Implement the open-project Tauri command that reads metadata, 草稿本, and 正文本.
- [ ] 2.7 Implement the save-project Tauri command that writes both 草稿本 and 正文本 in one user-triggered save operation.

## 3. Frontend Project Flow

- [ ] 3.1 Build the welcome page with only 新建作品 and 打开作品 entry points.
- [ ] 3.2 Build the new-project form for 作品名 and 保存位置.
- [ ] 3.3 Wire 新建作品 to the Rust create-project command and show validation errors without overwriting existing folders.
- [ ] 3.4 Wire 打开作品 to folder selection and the Rust open-project command.
- [ ] 3.5 Route successful create/open results into the editor view.

## 4. Writing Notebook Editor

- [ ] 4.1 Build the editor view with 草稿本 and 正文本 tabs.
- [ ] 4.2 Default the editor to 草稿本 after project creation or opening.
- [ ] 4.3 Load 草稿本.txt and 正文本.txt content into separate editable text areas.
- [ ] 4.4 Implement tab switching without losing unsaved in-memory edits.
- [ ] 4.5 Implement manual save so one save action writes both notebooks.
- [ ] 4.6 Display minimal save status: 已保存, 有未保存更改, 正在保存, 保存失败.

## 5. Verification

- [ ] 5.1 Add automated coverage for Rust project creation and structure validation, including Chinese folder and file names.
- [ ] 5.2 Add automated coverage for save and reopen preserving 草稿本 and 正文本 content.
- [ ] 5.3 Run type checks, Rust tests, and application build successfully.
- [ ] 5.4 Manually verify the first-version loop: launch app -> create project -> write both notebooks -> save -> close/reopen -> content remains.
