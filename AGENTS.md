# AGENTS.md

## 项目概述

LLM Meter 是 Windows 桌面端的大模型流量计量器：本机起 OpenAI / Anthropic 兼容代理，转发真实请求并记录 token、TTFT、tok/s、缓存命中率与人民币成本，提供仪表盘、分析、置顶悬浮胶囊与托盘常驻。技术栈：Electron 45 + React 18 + TypeScript，electron-vite 构建，`node:sqlite` 存库，配置为 DPAPI 加密的 `config.json`。应用入口 `src/main/index.ts`，代理前缀 `/openai/v1` 与 `/anthropic`。

## 目录结构

- `src/main/`：主进程。`proxy/`（转发与鉴权）、`probe/`（手动测速与自动探活）、`store/`（配置、live 指标、`db/` 库与迁移）、`windows/`（主窗、胶囊、托盘）、`security/`（DPAPI、Ed25519 token）、`ipc.ts` 通道注册。
- `src/preload/`：contextBridge 暴露的 `window.api`。
- `src/renderer/`：React 页面（仪表盘、分析、模型与供应商、日志、设置）与独立胶囊页 `overlay.tsx`。
- `src/shared/types.ts`：跨进程类型与 IPC 通道常量。
- `test/`：vitest 单测、`e2e.mjs`、`ui-check.mjs`、`import-check.mjs`、`installed-check.mjs` 等验证脚本。
- `resources/`、`scripts/make-icons.mjs`：图标源与生成脚本。

## 分层架构与依赖方向

单进程主进程按「入口 → 领域模块 → 存储」单向依赖：`index.ts` 装配 `proxy`、`probe`、`ipc`、`windows`，领域模块只向下依赖 `store/` 与 `security/`，存储层不反向引用窗口或 IPC。渲染层只经 preload 的 `window.api` 访问主进程，不直接触碰文件与网络；共享类型集中在 `src/shared`。

## 项目约定

- 常用命令：`npm run dev`、`npm run build`、`npm test`、`npm run dist`；带界面的验证用 `node test/ui-check.mjs`，安装版核对 `node test/installed-check.mjs`。
- 测试一律使用临时 `--user-data-dir`，不写真实档案；安装版数据在安装目录 `data/`（默认 `C:\Program Files\llm meter\data`），开发运行在 `%APPDATA%\llm-meter\data`，只读排查按运行方式取 `llm-meter.db`。
- 分支：开发在 `dev`，`main` 为稳定版；开发期不覆盖安装用户正在运行的实例，需用户确认后再 `taskkill` 并静默安装。
- 提交信息用 Conventional Commits（`feat:` / `fix:` / `chore:` 等，中文描述），发版与版本同步用 `chore:`。
- 版本与发版流程、CHANGELOG 维护见 `.github/instructions/python-versioning.instructions.md`；版本号须同时更新 `package.json`、`CHANGELOG.md`、`README.md` 变更记录。
- 界面对齐与文案以用户点名的截图为准，文案按用户给定原文落地。

## 项目待办

- 收敛 `AGENTS.md` 与本仓库 `.github/instructions/` 的引用面，补充更多通用规范。
- 评估把 `ui-check` 中的中继依赖改为本地假上游，去掉网络波动影响。
- 自动探针的失败退避与费用提示待实机观察后调参。
