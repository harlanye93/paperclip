# 2026-09-29 开放型 agent 增加“自定义（OpenAI 兼容）”服务商

状态：第一期（Pi、OpenCode）已实现；第二期（Hermes）待评估。

## 1. 背景与原则

agent 分两类，处理方式不同：

| 类型 | 适配器 | 模型来源 | 是否加“自定义” |
| --- | --- | --- | --- |
| 订阅制 | `claude_local`、`codex_local`、`cursor`、`gemini_local`、`grok_local`、`kimi_local` | 厂商自己的账号/订阅 | 否，走各自的标准登录 |
| 开放型 | `pi_local`、`opencode_local`、`hermes_local` | 任意服务商，页面已有 OpenRouter/OpenAI/Groq… 下拉 | 是 |

Paperclip 通过 ACP/CLI 驱动这些 harness，只负责派任务、收结果；模型地址、Key、模型名是 harness
自己的配置。所以“自定义”只需在页面收集三项信息，按各 harness 的格式交给它，协议层不动。

“自定义”与 OpenRouter 等预设并列：预设 = 固定地址 + Key；自定义 = 用户自己填地址 + Key + 模型。
典型用途：LiteLLM、OneAPI、各类中转站、本地 Ollama / vLLM。

## 2. 范围

- 第一期（已完成）：`pi_local`、`opencode_local`。
- 第二期：`hermes_local`。Hermes 目前只认 `~/.hermes/config.yaml` 里的自定义端点，
  Paperclip 没有按 agent 注入的通道，需要新增“托管 HERMES_HOME + 生成 config.yaml”，单独评估。
- 不做：订阅制适配器；数据库结构变更。

## 3. 数据设计（实现时的调整）

原计划把地址写进环境变量里的 JSON（`PAPERCLIP_PI_PROVIDERS` 等）。实现时发现后台返回 agent 配置时
会把**所有环境变量打码**（安全设计），编辑页将无法显示/修改地址。因此改为：

| 信息 | 存放位置 | 是否可见 |
| --- | --- | --- |
| 接口地址、接口格式 | `adapterConfig.customProvider = { baseUrl, apiFormat }` | 可见，编辑页可改 |
| 模型 | `adapterConfig.model = "custom/<模型ID>"` | 可见 |
| API Key（可选） | `adapterConfig.env.CUSTOM_LLM_API_KEY`（机构加密密钥引用） | 打码 |

运行时由适配器在服务端把它们拼成 harness 的原生配置：

- Pi：托管 `models.json` 里的 `custom` 服务商（`api` 为 `openai-completions` / `anthropic-messages`；
  无 Key 时按 Pi 文档填占位值 `not-needed`）。
- OpenCode：运行时 `opencode.json` 里的 `custom` 服务商（`@ai-sdk/openai-compatible` / `@ai-sdk/anthropic`）。
- Key 以 `{env:CUSTOM_LLM_API_KEY}` 占位，由适配器在服务端展开，不落进任何可见配置。
- 与环境变量里同名的 `custom` 条目冲突时，以 `customProvider` 为准。

## 4. 交互

- Pi：“API key provider” 下拉最后一项 **Custom (OpenAI-compatible)**。
- OpenCode：新增 “Model access” 选择：Paperclip AI connection (OpenRouter) / Custom endpoint。
- 选中自定义后填写：Endpoint base URL（必填，http/https）、API format、Model ID（必填）、
  `CUSTOM_LLM_API_KEY`（可选，也可选已有机构密钥）。
- 选自定义时不绑定 AI 连接；服务端也会拒绝“自定义端点 + AI 连接”的组合（`ai_connection_incompatible`）。
- 编辑 agent 页：模型区显示 “Custom endpoint base URL / API format” 两项可改；换模型在 Model 字段填
  `custom/<id>`（Pi、OpenCode 都会自动把新模型登记到 custom 服务商）；Key 在环境变量里改。

## 5. 改动清单

- `packages/adapter-utils/src/custom-provider.ts`（新）：常量、地址校验、解析、两种 harness 条目构造；附测试。
- `packages/adapters/pi-local`：`runtime-config.ts` 接收 `customProvider`、自动登记所选模型；
  `execute.ts` 传入；`test.ts`（环境测试）改为也使用托管 `models.json`（之前测试不读自定义服务商）。
- `packages/adapters/opencode-local/src/server/runtime-config.ts`：接收 `customProvider`；
  “跳过权限”关闭时也照常注入自定义服务商（只是不写 `permission: allow`）。
- `server/src/services/ai-connection-runtime.ts`：自定义端点与 AI 连接互斥校验。
- `ui/src/components/new-agent/NewAgentSetup.tsx`：新建页入口与字段。
- `ui/src/components/CustomProviderFields.tsx`（新）+ Pi/OpenCode `config-fields.tsx`：编辑页字段。

## 6. 验证记录

- 单元/组件测试：adapter-utils、Pi、OpenCode runtime-config、NewAgent 页（新增 3 个用例）全部通过。
- `pnpm check:token-gates` 通过；相关包 typecheck 通过。
- 实测：用 `customProvider` 生成的 OpenCode 配置，真实 `opencode` 通过 LiteLLM（qwen3.8-max）回复 `hello`。
- 未实测：Pi（本机未安装 Pi CLI），由单元测试覆盖生成的 `models.json`。

## 7. 风险与后续

- 不同网关对 `/v1` 前缀、流式、工具调用的兼容度不一；“测试”按钮能提前暴露大部分问题。
- 一个 agent 只配一个自定义端点；多端点以后再扩展。
- 可选增强：“从接口拉取模型列表”按钮（需服务端代理 `GET {baseUrl}/models`）。
- Hermes 放第二期。
