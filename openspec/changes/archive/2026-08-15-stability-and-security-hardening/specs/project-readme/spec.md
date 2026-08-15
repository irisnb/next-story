## MODIFIED Requirements

### Requirement: README explains where each kind of data lives
项目 README SHALL 区分用户文本、项目系统元数据和应用级 LLM 配置，并 SHALL 准确说明三者的位置与分离关系。

#### Scenario: Reader locates user text and project metadata
- **WHEN** 读者查看作品文件的数据说明
- **THEN** README 将用户文本定位到作品文件夹内的 `作品文本/草稿本.json` 与 `作品文本/正文本.json`
- **AND** README 将项目系统元数据定位到同一作品文件夹内的 `next-story-system/project.json`
- **AND** README 说明项目元数据不包含两个本子的正文内容

#### Scenario: Reader locates LLM configuration
- **WHEN** 读者查看 LLM 配置的数据说明
- **THEN** README 将唯一应用级 LLM 配置定位到 Tauri 的应用本地数据目录中的 `llm-config.json`
- **AND** README 不虚构跨操作系统通用的绝对路径
- **AND** README 说明 LLM 配置不写入草稿本、正文本或项目元信息正文内容
