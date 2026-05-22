# CherryAPI

[中文说明](#中文说明) | [English](#english)

CherryAPI is a local-first OpenAI-compatible API gateway and admin console for managing upstream AI provider accounts, model discovery, group-based routing, API keys, quotas, and request usage.

CherryAPI 是一个本地优先的 OpenAI 兼容 API 网关与管理控制台，用于统一管理上游 AI 服务账号、模型发现、按用户组分配路由、API Key、额度和调用记录。

---

## 中文说明

### 项目简介

CherryAPI 的目标是把多个上游账号和模型能力收拢成一个本地可控的 OpenAI 兼容入口。你可以在管理控制台中接入账号、同步可用模型、把公开模型名绑定到具体账号和上游模型，再为不同用户组签发独立 API Key。客户端只需要访问 CherryAPI 的 `/v1` 接口，不需要知道背后实际使用的是哪个账号或平台。

默认工作流面向本地管理员和自托管部署：数据保存在本地 SQLite 文件中，管理接口由 `ADMIN_TOKEN` 保护，上游凭据会使用 `ENCRYPTION_KEY` 加密后落库。

在线演示：[Bilibili - CherryAPI demo](https://www.bilibili.com/video/BV1c1Gb6EEaL/)
搭建自己的号池（可以在这里挑选账号按需购买噢~https://pay.ldxp.cn/shop/G09AC5SS）
（本项目不对账号来源负责，不过也是有客服的~）
### 核心能力

- OpenAI 兼容客户端接口：`GET /v1/models` 和 `POST /v1/chat/completions`。
- 支持非流式和流式 Chat Completions。
- Fastify + TypeScript 后端，React + Vite + Tailwind 管理控制台。
- 本地 SQLite 数据库，Drizzle ORM 表结构与启动时自动建表/补列。
- 上游 Channel、Account、模型能力、用户组、模型绑定、API Key 和调用日志管理。
- 按 Group 暴露模型：同一个上游模型可以用不同公开模型名对外提供。
- 按账号维度记录健康状态、并发计数、冷却状态、额度使用和最近错误。
- 支持账号模型同步：先从上游模型列表读取模型，再用真实请求测试模型可用性。
- 支持失败重试：某个绑定账号失败后，会尝试同一公开模型下仍可用的其他绑定账号。
- 支持全局或账号级代理配置，提供常见本地代理端口探测。
- Docker 单容器部署：后端同源托管构建后的前端资源。

### 当前支持状态

| 平台 | 状态 | 接入方式 | 说明 |
| --- | --- | --- | --- |
| Codex | Available | OAuth Login、OAuth JSON、Access Token | 支持模型检测和额度检查；OAuth 回调默认使用 `1455` 端口。 |
| GitHub Copilot | Available | GitHub OAuth、GitHub Access Token、Copilot Credential JSON、Local VS Code Import | 支持模型检测和额度检查。 |
| OpenAI API | Available | API Key | 使用 OpenAI 官方 API Key，默认 base URL 为 `https://api.openai.com/v1`。 |
| Claude API | Available | API Key | 使用 Anthropic API Key，后端会在 OpenAI Chat Completions 与 Anthropic Messages 之间转换。 |
| OpenAI-compatible | Available | API Key | 适用于 DeepSeek、OpenRouter、SiliconFlow、RightCode、本地 NewAPI/OneAPI 或其他兼容 `/v1` 的服务。 |
| Antigravity、Zed、Windsurf、Kiro、Cursor、Gemini CLI、CodeBuddy、Qoder、Trae | Planned / Partial | 暂未提供完整可用接入流 | 前端平台定义和部分通道/适配器骨架已存在，完整登录和同步流程仍是后续工作。 |

### 架构与目录

```text
CherryAPI
├─ apps/server        Fastify API server, adapters, routing, SQLite schema, tests
├─ apps/web           React admin console, Vite dev server, Tailwind styles
├─ packages/shared    Shared TypeScript types, schemas, platform definitions
├─ data               Local SQLite database files
├─ Dockerfile         Production container build
└─ docker-compose.yml Self-hosted single-service deployment
```

核心运行链路：

1. 客户端携带 CherryAPI API Key 调用 `/v1/chat/completions`。
2. 后端根据 API Key 找到绑定的 Group。
3. Route Resolver 在该 Group 的 Model Bindings 中查找请求的公开模型名。
4. Account Scheduler 选择健康、可用、符合标签/账号规则的上游账号。
5. 对应 Provider Adapter 把 OpenAI 请求转换为上游请求并发送。
6. 响应被转换回 OpenAI 兼容格式，同时写入 usage log 并更新额度/健康状态。

### 环境要求

- Node.js `>=20`
- pnpm `>=11`
- Git
- 可选：Docker Desktop 或 Docker Engine
- 可选：`curl`，用于命令行接口检查

### 环境变量

先从根目录复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

重要变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 运行模式。 |
| `PORT` | `3000` | Fastify 后端监听端口。 |
| `DATABASE_URL` | `file:./data/cherryapi.sqlite` | SQLite 数据库地址；相对路径按后端进程工作目录解析。 |
| `ADMIN_TOKEN` | `change-me` | 所有 `/admin` 管理接口的 Bearer Token。部署前必须修改。 |
| `VITE_ADMIN_TOKEN` | `change-me` | 管理控制台使用的 token。本地开发时通常与 `ADMIN_TOKEN` 保持一致。 |
| `VITE_API_TARGET` | `http://localhost:3000` | Vite 开发服务器代理到的后端地址。Docker 构建中可为空以使用同源请求。 |
| `WEB_DIST_DIR` | 未设置 | 可选，后端静态托管前端构建产物的目录。Docker 中为 `/app/apps/web/dist`。 |
| `ENCRYPTION_KEY` | `change-me-32-bytes-minimum` | 加密上游账号凭据的密钥。创建账号后不要更改，否则旧凭据无法解密。 |
| `LOG_LEVEL` | `info` | Fastify/Pino 日志级别：`silent`、`fatal`、`error`、`warn`、`info`、`debug`、`trace`。 |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | 未设置 | 可选出站代理。Docker 中访问宿主机代理请使用 `host.docker.internal`。 |
| `GITHUB_API_VERSION` | 未设置 | 可选，GitHub Copilot 相关请求使用的 GitHub API version。 |
| `CODEX_CALLBACK_HOST` | 本地通常 `127.0.0.1` | Codex OAuth 回调监听 host。Docker Compose 设置为 `0.0.0.0`。 |
| `CHERRYAPI_PORT` | `3000` | Docker Compose 发布到宿主机的服务端口。 |
| `CHERRYAPI_CODEX_CALLBACK_PORT` | `1455` | Docker Compose 发布到宿主机的 Codex OAuth 回调端口。 |

### 使用 Docker 启动

```bash
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_TOKEN 和 ENCRYPTION_KEY
docker compose up --build -d
```

打开：

- 管理控制台和后端：`http://localhost:3000`
- OpenAI 兼容 base URL：`http://localhost:3000/v1`
- 健康检查：`http://localhost:3000/health`

持久化数据会挂载在宿主机的 `./data` 目录，默认数据库文件为 `./data/cherryapi.sqlite`。

Docker 网络注意事项：

- 容器访问宿主机代理时，使用 `http://host.docker.internal:7890`，不要使用 `127.0.0.1`。
- 容器访问宿主机上的 OpenAI-compatible 服务时，Channel 的 `base_url` 可写成 `http://host.docker.internal:PORT/v1`。
- Compose 默认发布 `1455` 端口，用于 Codex OAuth 回调。
- Docker 构建时会把 `ADMIN_TOKEN` 注入前端构建为 `VITE_ADMIN_TOKEN`；修改 token 后建议重新构建容器。

### 本地开发启动

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

Linux / macOS：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

打开：

- 管理控制台：`http://localhost:5173`
- 后端服务：`http://localhost:3000`
- OpenAI 兼容 base URL：`http://localhost:3000/v1`

`pnpm dev` 会并行启动：

- `@cherryapi/server`：`tsx watch src/main.ts`
- `@cherryapi/web`：`vite --host 0.0.0.0 --port 5173`

### 从源码构建并运行

```bash
pnpm install
pnpm build
pnpm --filter @cherryapi/server start
```

构建后，后端会尝试自动查找 `apps/web/dist` 或 `../web/dist` 并托管前端资源。如果需要显式指定，可以设置：

```bash
WEB_DIST_DIR=../web/dist pnpm --filter @cherryapi/server start
```

Windows PowerShell：

```powershell
$env:WEB_DIST_DIR="../web/dist"
pnpm --filter @cherryapi/server start
```

### 首次配置流程

推荐从管理控制台完成配置：

1. 打开 `Dashboard`，确认健康状态、账号状态、路由状态和最近错误。
2. 打开 `Accounts`，选择平台并创建或复用对应 Channel。
3. 按平台选择登录/导入方式，例如 OAuth、API Key、JSON Import 或 Local Import。
4. 保存账号后执行 `Sync Models`，让系统读取上游模型并测试可用性。
5. 打开 `Groups`，在 `Model Bindings` 中把公开模型名绑定到具体账号和上游模型。
6. 打开 `API Keys`，为目标 Group 创建 API Key。新 key 只会在创建时完整显示一次。
7. 打开 `Test Console`，使用刚创建的 API Key 发送非流式或流式请求。
8. 打开 `Usage` 和 `Dashboard`，检查调用日志、错误、延迟和额度消耗。

注意：实际请求路由依赖 `Groups -> Model Bindings`。高级页面 `Models` 和 `Routes` 保留用于兼容级模型/路由元数据管理，但新配置优先使用 Group Model Bindings。

### OpenAI 兼容客户端接口

所有客户端请求都使用 CherryAPI 生成的 API Key：

```text
Authorization: Bearer sk-cherry-...
```

列出当前 API Key 所属 Group 可见的模型：

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-cherry-xxx"
```

发送 Chat Completions 请求：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-cherry-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      { "role": "user", "content": "hello, run a short gateway test" }
    ]
  }'
```

流式请求：

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-cherry-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "stream": true,
    "messages": [
      { "role": "user", "content": "stream test" }
    ]
  }'
```

### 管理 API

所有 `/admin` 请求都需要：

```text
Authorization: Bearer $ADMIN_TOKEN
```

主要管理接口：

| 模块 | 接口 |
| --- | --- |
| Health / Dashboard | `GET /health`, `GET /admin/health`, `GET /admin/dashboard/stats`, `GET /admin/dashboard/channel-health` |
| Platforms | `GET /admin/platforms`, `GET /admin/platforms/summary`, `GET /admin/platforms/:platformId`, `GET /admin/platforms/:platformId/accounts`, `POST /admin/platforms/:platformId/accounts`, `GET /admin/platforms/:platformId/channels` |
| Channels | `GET /admin/channels`, `POST /admin/channels`, `GET /admin/channels/:id`, `PATCH /admin/channels/:id`, `DELETE /admin/channels/:id` |
| Accounts | `GET /admin/accounts`, `POST /admin/accounts`, `GET /admin/accounts/:id`, `PATCH /admin/accounts/:id`, `DELETE /admin/accounts/:id`, `PATCH /admin/accounts/:id/enable`, `PATCH /admin/accounts/:id/disable`, `PATCH /admin/accounts/:id/clear-error`, `PATCH /admin/accounts/:id/reset-concurrency`, `POST /admin/accounts/:id/check-quota` |
| Account Model Aliases | `GET /admin/accounts/:id/model-aliases`, `POST /admin/accounts/:id/model-aliases`, `PUT /admin/accounts/:id/model-aliases/:aliasId`, `DELETE /admin/accounts/:id/model-aliases/:aliasId` |
| Model Detection | `GET /admin/account-model-capabilities`, `GET /admin/accounts/:id/model-capabilities`, `POST /admin/accounts/:id/list-models`, `POST /admin/accounts/:id/detect-models`, `POST /admin/accounts/:id/test-models`, `GET /admin/accounts/:id/detect-models/progress/:requestId`, `POST /admin/accounts/:id/model-capabilities`, `PATCH /admin/account-model-capabilities/:id`, `POST /admin/account-model-capabilities/:id/create-model-route`, `DELETE /admin/account-model-capabilities/:id` |
| Models / Routes | `GET /admin/models`, `POST /admin/models`, `GET /admin/models/:id`, `PATCH /admin/models/:id`, `DELETE /admin/models/:id`, `GET /admin/model-routes`, `POST /admin/model-routes`, `PATCH /admin/model-routes/:id`, `DELETE /admin/model-routes/:id` |
| Groups | `GET /admin/groups`, `POST /admin/groups`, `PATCH /admin/groups/:id`, `DELETE /admin/groups/:id`, `GET /admin/groups/:id/effective-models`, `GET /admin/groups/:id/model-candidates`, `GET /admin/groups/:id/model-bindings`, `PUT /admin/groups/:id/model-bindings` |
| Group Permissions | `GET /admin/groups/:id/model-permissions`, `PUT /admin/groups/:id/model-permissions`, `GET /admin/groups/:id/channel-permissions`, `PUT /admin/groups/:id/channel-permissions`, `GET /admin/groups/:id/account-rules`, `PUT /admin/groups/:id/account-rules` |
| API Keys | `GET /admin/api-keys`, `POST /admin/api-keys`, `PATCH /admin/api-keys/:id`, `DELETE /admin/api-keys/:id` |
| Proxy | `GET /admin/proxy/config`, `PUT /admin/proxy/config`, `POST /admin/proxy/detect` |
| Test Console | `POST /admin/test/chat-completion` |
| Usage | `GET /admin/usage-logs` |
| Codex OAuth | `POST /admin/codex/oauth/start`, `GET /admin/codex/oauth/status/:sessionId`, `POST /admin/codex/oauth/complete`, `POST /admin/codex/oauth/cancel` |
| GitHub Copilot Auth | `POST /admin/github-copilot/oauth/start`, `GET /admin/github-copilot/oauth/status/:sessionId`, `POST /admin/github-copilot/oauth/complete`, `POST /admin/github-copilot/oauth/cancel`, `POST /admin/github-copilot/token`, `POST /admin/github-copilot/local-vscode`, `POST /admin/github-copilot/accounts/:accountId/refresh` |

### 常用脚本

```bash
pnpm dev        # 同时启动 server 和 web 开发模式
pnpm build      # 构建 shared、server、web
pnpm typecheck  # 类型检查所有包
pnpm test       # 运行后端 node:test 测试
```

按包执行：

```bash
pnpm --filter @cherryapi/server dev
pnpm --filter @cherryapi/server test
pnpm --filter @cherryapi/server typecheck
pnpm --filter @cherryapi/web dev
pnpm --filter @cherryapi/web build
pnpm --filter @cherryapi/shared build
```

适配器检查脚本：

```bash
pnpm --filter @cherryapi/server inspect:openai-compatible
pnpm --filter @cherryapi/server inspect:openai-api
pnpm --filter @cherryapi/server inspect:codex
pnpm --filter @cherryapi/server inspect:claude
```

### 数据与安全

- SQLite 数据库默认位于 `data/cherryapi.sqlite`。
- 上游账号凭据会加密存储；`ENCRYPTION_KEY` 必须足够长并保持稳定。
- 管理 API 只使用单个 `ADMIN_TOKEN` 做 Bearer 鉴权；如果暴露到公网，建议放在反向代理、VPN 或额外认证之后。
- CherryAPI 生成的 API Key 只保存 hash，完整明文只在创建时返回一次。
- API Key 的 `quota_limit` 按 token 计数消耗；成功请求会按返回 usage 更新 API Key 和账号的 `quota_used`。
- `rpm_limit`、`tpm_limit` 和部分 group quota 字段已建模并在管理端可编辑，但当前核心强制检查主要是 API Key 总额度和过期状态。
- 不要提交 `.env`、数据库文件或日志文件。

### 常见问题

**管理控制台请求 401**

确认 `.env` 中 `ADMIN_TOKEN` 和 `VITE_ADMIN_TOKEN` 一致。本地 Vite 会从根目录 `.env` 读取；Docker 中 token 会在前端构建时注入，修改后需要重新构建镜像。

**`/v1/chat/completions` 返回 `NO_AVAILABLE_ROUTE`**

请求的 `model` 没有在 API Key 所属 Group 的 `Model Bindings` 中启用。去 `Groups -> Model Bindings` 选择公开模型名、账号和上游模型。

**模型同步为空**

确认账号凭据有效、Channel base URL 正确、代理可用，并检查该平台适配器是否支持 `listModels`。OpenAI-compatible 服务需要正确实现 `/v1/models` 才能自动列出模型。

**Docker 中无法访问宿主机代理或上游服务**

把 `127.0.0.1` 改成 `host.docker.internal`。例如 `http://host.docker.internal:7890` 或 `http://host.docker.internal:3000/v1`。

**更换 `ENCRYPTION_KEY` 后账号不可用**

这是预期行为。已有凭据用旧密钥加密，换密钥后无法解密。需要恢复旧密钥或重新导入账号。

**端口冲突**

本地后端可改 `PORT`。Docker 可改 `CHERRYAPI_PORT`。Vite 开发端口默认是 `5173`，可临时运行 `pnpm --filter @cherryapi/web dev -- --port 5174`。

### 测试覆盖

当前后端测试覆盖：

- Admin token 鉴权。
- API Key 状态、Group 状态和额度校验。
- OpenAI-compatible adapter 的 URL/body 转换。
- Group Model Binding 路由解析。
- 基础 quota 判断。

运行：

```bash
pnpm test
```

### 发布后续工作

- Windows 一键启动器。
- Linux/macOS 一键启动脚本。
- 版本化 release 包，包含已构建的 server 和 web 资源。
- 进一步完善 planned 平台的登录、模型同步和额度检查。
- 更细粒度的速率限制强制执行。

### 许可证

当前仓库未包含 `LICENSE` 文件。公开发布或分发前请补充许可证。

---

## English

### Overview

CherryAPI is a local-first OpenAI-compatible gateway for aggregating upstream AI accounts and model capabilities behind one controlled `/v1` endpoint. From the admin console, you can connect upstream accounts, sync available models, bind public model names to specific accounts and upstream models, issue API keys for different groups, and inspect usage.

The default workflow is designed for local administration and self-hosted deployments. Data is stored in a local SQLite database. Admin APIs are protected by `ADMIN_TOKEN`. Upstream credentials are encrypted at rest with `ENCRYPTION_KEY`.

Online demo: [Bilibili - CherryAPI demo](https://www.bilibili.com/video/BV1c1Gb6EEaL/)

### Features

- OpenAI-compatible client endpoints: `GET /v1/models` and `POST /v1/chat/completions`.
- Non-streaming and streaming Chat Completions.
- Fastify + TypeScript API server.
- React + Vite + Tailwind admin console.
- Local SQLite database with Drizzle ORM schema definitions and startup-time schema initialization.
- Management for channels, accounts, account model capabilities, groups, model bindings, API keys, and usage logs.
- Group-scoped model exposure: expose different public model names for the same upstream model.
- Account health, concurrency, cooldown, quota usage, and recent error tracking.
- Account model sync: list models from upstream providers, then test availability with real requests.
- Retry behavior across remaining bound accounts when one upstream account fails.
- Global and per-account proxy support, plus common local proxy detection.
- Single-container Docker deployment with backend-hosted frontend assets.

### Current Support Matrix

| Platform | Status | Login / Import Methods | Notes |
| --- | --- | --- | --- |
| Codex | Available | OAuth Login, OAuth JSON, Access Token | Supports model detection and quota checks. OAuth callback uses port `1455` by default. |
| GitHub Copilot | Available | GitHub OAuth, GitHub Access Token, Copilot Credential JSON, Local VS Code Import | Supports model detection and quota checks. |
| OpenAI API | Available | API Key | Uses the official OpenAI API. Default base URL: `https://api.openai.com/v1`. |
| Claude API | Available | API Key | Converts between OpenAI Chat Completions and Anthropic Messages. |
| OpenAI-compatible | Available | API Key | For DeepSeek, OpenRouter, SiliconFlow, RightCode, local NewAPI/OneAPI, or any compatible `/v1` service. |
| Antigravity, Zed, Windsurf, Kiro, Cursor, Gemini CLI, CodeBuddy, Qoder, Trae | Planned / Partial | Not fully usable yet | Platform definitions and some channel/adapter scaffolding exist, but complete login and sync flows are follow-up work. |

### Architecture And Layout

```text
CherryAPI
├─ apps/server        Fastify API server, adapters, routing, SQLite schema, tests
├─ apps/web           React admin console, Vite dev server, Tailwind styles
├─ packages/shared    Shared TypeScript types, schemas, platform definitions
├─ data               Local SQLite database files
├─ Dockerfile         Production container build
└─ docker-compose.yml Self-hosted single-service deployment
```

Core request flow:

1. A client calls `/v1/chat/completions` with a CherryAPI API key.
2. The server authenticates the API key and loads its group.
3. The route resolver finds an enabled model binding for the requested public model in that group.
4. The account scheduler selects a healthy, allowed upstream account.
5. The provider adapter transforms and sends the upstream request.
6. The response is transformed back to OpenAI-compatible shape, usage is logged, and quota/health state is updated.

### Requirements

- Node.js `>=20`
- pnpm `>=11`
- Git
- Optional: Docker Desktop or Docker Engine
- Optional: `curl` for command-line endpoint checks

### Environment Variables

Create a root `.env` file from the example:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Important variables:

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode. |
| `PORT` | `3000` | Fastify server port. |
| `DATABASE_URL` | `file:./data/cherryapi.sqlite` | SQLite database URL. Relative paths are resolved from the server process working directory. |
| `ADMIN_TOKEN` | `change-me` | Bearer token required by every `/admin` request. Change it before deployment. |
| `VITE_ADMIN_TOKEN` | `change-me` | Token used by the web console. Keep it equal to `ADMIN_TOKEN` for local admin usage. |
| `VITE_API_TARGET` | `http://localhost:3000` | Backend target used by the Vite dev proxy. Can be empty in Docker builds for same-origin requests. |
| `WEB_DIST_DIR` | unset | Optional directory for backend-hosted frontend assets. Docker sets this to `/app/apps/web/dist`. |
| `ENCRYPTION_KEY` | `change-me-32-bytes-minimum` | Secret used to encrypt upstream account credentials. Keep it stable after accounts are created. |
| `LOG_LEVEL` | `info` | Fastify/Pino log level: `silent`, `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | unset | Optional outbound proxy variables. Use `host.docker.internal` for host-machine proxies from Docker. |
| `GITHUB_API_VERSION` | unset | Optional GitHub API version for GitHub Copilot calls. |
| `CODEX_CALLBACK_HOST` | usually `127.0.0.1` locally | Listener host for Codex OAuth callback. Docker Compose sets it to `0.0.0.0`. |
| `CHERRYAPI_PORT` | `3000` | Docker Compose host port for CherryAPI. |
| `CHERRYAPI_CODEX_CALLBACK_PORT` | `1455` | Docker Compose host port for Codex OAuth callback. |

### Start With Docker

```bash
cp .env.example .env
# Edit .env and at least change ADMIN_TOKEN and ENCRYPTION_KEY
docker compose up --build -d
```

Open:

- Admin console and server: `http://localhost:3000`
- OpenAI-compatible base URL: `http://localhost:3000/v1`
- Health check: `http://localhost:3000/health`

Persistent data is mounted at `./data`; the default database file is `./data/cherryapi.sqlite`.

Docker networking notes:

- To reach a proxy running on the host machine, use `http://host.docker.internal:7890` instead of `127.0.0.1`.
- To reach an OpenAI-compatible upstream service running on the host machine, set the channel `base_url` to `http://host.docker.internal:PORT/v1`.
- Compose publishes port `1455` for Codex OAuth callbacks.
- Docker injects `ADMIN_TOKEN` into the web build as `VITE_ADMIN_TOKEN`; rebuild the image after changing the token.

### Start Locally For Development

Windows PowerShell:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm dev
```

Linux / macOS:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open:

- Admin console: `http://localhost:5173`
- API server: `http://localhost:3000`
- OpenAI-compatible base URL: `http://localhost:3000/v1`

`pnpm dev` runs these packages in parallel:

- `@cherryapi/server`: `tsx watch src/main.ts`
- `@cherryapi/web`: `vite --host 0.0.0.0 --port 5173`

### Build And Run From Source

```bash
pnpm install
pnpm build
pnpm --filter @cherryapi/server start
```

After a build, the backend attempts to locate `apps/web/dist` or `../web/dist` and serve the frontend. To set it explicitly:

```bash
WEB_DIST_DIR=../web/dist pnpm --filter @cherryapi/server start
```

Windows PowerShell:

```powershell
$env:WEB_DIST_DIR="../web/dist"
pnpm --filter @cherryapi/server start
```

### First-Time Setup Flow

Use the admin console for the normal setup path:

1. Open `Dashboard` and check gateway health, account status, route readiness, and recent errors.
2. Open `Accounts`, choose a platform, and create or reuse the platform channel.
3. Choose the proper login/import method: OAuth, API Key, JSON Import, or Local Import.
4. Save the account, then run `Sync Models` to list upstream models and test availability.
5. Open `Groups`, then use `Model Bindings` to bind public model names to accounts and upstream models.
6. Open `API Keys` and create a key for the target group. The full key is shown only once.
7. Open `Test Console` and send a non-streaming or streaming request with the new key.
8. Use `Usage` and `Dashboard` to inspect logs, errors, latency, and quota consumption.

Important: runtime routing depends on `Groups -> Model Bindings`. The advanced `Models` and `Routes` pages remain available for compatibility-level model/route metadata, but new routing should be configured through group model bindings.

### OpenAI-Compatible Client API

Client requests use CherryAPI-generated API keys:

```text
Authorization: Bearer sk-cherry-...
```

List models visible to the API key's group:

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-cherry-xxx"
```

Send a chat completion:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-cherry-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      { "role": "user", "content": "hello, run a short gateway test" }
    ]
  }'
```

Streaming:

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-cherry-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "stream": true,
    "messages": [
      { "role": "user", "content": "stream test" }
    ]
  }'
```

### Admin API Surface

All `/admin` requests require:

```text
Authorization: Bearer $ADMIN_TOKEN
```

Main admin endpoints:

| Module | Endpoints |
| --- | --- |
| Health / Dashboard | `GET /health`, `GET /admin/health`, `GET /admin/dashboard/stats`, `GET /admin/dashboard/channel-health` |
| Platforms | `GET /admin/platforms`, `GET /admin/platforms/summary`, `GET /admin/platforms/:platformId`, `GET /admin/platforms/:platformId/accounts`, `POST /admin/platforms/:platformId/accounts`, `GET /admin/platforms/:platformId/channels` |
| Channels | `GET /admin/channels`, `POST /admin/channels`, `GET /admin/channels/:id`, `PATCH /admin/channels/:id`, `DELETE /admin/channels/:id` |
| Accounts | `GET /admin/accounts`, `POST /admin/accounts`, `GET /admin/accounts/:id`, `PATCH /admin/accounts/:id`, `DELETE /admin/accounts/:id`, `PATCH /admin/accounts/:id/enable`, `PATCH /admin/accounts/:id/disable`, `PATCH /admin/accounts/:id/clear-error`, `PATCH /admin/accounts/:id/reset-concurrency`, `POST /admin/accounts/:id/check-quota` |
| Account Model Aliases | `GET /admin/accounts/:id/model-aliases`, `POST /admin/accounts/:id/model-aliases`, `PUT /admin/accounts/:id/model-aliases/:aliasId`, `DELETE /admin/accounts/:id/model-aliases/:aliasId` |
| Model Detection | `GET /admin/account-model-capabilities`, `GET /admin/accounts/:id/model-capabilities`, `POST /admin/accounts/:id/list-models`, `POST /admin/accounts/:id/detect-models`, `POST /admin/accounts/:id/test-models`, `GET /admin/accounts/:id/detect-models/progress/:requestId`, `POST /admin/accounts/:id/model-capabilities`, `PATCH /admin/account-model-capabilities/:id`, `POST /admin/account-model-capabilities/:id/create-model-route`, `DELETE /admin/account-model-capabilities/:id` |
| Models / Routes | `GET /admin/models`, `POST /admin/models`, `GET /admin/models/:id`, `PATCH /admin/models/:id`, `DELETE /admin/models/:id`, `GET /admin/model-routes`, `POST /admin/model-routes`, `PATCH /admin/model-routes/:id`, `DELETE /admin/model-routes/:id` |
| Groups | `GET /admin/groups`, `POST /admin/groups`, `PATCH /admin/groups/:id`, `DELETE /admin/groups/:id`, `GET /admin/groups/:id/effective-models`, `GET /admin/groups/:id/model-candidates`, `GET /admin/groups/:id/model-bindings`, `PUT /admin/groups/:id/model-bindings` |
| Group Permissions | `GET /admin/groups/:id/model-permissions`, `PUT /admin/groups/:id/model-permissions`, `GET /admin/groups/:id/channel-permissions`, `PUT /admin/groups/:id/channel-permissions`, `GET /admin/groups/:id/account-rules`, `PUT /admin/groups/:id/account-rules` |
| API Keys | `GET /admin/api-keys`, `POST /admin/api-keys`, `PATCH /admin/api-keys/:id`, `DELETE /admin/api-keys/:id` |
| Proxy | `GET /admin/proxy/config`, `PUT /admin/proxy/config`, `POST /admin/proxy/detect` |
| Test Console | `POST /admin/test/chat-completion` |
| Usage | `GET /admin/usage-logs` |
| Codex OAuth | `POST /admin/codex/oauth/start`, `GET /admin/codex/oauth/status/:sessionId`, `POST /admin/codex/oauth/complete`, `POST /admin/codex/oauth/cancel` |
| GitHub Copilot Auth | `POST /admin/github-copilot/oauth/start`, `GET /admin/github-copilot/oauth/status/:sessionId`, `POST /admin/github-copilot/oauth/complete`, `POST /admin/github-copilot/oauth/cancel`, `POST /admin/github-copilot/token`, `POST /admin/github-copilot/local-vscode`, `POST /admin/github-copilot/accounts/:accountId/refresh` |

### Scripts

```bash
pnpm dev        # run server and web in development mode
pnpm build      # build shared, server, and web
pnpm typecheck  # typecheck all packages
pnpm test       # run backend node:test tests
```

Package-specific commands:

```bash
pnpm --filter @cherryapi/server dev
pnpm --filter @cherryapi/server test
pnpm --filter @cherryapi/server typecheck
pnpm --filter @cherryapi/web dev
pnpm --filter @cherryapi/web build
pnpm --filter @cherryapi/shared build
```

Adapter inspection scripts:

```bash
pnpm --filter @cherryapi/server inspect:openai-compatible
pnpm --filter @cherryapi/server inspect:openai-api
pnpm --filter @cherryapi/server inspect:codex
pnpm --filter @cherryapi/server inspect:claude
```

### Data And Security

- SQLite defaults to `data/cherryapi.sqlite`.
- Upstream credentials are encrypted at rest; keep `ENCRYPTION_KEY` long and stable.
- Admin APIs use a single `ADMIN_TOKEN` bearer token. If exposed beyond a local machine, place CherryAPI behind a reverse proxy, VPN, or additional authentication layer.
- CherryAPI-generated API keys are stored as hashes. The full key is returned only once at creation time.
- API key `quota_limit` is token-based. Successful requests update `quota_used` on both the API key and upstream account when usage is available.
- `rpm_limit`, `tpm_limit`, and some group quota fields are modeled and editable, but current core enforcement is primarily total API key quota and key expiration.
- Do not commit `.env`, database files, or log files.

### Troubleshooting

**Admin console requests return 401**

Make sure `ADMIN_TOKEN` and `VITE_ADMIN_TOKEN` match. Local Vite reads the root `.env`; Docker injects the token during the frontend build, so rebuild the image after changing it.

**`/v1/chat/completions` returns `NO_AVAILABLE_ROUTE`**

The requested `model` is not enabled in the API key group's `Model Bindings`. Configure it in `Groups -> Model Bindings`.

**Model sync returns no models**

Check account credentials, channel base URL, proxy settings, and whether the adapter supports `listModels`. OpenAI-compatible upstreams need a working `/v1/models` endpoint for automatic discovery.

**Docker cannot reach a host proxy or host upstream service**

Use `host.docker.internal` instead of `127.0.0.1`, for example `http://host.docker.internal:7890` or `http://host.docker.internal:3000/v1`.

**Accounts stop working after changing `ENCRYPTION_KEY`**

Existing credentials were encrypted with the previous key. Restore the old key or re-import the accounts.

**Port conflicts**

For the local backend, change `PORT`. For Docker, change `CHERRYAPI_PORT`. Vite defaults to `5173`; you can run `pnpm --filter @cherryapi/web dev -- --port 5174` temporarily.

### Test Coverage

Current backend tests cover:

- Admin token authentication.
- API key status, group status, and quota validation.
- OpenAI-compatible adapter URL/body transformation.
- Group model binding route resolution.
- Basic quota checks.

Run:

```bash
pnpm test
```

### Release Follow-Ups

- Windows one-click launcher.
- Linux/macOS one-command launcher.
- Versioned release archive with built server and web assets.
- Complete login, model sync, and quota support for planned platforms.
- More granular runtime rate-limit enforcement.

### License

This repository does not currently include a `LICENSE` file. Add one before public release or redistribution.
