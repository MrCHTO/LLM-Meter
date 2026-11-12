# LLM Meter

本机的大模型流量计量器。它在本机起一个 OpenAI / Anthropic 兼容入口，把客户端请求转发到真实上游，同时记录每个模型的 token 用量、首字延迟、每秒 token 产出、缓存命中率和折算成本，用主窗口和置顶悬浮窗实时显示。

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

1. 「模型与供应商」→ 添加供应商：填 Base URL、选 API 格式、填真实 Key。
2. 添加模型：上游模型名填上游真实名字，别名随便取（客户端里填这个）。
3. 「设置」里复制本地 token。
4. 客户端配置：

| 客户端字段 | 填什么 |
|---|---|
| Base URL | OpenAI 兼容：`http://127.0.0.1:8787/openai/v1`<br>Anthropic：`http://127.0.0.1:8787/anthropic` |
| API Key | 本地 token |
| model | 模型别名 |

端口被占用时应用会自动顺延到下一个可用端口，实际端口在设置页和标题栏都能看到。

## 指标口径

| 指标 | 公式 |
|---|---|
| 缓存命中率 | 缓存读 token ÷ 输入 token 总量（输入已含缓存部分） |
| tok/s | 输出 token ÷ 生成窗口秒数，生成窗口 = 总耗时 − 首字耗时 |
| TTFT | 首个内容帧（含推理通道）− 请求发出 |
| 成本 | (输入×单价 + 输出×单价 + 缓存读×单价 + 缓存写×单价) ÷ 1e6 |

单价按每百万 token 填。新增模型时点「查价」会按模型 id 去 OpenRouter 取公开价并回填，查不到或超时留着手填（可随时改）。非流式请求没有首字时间，tok/s 记空，界面标「仅总时长」。失败的请求计错误数、token 记 0，仍会落一条明细。

不同上游的缓存字段会被归一：OpenAI 的 `prompt_tokens_details.cached_tokens`、DeepSeek 的 `prompt_cache_hit_tokens`、Anthropic 的 `cache_read_input_tokens`。Anthropic 的 `input_tokens` 本身不含缓存，记录时会补成总量，保证命中率口径一致。

上游压根没报缓存时（不少中转会把 `prompt_tokens_details` 置空），命中率会是 0 或「—」，这反映的是上游行为，不是本应用的 bug。用「测速」可以判定某家到底有没有偷偷关缓存。

## 数据

| 文件 | 内容 | 保留 |
|---|---|---|
| `config.json` | 供应商、模型、设置、悬浮窗位置（Key 是 DPAPI 密文） | 永久 |
| `events/YYYY-MM-DD.jsonl` | 每请求一行明细 | 默认 30 天 |
| `rollup/YYYY-MM-DD.json` | 每分钟聚合 | 默认 365 天 |

单进程写、原子替换，损坏的配置文件会改名留证并回落到空配置，坏行跳过。没有数据库，所以不需要原生模块和 electron-rebuild。

## 悬浮窗

置顶、可拖到任意位置并记住位置（拔掉副屏会钳回主屏）、透明度可调、双击开主窗、右键出菜单。只显示勾了「在悬浮窗显示」的模型，只显示数字不含 prompt 内容。

关主窗只是收到托盘，代理和悬浮窗继续跑；真退出走托盘菜单或右键菜单。

## 测试

```bash
npm test                                                       # 单测：SSE 跨块分帧、usage 提取、成本、URL 拼接、配置容错
node test/e2e.mjs                                              # 假上游端到端，25 项
node test/ui-check.mjs                                         # CDP 驱动真实窗口 + 截图（test/shots）
node test/real-e2e.mjs <baseUrl> <key> <model>                  # 真实上游核对
node test/cache-probe.mjs <baseUrl> <key> <model> identity      # 判断某家缓存是否生效
```

## 已知边界

- 只监听 `127.0.0.1`，局域网其他机器连不上。
- 代理是常驻进程，关掉应用入口就断。
- 上游 300 秒未完成会超时中断并记 `timeout`。
- 请求体上限 64MB。
