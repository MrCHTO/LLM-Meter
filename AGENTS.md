# AGENTS.md

## 项目概述

LLM Meter 是 Windows 桌面端的大模型流量计量器：本机起 OpenAI / Anthropic 兼容代理，转发真实请求并记录 token、TTFT、tok/s、缓存命中率与人民币成本。技术栈：Electron 45 + React 18 + TypeScript，electron-vite 构建，`node:sqlite` 存库，配置为 DPAPI 加密的 `config.json`。应用入口 `src/main/index.ts`，代理前缀 `/openai/v1` 与 `/anthropic`。

## 目录结构

- `src/main/`：主进程。`proxy/`（转发与适配）、`probe/`（测速、探活、连通性）、`store/`（配置、实时指标、`db/` 与迁移）、`windows/overlay/`（主窗、胶囊与菜单、托盘）、`security/`（DPAPI、token、脱敏）、`settings/`（设置服务）、`ipc/`（按域拆分的通道注册）、`pricing/`（查价与汇率折算）、`export/`（CSV）、`dev/`（假数据）。
- `src/preload/index.ts`：contextBridge 暴露的 `window.api`，签名由 `src/shared/ipc/contract.ts` 约束。
- `src/renderer/`：React 页面与 `overlay.tsx` 胶囊页、`state/AppState.tsx` 应用状态、`components/models/` 表单、`lib/` 纯函数。
- `src/shared/`：`types/` 领域类型、`ipc/contract.ts` 通道契约、`limits.ts` 数值边界、`format.ts` 与 `date.ts`。
- `scripts/check/`：端到端与界面回归脚本；`scripts/make-icons.mjs`：图标生成。
- `test/`：vitest 用例（`*.test.ts`、`*.test.tsx`）；`resources/`：图标与安装脚本。

## 分层架构与依赖方向

主进程按「入口 → ipc/领域模块 → settings 与 store → security/paths」单向依赖：`index.ts` 只做装配与副作用订阅，`ipc/` 每个域只做参数转发，业务落在 `proxy`、`probe`、`store`、`pricing`。设置写入只有 `settings/service.ts` 一个入口，副作用由 `index.ts` 订阅执行；渲染层只经 `window.api` 访问主进程，不碰文件与网络；跨进程契约只能改 `shared/ipc/contract.ts` 与 `shared/types/`。

## 项目约定

- 常用命令：`npm run dev`、`npm run build`、`npm test`、`npm run lint`、`npm run typecheck`、`npm run dist`。
- 回归脚本一律用临时 `--user-data-dir` 与独立端口（`LLM_TEST_PORT` 可覆盖），不写真实档案；完整命令见 README「安装与启动」。
- 分支：开发在 `dev`，`main` 为稳定版；开发期不覆盖安装用户正在运行的实例，需用户确认后再 `taskkill` 并静默安装。
- 提交信息用 Conventional Commits（`feat:` / `fix:` / `refactor:` / `chore:` 等，中文描述），发版与版本同步用 `chore:`。
- 发版、CHANGELOG 与 README 版本同步按工作区规范 `../.github/instructions/common/版本发布与更新日志维护规范.instructions.md` 执行。
- 界面对齐与文案以用户点名的截图为准，文案按用户给定原文落地。

## 项目待办

| 时间 | 已知问题 | 解决方案 | 完成情况 |
| ---- | ---- | ---- | ---- |
| 2026-11-24 | `ui-check.mjs` 的测速用例依赖公司中继 `10.130.6.32:3001`，离线即跳过 | 改为脚本内置本地假上游 | 未开始 |
| 2026-11-24 | 仪表盘、分析、日志三页仍在 300 行以上，职责偏杂 | 按 Models 的做法继续拆表格与卡片组件 | 未开始 |
| 2026-11-24 | 项目内 `.github/instructions` 副本已删，规范只能引工作区根 | 后续如需要 TS 分层规范，放进工作区 `languages/typescript/` | 已完成 |
