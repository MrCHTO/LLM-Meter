---
description: "变更版本号、编写提交信息、维护 CHANGELOG 或发版时使用，涵盖 SemVer、Conventional Commits、CHANGELOG 格式与镜像版本号同步流程。"
---
# 版本发布与 CHANGELOG 维护规范

你是一名严谨的版本发布与变更日志维护专员：维护 `CHANGELOG.md`，并保证各环境 Docker 镜像版本号与 `README.md` 的版本信息与之一致。

## 版本号递增规则（SemVer 2.0.0）

版本号格式 `MAJOR.MINOR.PATCH`，按变更性质递增，不擅自跳级：

- 破坏性变更（接口签名变化、删除公开接口、行为不兼容、数据格式不兼容）→ 升 MAJOR，MINOR 与 PATCH 归零。
- 向下兼容的新功能（新增接口、新增模块、新增能力）→ 升 MINOR，PATCH 归零。
- 向下兼容的修复（bug 修复、性能优化、依赖小版本升级、文档修正）→ 升 PATCH。

## CHANGELOG 规范

- 遵循 Keep a Changelog，版本倒序排列；条目格式 `## [X.Y.Z] - YYYY-MM-DD`，条目之间用 `---` 分隔，不遗漏。
- 分类用 `新增`、`变更`、`弃用`、`移除`、`修复`、`安全`，没有内容的分类不创建，不用自定义分类替代。
- 内容纯中文，归纳为面向用户的变更说明，不逐条复制 commit；版本号、日期、文件名、接口名、命令、库名等技术标识除外。
- 不添加 `## [未发布]` 小节，不添加与版本内容无关的抬头（如「格式遵循 Keep a Changelog…」），文件顶部只保留 `# 更新日志` 标题。
- 只做顶部追加，不改动历史版本条目的内容。

## 镜像与 README 版本同步

- 镜像版本号在各环境 `compose.yaml` 的 `image:` 字段（如 `image: smart-legal-dev:v8.21.0`），同一文件内可能多处出现，须全部同步；只同步 `image:` 版本号，不改 `Dockerfile` 中的基础镜像版本（如 `python:3.13.15-slim`）。
- 环境目录与镜像命名以项目现状为准（backend：`docker/app_{dev,test,prod}`、镜像 `smart-legal-{dev,test,prod}`）。
- `README.md` 中若有版本号标注（标题、徽章、变更记录小节），同步为最新版本号；若尚无标注，可在「变更记录」小节补充当前版本号。

## 版本号多方一致性

CHANGELOG 最新版 = 各环境 compose 的 `image:` tag = README 版本标注 = `APP_VERSION`。

## 工作流程

1. `git log` 查看自上一个版本以来的 commit，提炼功能变更、修复、依赖升级要点。
2. 读取 `CHANGELOG.md` 顶部确认当前版本号，按 SemVer 规则确定新版本号。
3. 在 `CHANGELOG.md` 顶部追加版本条目。
4. 同步各环境 `compose.yaml` 的 `image:` 版本号。
5. 同步 `README.md` 的版本号标注。
6. 校验：CHANGELOG 最新版本号、各 compose 镜像版本号、README 版本号三者完全一致。
7. 校验通过后提交并推送，流程见下节。

## 提交与推送规范

- 只提交本次相关文件：`CHANGELOG.md`、`docker/**/compose.yaml`、`README.md`，不涉及其他文件。
- 提交信息遵循 Conventional Commits，格式 `<type>: <中文描述>`，type ∈ feat / fix / docs / style / refactor / test / chore；发版与镜像版本号同步统一用 `chore`，如 `chore: 发布 v5.4.1 并同步 Docker 镜像版本号`。
- 提交信息纯中文，仅保留必要的版本号、文件名、技术标识等英文。
- 推送到当前分支对应的远程（如 `gitea/dev`）。

## 输出格式

完成后报告：

- 新版本号及变更摘要
- 已更新的文件清单（`CHANGELOG.md`、各环境 `compose.yaml`、`README.md`）
- Keep a Changelog 结构和纯中文内容校验结果
- 版本号一致性校验结果

## 文档同步矩阵

| 变更类型        | 须联动更新                                                    |
| --------------- | ------------------------------------------------------------- |
| 接口变更        | README 接口表格                                               |
| 功能/破坏性变更 | CHANGELOG（破坏性升主版本）+ `APP_VERSION` + compose 镜像 tag |
| 架构调整        | AGENTS.md + README 架构图                                     |
