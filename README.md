# LLM Meter

本机的大模型流量计量器。它在本机起一个 OpenAI / Anthropic 格式的入口，把客户端请求转发到真实上游，同时记录每个模型的 token 用量、首字延迟、每秒 token 产出、缓存命中率和折算成本，用主窗口和置顶悬浮窗实时显示，并能在「分析」页按区间查历史流量、按模型或供应商出图、导出 CSV。

真实 API Key 只存在本应用里（Windows DPAPI 加密），客户端只拿本地 token，所以换中转站或换 key 时所有客户端一处都不用改。

## 两条数据来源

| 来源 | 说明 |
|---|---|
| 代理 | 客户端把 Base URL 指过来，真实请求被转发并逐条记录真实 usage |
| 测速 | 手动点「测速」，用同一段长前缀连发两次，第二次的缓存读取量就是缓存有没有生效的答案 |

只有走代理的流量会被记录。网页版直连、或没改 Base URL 的工具，这里看不到。

## 快速开始

```bash
npm install          # 或 pnpm install
npm run dev          # 开发
npm run build        # 产出 out/
npm run dist         # 出 Windows 安装包（dist/）
npm test             # 单元测试
```

数据目录固定在 `%APPDATA%\llm-meter\data`，设置页有「打开目录」。

## 接入客户端

1. 「模型与供应商」→ 添加供应商：填 Base URL、选协议、填真实 Key。
2. 添加模型：上游模型名填上游真实名字，别名随便取（客户端里填这个）。
3. 「设置」里复制本地 token（形如 `sk-` + 32 位十六进制；重签后旧值立即失效，旧的签名票据仍可继续用）。
4. 客户端配置：

| 客户端字段 | 填什么 |
|---|---|
| Base URL | OpenAI：`http://127.0.0.1:8787/openai/v1`<br>Anthropic：`http://127.0.0.1:8787/anthropic` |
| API Key | 本地 token |
| model | 模型别名 |

端口被占用时应用会自动顺延到下一个可用端口，实际端口在设置页和标题栏都能看到。

## 指标口径

| 指标 | 公式 |
|---|---|
| 缓存命中率 | 缓存读 token ÷ 输入 token 总量（输入已含缓存部分） |
| tok/s | 请求进行中按 1 秒窗口显示；结束后显示该请求的生成速率（灰色），5 分钟后隐藏；表格列固定显示最近一次请求的生成速率；历史区间的 tok/s = 输出 token ÷ 生成窗口秒数 |
| TTFT | 首个内容帧（含推理通道）− 请求发出；表格里给 P50 / P95 / P99，按今天的代理流量逐条算分位数（探针不计入） |
| 成本 | (未命中输入×输入单价 + 输出×输出单价 + 缓存读×缓存读单价 + 缓存写×缓存写单价) ÷ 1e6，一律人民币；未命中输入 = 输入总量 − 缓存读 − 缓存写，缓存部分不按原价重复计费 |

单价按每百万 token、以人民币填。新增模型时点「查价」会按模型名先取 models.dev 的厂商官方价，取不到再退回 OpenRouter 最低服务商价，按当天汇率折成人民币回填，查不到或超时留着手填。非流式请求没有首字时间，tok/s 记空，界面标「仅总时长」。失败的请求计错误数、token 记 0，仍会落一条明细。

不同上游的缓存字段会被归一：OpenAI 的 `prompt_tokens_details.cached_tokens`、DeepSeek 的 `prompt_cache_hit_tokens`、Anthropic 的 `cache_read_input_tokens`。Anthropic 的 `input_tokens` 本身不含缓存，记录时会补成总量，保证命中率口径一致。

上游压根没报缓存时（不少中转会把 `prompt_tokens_details` 置空），命中率会是 0 或「—」，这反映的是上游行为，不是本应用的 bug。用「测速」可以判定某家到底有没有偷偷关缓存。

## 分析

「分析」页把库里的流量按时间（今天 / 近 24 小时 / 近 7 天 / 自定义）、指标（请求数、总 token、输入 token、输出 token、成本）、分组（模型 / 供应商）做成多序列时间轴分组柱状图与分组合计，固定统计真实流量；0 值不画柱。TTFT 给 P50 / P95 / P99（按明细逐样本算分位数）。Top 10 按成本取，导出 CSV 带 BOM，Excel 直接能开。自动刷新是静默的，不会让按钮闪「查询中」。

大区间默认走分钟或小时聚合，只有导出和 Top N 碰明细表。

## 数据

单个 SQLite 库 `llm-meter.db`（WAL；驱动是 Electron 内置的 `node:sqlite`，不需要原生模块和 electron-rebuild）：

| 表/文件 | 内容 | 保留 |
|---|---|---|
| `config.json` | 供应商、模型、设置、悬浮窗位置（Key 是 DPAPI 密文） | 永久 |
| `requests` | 每请求一行：tokens、TTFT、耗时、成本，附供应商名/地址/上游模型名与当时单价快照 | 默认 30 天 |
| `rollup_minute` | 每分钟 × 模型 × 来源聚合 | 默认 365 天 |
| `rollup_day` | 每日 × 模型 × 来源聚合 | 永久 |

历史行冗余存供应商名、Base URL、上游模型名，删掉供应商或模型后历史仍可查。明细与两级聚合在同一个事务里写，不会出现「明细有、聚合缺」。

启动时和每天 04:00 各清理一次过期行，随后 `PRAGMA incremental_vacuum`；清理量可在设置页手动触发。备份用 `VACUUM INTO` 出一致性快照，配置与库一并放进 `backups/`。

从旧版升级时，首次启动会把 `events/*.jsonl` 与 `rollup/*.json` 分批事务导入，按明细 id 幂等（重复跑不叠加），原目录改名到 `data/legacy-imported/<时间戳>/` 留底。损坏的配置文件会改名留证并回落到空配置，坏行跳过。

`node:sqlite` 在 Electron 45（Node 22）下已验证能建库、能 WAL 读写，探针留在 `test/sqlite-probe.cjs`。

## 悬浮窗

置顶、可拖到任意位置并记住位置（拔掉副屏会钳回主屏）、双击开主窗。右键菜单只在未锁定时给 选中模型、锁定位置、黑/白外观，锁定后只剩「解锁位置」；透明度只在主窗口设置里输数值（10–100，默认 100）。只显示勾了「在悬浮窗显示」的模型，只显示数字不含 prompt 内容。

关主窗只是收到托盘，代理和悬浮窗继续跑；托盘菜单可打开主窗、隐藏/显示悬浮窗、开启/关闭局域网、重启代理或退出。

## 测试

```bash
npm test                                                       # 单测：SSE 跨块分帧、usage 提取、成本、URL 拼接、配置容错、库写入与清理
node test/e2e.mjs                                              # 假上游端到端，28 项（含库断言与 token 迁移）
node test/ui-check.mjs                                         # CDP 驱动真实窗口 + 截图（test/shots），85 项
node test/import-check.mjs <exe> <含 events/rollup 的备份目录>   # 打包产物的旧数据导入回归
node test/installed-check.mjs                                   # 安装版实机核对（真实档案，会触发旧数据导入）
node test/real-e2e.mjs <baseUrl> <key> <model>                  # 真实上游核对
node test/cache-probe.mjs <baseUrl> <key> <model> identity      # 判断某家缓存是否生效
```

## 已知边界

- 默认只监听 `127.0.0.1`；打开设置里的「允许局域网访问」后改绑 `0.0.0.0`，同网段可用局域网地址访问，凭据仍是本地 token（首次绑定可能弹防火墙授权）。
- 代理是常驻进程，关掉应用入口就断。
- 上游 300 秒未完成会超时中断并记 `timeout`。
- 请求体上限 64MB。
- 测速不发 temperature（个别模型只接受固定值），遇 429 会按 Retry-After 退避重试两次；仍失败多为账号 TPM/RPM 用满，隔一分钟再测。

## 变更记录

当前版本 **v0.5.0**。完整版本历史见 [CHANGELOG.md](CHANGELOG.md)。
