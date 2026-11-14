# root-dev-dependency-hygiene 规格（增量）

## ADDED Requirements

### Requirement: 纯传递依赖跨大版本警报的挂账纪律
root npm 树开发依赖的在册安全警报，当受影响包为**纯传递依赖**（root 无直接依赖条目）、修复版跨大版本且存在上游消费链尚未跟进（其最新版仍要求旧大版本）时，既有两条修复路径（范围内锁文件定向更新、直接依赖显式跨大版本提升）均不可用，SHALL 有据挂账：在长期账本登记包名、警报、上游跟进现状证据与复评触发条件。MUST NOT 为消警对根树引入 `overrides` 强制跨大版本，MUST NOT 锁定或移除上游包。上游发布要求修复版大版本的版本后，SHALL 随该上游的显式升级一并收敛，并复核警报消除。

#### Scenario: 上游未跟进时挂账
- **WHEN** 纯传递依赖（如 minimatch）的警报修复版在 11.x，而部分上游链（如 typescript-eslint 的 typescript-estree）最新版仍要求 `^10`
- **THEN** 账本登记该警报、各上游链跟进现状与复评条件；不引入 `overrides`、不硬锁版本、不批量 audit fix

#### Scenario: 上游跟进后随升级收敛
- **WHEN** 挂账警报的全部上游消费链均已发布要求修复版大版本的版本
- **THEN** 随上游显式升级一并更新锁文件，root `npm audit` 对应警报消除，全门禁复核通过
