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
