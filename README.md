# Private Bin

一个部署在 Cloudflare Workers 上的零知识纯文字粘贴板。前端负责加密/解密，服务端只保存密文和公开元数据。

## 特性

- Passkey 登录后才能创建 paste
- 分享链接查看无需登录
- 可选查看密码，密码不发送到服务端
- 过期时间，不提供永久保存
- 阅后即焚
- 二维码分享
- Shiki 懒加载代码高亮
- Cloudflare Workers + Static Assets + D1 单 Worker 部署

## 本地开发

```bash
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm cf-types
```

## Cloudflare 配置

真实 `wrangler.jsonc` 不提交到仓库。复制模板后替换自己的域名和 D1 ID：

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

创建 D1 并应用迁移：

```bash
pnpm exec wrangler d1 create private-bin
pnpm exec wrangler d1 migrations apply private-bin --remote
```

部署：

```bash
pnpm build
pnpm exec wrangler deploy
```

注册窗口由 `ALLOW_PASSKEY_REGISTRATION` 控制。注册完可信用户后应改回 `false` 并重新部署。

## 安全与资源限制

- 登录和注册接口按来源 IP 合并限制为每分钟 30 次；同一网络中的用户共享额度。
- 创建接口按已认证用户限制为每分钟 10 次。超限返回 HTTP 429，`Retry-After` 为 60 秒。
- 限流使用 Workers 原生 Rate Limiting，按 Cloudflare 节点计数。两个 `ratelimits.namespace_id` 应在账户内保持独立。
- 创建请求的 JSON 上限为 2 MiB，其余需要解析 JSON 的接口为 64 KiB；按实际读取字节限制，超限返回 HTTP 413。明文仍限制为 1 MB（1,000,000 字节）。
- Cron 每 5 分钟清理过期 Paste、session 和认证挑战。读取时仍立即拒绝过期内容。
- 停用用户同时撤销该用户的全部 session，重新启用后需要重新使用 passkey 登录。
- 阅后即焚在取回密文时删除服务端记录，尚未解密也会删除。刷新、关闭页面或网络中断可能导致内容永久丢失。

Monaco 的 pnpm 补丁使编辑器使用 `dompurify` 依赖提供的安全修复版本。升级 Monaco 时需要重新核对补丁和构建产物中的 DOMPurify 版本。
