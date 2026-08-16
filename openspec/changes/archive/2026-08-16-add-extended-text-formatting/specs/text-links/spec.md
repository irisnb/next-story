# text-links Specification

## ADDED Requirements

### Requirement: 链接作为带地址的字符标记创建与编辑
系统 SHALL 让用户选中文字后创建链接、编辑链接地址或移除链接，链接 MUST 作为带 `href` 的字符标记保存并可在重开后保持。创建或编辑链接 MUST 不改变选中文字的其它字符标记或段落属性。

#### Scenario: 创建链接
- **WHEN** 用户选中文字并创建链接并输入地址
- **THEN** 选中文字获得 `href` 链接标记
- **AND** 保存重开后链接标记与地址保持一致

#### Scenario: 编辑链接地址
- **WHEN** 光标位于已有链接内且用户编辑地址
- **THEN** 该链接的地址被更新
- **AND** 链接覆盖的文字不变

#### Scenario: 移除链接保留文字
- **WHEN** 用户移除一个链接
- **THEN** 链接标记被移除
- **AND** 原链接文字保持不变

### Requirement: 普通点击不导航，打开只走弹层且仅限 http/https
系统 MUST 让普通点击链接不直接跳转，只在链接弹层的「打开」动作上触发跳转，且 MUST 只允许 `http:` 或 `https:` 地址通过系统默认浏览器打开。光标或选区落在链接上时系统 SHALL 显示包含「打开 / 编辑 / 移除」的弹层。

#### Scenario: 点击链接不导航
- **WHEN** 用户在编辑器内普通点击一个链接
- **THEN** 系统不跳转
- **AND** 显示链接弹层

#### Scenario: 打开 http/https 链接
- **WHEN** 用户在链接弹层点击「打开」且地址为 `http:` 或 `https:`
- **THEN** 系统通过系统默认浏览器打开该地址

#### Scenario: 拒绝非 http/https 地址
- **WHEN** 链接地址不是 `http:` 或 `https:`
- **THEN** 系统不打开该地址
- **AND** 给出无法打开的中文提示
