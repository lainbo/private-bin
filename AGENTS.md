# AGENTS.md

本文件是给后续维护者和 AI 代理的接手说明。无论用户使用什么语言交流，本项目维护沟通都默认使用简体中文。

## 项目概览

这是一个部署在 Cloudflare Workers 上的零知识纯文字粘贴板，目标是复刻 PrivateBin 的核心安全模型，但使用现代前端和 Cloudflare 原生部署方式。

核心原则：

- 服务端只保存密文和公开元数据，不保存明文、不保存 URL fragment 中的解密 key、不保存查看密码。
- 创建 paste 必须 passkey 登录；查看分享链接默认不需要登录。
- 如果创建者设置了查看密码，密码只在浏览器端参与密钥派生，不会发送到服务端。
- 支持过期时间和阅后即焚；不支持永久保存。
- 只做纯文字传输；不做文件、图片、PDF、媒体上传，不做 Markdown/HTML 预览，不做多语言翻译系统。

当前线上地址：

- `https://bin.lainbo.dev`
- Cloudflare Worker name：`private-bin`
- D1 database name：`private-bin`
- D1 database id：见 `wrangler.jsonc`

## 技术栈

- 包管理器：`pnpm`
- 前端：React 19、TypeScript、Vite 8
- React 插件：`@vitejs/plugin-react-oxc`
- Cloudflare：`@cloudflare/vite-plugin`、Wrangler、Workers Static Assets、D1
- 测试：Vitest
- 加密：浏览器 Web Crypto，AES-GCM + PBKDF2-SHA256
- Passkey/WebAuthn：`@simplewebauthn/browser`、`@simplewebauthn/server`
- 代码高亮：Shiki，查看代码模式时懒加载
- 二维码：`qrcode`
- 图标：`lucide-react`

注意：`@vitejs/plugin-react-oxc` 目前会提示 deprecated，因为新版 `@vitejs/plugin-react` 已吸收相关能力；但该项目是按用户偏好选用 voidzero/oxc 方向，除非明确要求，不要主动替换。

## 目录导览

- `src/App.tsx`：主要 React UI，包含创建、查看、passkey 登录/注册、成功页和二维码展示。
- `src/main.tsx`：React 入口。
- `src/styles.css`：全局 UI 样式，桌面优先，同时适配移动端。
- `src/shared/constants.ts`：过期选项、语言选项、大小限制等共享常量。
- `src/shared/api-types.ts`：前后端共享 API 类型。
- `src/lib/paste-crypto.ts`：前端加密/解密、查看密码参与派生、URL fragment 相关核心逻辑。
- `src/lib/passkey.ts`：浏览器端 WebAuthn/passkey 调用。
- `src/lib/syntax.ts`：Shiki 懒加载高亮器，只加载选定语言和主题。
- `src/worker/index.ts`：Worker fetch 入口和 API 路由。
- `src/worker/auth.ts`：passkey 注册、登录、session、admin 用户管理。
- `src/worker/pastes.ts`：paste 创建、读取、删除、过期、阅后即焚逻辑。
- `src/worker/db.ts`：D1 查询辅助和过期数据清理。
- `src/worker/response.ts`：JSON 响应、安全响应头、同源检查。
- `migrations/0001_initial.sql`：D1 schema。
- `wrangler.jsonc`：本地真实 Cloudflare Worker、Static Assets、D1、域名和公开环境变量配置，已在 `.gitignore` 中排除。
- `wrangler.jsonc.example`：可提交的 Cloudflare 配置模板；新环境部署时复制为 `wrangler.jsonc` 后替换域名和 D1 ID。
- `tests/paste-crypto.test.ts`：当前主要单元测试。

## 本地开发

常用命令：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm cf-types
```

本地开发服务通常是 Vite 启动的 `http://127.0.0.1:5173/`。

`src/worker/response.ts` 对本地 `localhost` / `127.0.0.1` 的静态资源响应放宽了 CSP 的 `script-src 'unsafe-inline'`，这是为了允许 Vite dev 注入 React Refresh preamble。生产环境不会放宽该项。

## Cloudflare 部署

当前部署形态是单个 Worker：

- Worker 处理 `/api/*`
- Static Assets 服务前端 SPA
- `not_found_handling` 使用 `single-page-application`
- `run_worker_first` 为 `true`
- 自定义域名为 `bin.lainbo.dev`
- `workers_dev` 为 `false`

公开仓库不会提交真实 `wrangler.jsonc`。首次部署时：

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

然后替换 `database_id`、`PUBLIC_ORIGIN`、`RP_ID` 和 `routes.pattern`。

部署命令：

```bash
pnpm build
pnpm exec wrangler deploy
```

部署前建议跑：

```bash
pnpm cf-types
pnpm typecheck
pnpm test
pnpm build
pnpm exec wrangler deploy --dry-run
```

D1 migration：

```bash
pnpm exec wrangler d1 migrations apply private-bin --remote
pnpm exec wrangler d1 migrations list private-bin --remote
```

修改 `wrangler.jsonc` 后，记得运行：

```bash
pnpm cf-types
```

## 环境变量和注册窗口

当前公开配置在 `wrangler.jsonc` 的 `vars`：

- `ALLOW_PASSKEY_REGISTRATION=false`
- `PUBLIC_ORIGIN=https://bin.lainbo.dev`
- `RP_ID=bin.lainbo.dev`
- `SESSION_TTL_DAYS=30`

注册窗口流程：

1. 需要新增可信用户或设备时，把 `ALLOW_PASSKEY_REGISTRATION` 改为 `"true"`。
2. 重新部署。
3. 用户在 `https://bin.lainbo.dev` 注册 passkey。
4. 注册完成后立即把 `ALLOW_PASSKEY_REGISTRATION` 改回 `"false"`。
5. 再次部署，并用 `/api/auth/status` 确认 `registrationOpen:false`。

第一个注册用户会成为 admin。admin 可以在系统内禁用用户。不要设置 `MAX_USERS`，用户明确要求注册期开放注册、不限制人数。

Passkey 注意事项：

- `RP_ID` 与域名绑定，改域名会影响已有 passkey。
- Bitwarden 兼容性很重要：不要限定 `authenticatorAttachment`，attestation 使用 `none`，登录应显式调用 `navigator.credentials.get()`。

## 数据模型

D1 表：

- `users`
- `passkey_credentials`
- `auth_challenges`
- `sessions`
- `pastes`

关键索引：

- `pastes.expires_at`
- `pastes.owner_user_id`
- `sessions.user_id`
- `sessions.expires_at`
- `auth_challenges.expires_at`

paste 记录中保存：

- 密文
- 加密参数
- 过期时间
- 阅后即焚标记
- 是否需要查看密码的公开标记
- 创建者 ID
- 文本大小和语言

不要向服务端新增明文字段、查看密码字段、URL fragment key 字段。

## 安全边界

绝对不要读取、打印或提交真实敏感文件：

- `.env`
- `.env.local`
- `.env.dev`
- `.env.development`
- `.env.test`
- `.env.production`
- `*.pem`
- `*.key`
- `*.crt`
- `id_rsa`
- `*.keystore`
- `secrets.json`
- `credentials.json`
- `auth.json`

如需了解环境变量，只能读取 `.env.example`、`.env.template`、`.env.sample` 等模板文件。

如果调试需要真实值，不要查找本地真实文件，向用户索取脱敏 mock 值。

Cookie/session 约定：

- 登录 session 使用随机 token。
- 服务端只保存 token hash。
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax`。

同源保护：

- 非 GET API 请求会检查 `Origin`。
- 生产 CSP 保持严格，不要为了方便调试而全局放宽。

## 加密和 URL 规则

URL：

- 普通 paste：`/p/:id#<key>`
- 阅后即焚：`/p/:id#-<key>`

fragment 不会发送到服务端。二维码只包含完整 URL，不包含查看密码。

阅后即焚查看流程：

- 前端先识别 `#-` 并提示确认。
- 用户确认后再请求 API。
- 服务端读取 burn paste 时应做到取回记录后删除。
- 过期记录读取时删除并返回统一 404。

大小限制：

- 明文 UTF-8 不超过 1MB。
- 大文本超过高亮阈值时降级为纯文本显示。

## UI 和产品约束

默认语言为简体中文，不做浏览器语言检测。

首屏就是编辑器或登录/注册状态，不做营销页。

必须保留：

- 密码保护
- 过期时间，默认 6 小时
- 阅后即焚
- 桌面优先，同时移动端高质量适配
- 创建成功后显示复制链接、二维码、过期信息、密码保护状态、阅后即焚状态

不实现：

- Markdown/HTML 粘贴
- 预览功能
- 文件/图片/PDF/媒体上传
- 翻译系统

过期选项必须保持：

- 10 分钟
- 30 分钟
- 1 小时
- 3 小时
- 6 小时
- 12 小时
- 1 天
- 3 天
- 1 周

不要添加永久保存。

## 维护准则

- 优先保持零知识模型和小而清晰的功能面。
- 改认证、加密、删除、阅后即焚、过期清理逻辑前，先补测试或至少写清证据链。
- 不要把查看密码、明文、URL fragment key 发给 Worker。
- 新增依赖前先确认 `pnpm-lock.yaml`，使用 `pnpm`。
- 新增 Cloudflare binding 或 `vars` 后运行 `pnpm cf-types`。
- 修改 D1 schema 时通过 `wrangler d1 migrations create` 或手写新 migration 文件，不要直接改已上线 migration 的语义。
- 变更 UI 后至少检查 375px 宽移动视口是否没有水平滚动和控件重叠。
- Shiki 使用细粒度懒加载，不要改回整包 `createHighlighter` 导入。
- 换行符统一 LF。

## 最小验收清单

常规改动：

```bash
pnpm typecheck
pnpm test
pnpm build
```

Cloudflare 配置或 Worker 改动：

```bash
pnpm cf-types
pnpm exec wrangler deploy --dry-run
```

部署后 smoke test：

```bash
curl -sS https://bin.lainbo.dev/api/config
curl -sS https://bin.lainbo.dev/api/auth/status
```

注册窗口关闭状态应返回：

```json
{"authenticated":false,"registrationOpen":false,"user":null}
```
