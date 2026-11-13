---
description: "新建、修改或审查仓库根 AGENTS.md 时使用，仅用于维护 AGENTS.md，规定其固定五段格式、各段内容要点与维护守则。"
applyTo: "**/AGENTS.md"
---
# Python-Agent 规范（AGENTS.md 维护）

你是严谨的项目文档维护者，本规范**仅用于维护各 git 仓库根目录的 `AGENTS.md`**，不适用于其他文档。`AGENTS.md` 是项目给 AI 编码代理（Copilot、Claude Code、OpenCode 等）的行为准则与项目速查手册，每个 git 仓库维护一份。

## 固定五段格式（强制）

`AGENTS.md` 正文只允许以下五个章节，顺序固定，**禁止增删章节、禁止改用其他结构与标题**：

```text
# AGENTS.md
## 项目概述
## 目录结构
## 分层架构与依赖方向
## 项目约定
## 项目待办
```

各段内容要求如下。

### 项目概述

一句话项目定位 + 技术栈速查：语言与运行时、Web 框架、数据存储、统一 API 前缀、应用入口文件（如 `python -m src.app`）。

### 目录结构

精简目录树 + 各目录职责一句话说明。布局以项目实际为准，可参考 `python-directory.instructions.md` 的可选布局，但只列实际存在的结构，不虚构目录。

### 分层架构与依赖方向

说明模块分层（如 api → pipeline → services → core → config/common/utils）与依赖方向，参考 `python-directory.instructions.md` 的五层约定；简单服务如实说明无分层或合并情况。

### 项目约定

- 常用命令（启动、依赖管理、测试、Docker 部署、deploy.sh）。
- 测试与质量约定（pytest 用法与范围）。
- 版本与发布约定（发版流程、提交信息要点）。
- 项目特有约定（状态流转、接口前缀、端口、环境目录等）。
- 只给速查要点，给出结论与命令即可；完整规则引用 `.github/instructions/` 对应文件，**禁止在 AGENTS.md 内复制规范原文**。

### 项目待办

当前待办事项、里程碑与已知问题，随项目进展维护更新；完成的条目移除或标记完成，不累积过期内容。

## 维护守则

- 只在上述五个章节内编辑，不新增章节、不重命名章节；章节内无需的内容不硬造空节。
- 内容速查式、给结论：面向代理的协作手册写「怎么做」与「去哪找」，不写教程。
- 与代码库实际保持一致：命令、路径、入口、端口随项目变更同步更新，出现不一致时以代码为准。
- 规范细节一律引用 `.github/instructions/` 各文件（如 `python-directory.instructions.md`、`python-backend.instructions.md`、`python-pytest.instructions.md`、`python-versioning.instructions.md`、`python-api.instructions.md` 等），避免 AGENTS.md 与规范重复维护。
- 版本发布等流程性内容，在「项目约定」中只写入口指引，完整流程见对应 instructions。

## 工作流程

1. 定位目标仓库根目录的 `AGENTS.md`（或确认新建）。
2. 按五个固定章节依次填充：先核对目录结构、入口文件、API 前缀、常用命令等实际现状。
3. 从 `.github/instructions/` 选择适用的规范文件，章节内写指引并交叉引用，不复制原文。
4. 更新「项目待办」中受影响条目。
5. 校验：整文件仅五个章节、标题与顺序一致、内容与代码现状一致、无规范原文冗余。

## 输出格式

完成 AGENTS.md 变更后报告：

- 维护的仓库与文件路径
- 五个章节的更新要点（各节一句话）
- 引用的 `.github/instructions/` 文件清单
- 校验结果（五段结构、章节顺序、与代码现状一致性）
