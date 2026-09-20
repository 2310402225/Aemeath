# Cloudflare Pages 部署指南

本项目是**纯静态站点**（`astro.config.mjs` 无 adapter，构建产出 `dist/`），
可以直接部署到 Cloudflare Pages 的免费套餐。

---

## 一、需要你在 Cloudflare Dashboard 上做的事

我（助手）无法代替你完成 GitHub 授权，下面这 5 步必须你来点。

### 1. 进入 Pages 创建页

登录 <https://dash.cloudflare.com/> → 左侧 **Workers & Pages** → **Create** → 选 **Pages** 标签 → **Connect to Git**。

### 2. 授权并选择仓库

- 首次使用需要点 **Add account** 给 Cloudflare 安装 GitHub App，选择 **Only select repositories** 并勾上
  `2310402225/Aemeath`（不要给 All repositories 权限）。
- 回到 Pages 页面，选中 `2310402225/Aemeath`，点 **Begin setup**。

### 3. 填写构建配置（**照抄下面这张表**）

| 字段 | 填什么 |
|---|---|
| Project name | `zaichen-wangxing` |
| Production branch | `main` |
| Framework preset | `Astro` |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Root directory | *留空* |

> ⚠️ **如果选了 Astro 预设后命令被自动填成别的内容，以本表为准改回来。**
> 若安装依赖阶段报 `pnpm: command not found`，把 Build command 换成：
> ```
> corepack enable && corepack prepare pnpm@9.14.4 --activate && pnpm install --frozen-lockfile && pnpm run build
> ```

### 4. 设置环境变量（**关键，别跳过**）

展开 **Environment variables (advanced)**，加两条，**Production 和 Preview 都要加**：

| Variable name | Value | 作用 |
|---|---|---|
| `NODE_VERSION` | `22` | ⚠️ 必填。Cloudflare v3 构建镜像默认 Node **18**，且**忽略 `package.json` 的 `engines` 字段**，不设会直接构建失败 |
| `NODE_OPTIONS` | `--max-old-space-size=6144` | 构建含 sharp 图片处理 + Astro 编译，给足堆内存防 OOM |

`SITE_URL` **暂时不用设**。等你拿到正式域名（`xxx.pages.dev` 或自绑域名）后再加，
值填完整域名（如 `https://zaichen-wangxing.pages.dev`，**不要带结尾斜杠**），然后重新部署一次即可。
现在不填也没问题，代码里的默认值已经指向 `https://zaichen-wangxing.pages.dev`。

### 5. 点 Save and Deploy

首次构建大约 **3~6 分钟**。构建日志会实时滚动，成功后会给你一个
`https://zaichen-wangxing.pages.dev` 形式的域名。

---

## 二、后续更新

配好之后**全自动**：往 `main` 分支 push 就会触发一次新的 Production 部署，
其他分支 / PR 会生成独立的 Preview 部署。

---

## 三、仓库里已经为你准备好的东西

| 文件 | 作用 |
|---|---|
| `package.json` | `packageManager: pnpm@9.14.4`，Cloudflare 会据此选用 pnpm 9 |
| `.npmrc` | `manage-package-manager-versions=true`，与上面联动 |
| `.nvmrc` / `.node-version` | 双份 Node 版本声明（22），偏好读取 `.node-version` 的环境能自动识别 |
| `wrangler.jsonc` | 声明项目名与构建输出目录，供 `wrangler pages deploy` 直传时使用 |
| `public/_headers` | 静态资源强缓存 + HTML 不缓存，Pages 构建后会自动生效 |
| `src/config/siteConfig.ts` | `site_url` 支持 `SITE_URL` 环境变量覆盖 |

---

## 四、如果构建失败

### 报 `packages field missing or empty`

说明 `pnpm-workspace.yaml` 被动过。它**必须**有 `packages` 字段：

```yaml
packages:
  - "."

allowBuilds:
  esbuild: true
  sharp: true
  swup: true
  workerd: false
```

pnpm 10.5.0 起 `packages` 才是可选的，更早版本缺失即报错。

### 报 Node 版本相关错误

确认 `NODE_VERSION=22` 加在了**正确的环境**里（Production 与 Preview 是两套）。

### 报内存不足 / `JavaScript heap out of memory`

把 `NODE_OPTIONS` 调到 `--max-old-space-size=8192`。

### 构建超时

Cloudflare 免费套餐单次构建上限 **20 分钟**。本项目实测远低于此；
若真撞上，检查是不是 `astro build` 后面还有多余的步骤。

### 已经部署过、只是某个文件更新了但页面没变

HTML 是 `must-revalidate`，静态资源是 `immutable` 带哈希，正常情况不会出现。
若真的看到旧内容，先按 `Ctrl+Shift+R` 强制刷新；还不行就在 Pages 里
**Deployments → Retry deployment**。

---

## 五、和 Vercel 的关系

Vercel 的部署**不用删**，两套是并存的：

- `vercel.json` 保留，Vercel 那边照旧自动部署（电脑上访问没问题）。
- 两者的 `site_url` 通过 `SITE_URL` 环境变量区分即可；不设则都用默认的 `pages.dev` 域名。

如果之后确认 Cloudflare 一切正常、想只留一套，把 Vercel 项目删掉即可，
`vercel.json` 留着也不会有任何副作用。

---

## 六、静态资源缓存策略（换图必看）

规则在 `public/_headers`，构建时被原样复制到 `dist/`。核心只有一条：

> **只有带内容哈希的构建产物才可以 `immutable`；`public/` 下的东西一律回源校验。**

- `/_astro/*`、`/fonts/*` 是构建产物，文件名里带哈希 → `max-age=31536000, immutable`。
- `/assets/*`（卡面五层图、缩略图、封面、壁纸）、`/gallery/*`、`/images/*`、`/lottie/*`、
  `/mouse/*`、`/pagefind/*` 都是 **`public/` 里原样复制的固定文件名** → `max-age=0, must-revalidate`。

### 2026-09-20 那次「换了图怎么还是旧的」

`/assets/*` 曾被写成 `immutable`。结果换完 02/06 卡面并部署成功后，
浏览器里那份旧图仍被判定为「一年内不可能变」，**连 `If-None-Match` 都不发**，
于是怎么看都是旧图；而 `curl` 线上地址拿到的其实是新图（哈希与仓库里的逐字节一致）。

要记住的三件事：

1. `immutable` 的缓存条目**服务端无法作废**（不是「等一会儿就好」）——
   改完头也必须让用户做一次硬刷新（`Ctrl+Shift+R`）或清站点数据。
2. 排查顺序永远是：**先 `curl` 线上文件比哈希**（判断是「没部署上去」还是「本地缓存」），
   再看响应头里的 `Cache-Control` / `ETag`，最后才怀疑浏览器。
3. 如果要的是「换图后连硬刷新都不用」，就得给图片 URL 带上内容指纹
   （如 `cardThumb()` 追加 `?v=<hash>`）；代价是每次换图都要改版本号，
   与现在「同名覆盖、零改代码」的约定相冲突，故未采用。
