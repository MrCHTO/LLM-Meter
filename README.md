# LLM Meter

## 项目概述

本机的大模型流量计量器：在本机起 OpenAI / Anthropic 兼容入口，把请求转发到真实上游，同时记录 token、首字延迟、tok/s、缓存命中率与人民币成本，提供仪表盘、分析、置顶悬浮胶囊与托盘常驻。

技术栈：Electron 45 + React 18 + TypeScript，electron-vite 构建，`node:sqlite` 存库，配置为 DPAPI 加密的 `config.json`。应用入口 `src/main/index.ts`，代理前缀 `/openai/v1` 与 `/anthropic`，默认端口 `8787`（被占用时自动顺延，实际端口在「接入」页可见）。

真实 API Key 只存在本应用里，客户端只拿本地 token；只有走代理的流量会被记录，网页版直连或未改 Base URL 的工具看不到。

当前版本 `1.0.0`，历史见 [CHANGELOG.md](CHANGELOG.md)。

## 目录结构

- `src/main/`：主进程。`proxy/`（转发与协议适配）、`probe/`（测速、自动探活、供应商连通性）、`store/`（配置、实时指标、`db/` 与迁移）、`windows/`（主窗、胶囊、托盘）、`security/`（DPAPI、token、日志脱敏）、`settings/`（设置服务）、`ipc/`（按域拆分的通道注册）、`pricing/`、`export/`、`dev/`。
- `src/preload/index.ts`：contextBridge 暴露的 `window.api`。
- `src/renderer/`：React 页面（仪表盘、分析、模型与供应商、接入、日志、悬浮窗、设置）、独立胶囊页 `overlay.tsx`、`state/` 应用状态、`components/models/` 表单、`lib/`。
- `src/shared/`：跨进程类型、IPC 契约（`ipc/contract.ts`）、边界表（`limits.ts`）、格式化与日期工具。
- `scripts/make-icons.mjs`：图标生成；`scripts/check/`：端到端、界面、安装版等回归脚本。
- `test/`：vitest 用例；`resources/`：图标与安装脚本。

## 环境要求

- Windows 10 及以上，x64。
- Node.js 24 与 npm 12。
- 打包需要写 `dist/` 的磁盘空间；已装 Electron 时打包不再联网下载。

## 安装与启动

```bash
npm ci            # 安装依赖
npm run dev       # 开发运行
npm run build     # 产出 out/
npm test          # 单元测试
npm run lint      # 静态检查
npm run typecheck # 类型检查
npm run dist      # 出 Windows 安装包（dist/）
```

界面与端到端核对用独立临时档案，不碰已安装实例与开发档案：

```bash
node scripts/check/e2e.mjs          # 假上游端到端
node scripts/check/ui-check.mjs     # CDP 驱动真实窗口并截图
node scripts/check/installed-check.mjs          # 安装版只读核对
node scripts/check/real-e2e.mjs <baseUrl> <key> <model>
node scripts/check/cache-probe.mjs <baseUrl> <key> <model> identity
```

## 配置说明

配置存放在数据目录的 `config.json`：供应商、模型、设置与悬浮窗位置，API Key 是 DPAPI 密文（`safeStorage` 不可用时为 `raw:` 前缀明文）。界面上的入口：

- 「模型与供应商」：供应商 Base URL、协议、真实 Key；模型上游名、别名与单价（每百万 token，人民币）。
- 「接入」：监听端口、局域网开关、本地 token 管理与复制。
- 「悬浮窗」：盯住的模型、显示内容、胶囊颜色与进行中效果、位置与透明度。
- 「设置」：主题、保留期、自动校准、开机自启、备份与打开数据目录。

数据目录：安装版为安装目录下 `data/`（默认 `C:\Program Files\llm meter\data`），开发与测试为 `%APPDATA%\llm-meter\data`；安装目录不可写时自动退回用户目录。数据库 `llm-meter.db` 为单文件 WAL，明细默认保留 30 天、分钟聚合 365 天，启动与每日 04:00 清理，备份用 `VACUUM INTO` 出一致性快照。

默认只监听 `127.0.0.1`，开启局域网后改绑 `0.0.0.0`（首次可能弹防火墙授权），凭据仍是本地 token。

## 部署说明

打包走 `electron-builder` 的 NSIS 目标：`npm run dist` 产出 `dist/LLM-Meter-<version>-setup.exe`，全机安装到 `C:\Program Files\llm meter`，卸载时保留 `data`。

- 版本一致性：`package.json` 的 `version` 是唯一来源，`app.getVersion()` 直接读取；发版须同步 `CHANGELOG.md` 顶部条目与 README 里出现的版本号。
- 升级前先让用户退出正在运行的实例，再静默安装，避免覆盖运行中的文件。
- 运行日志写入库表 `app_logs` 并由日志页展示，随明细保留期一起清理；`LLM_METER_DEBUG=1` 时额外把上游头（鉴权头已脱敏）、请求体与 usage 打到控制台，并把请求体写到 `%TEMP%\llmmeter-body.json`。
- 代理是常驻进程：关掉应用入口就断；上游 300 秒未完成会中断并记 `timeout`；请求体上限 64MB。
