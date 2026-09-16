# 载尘望星

> 城之内，是尘埃与眼泪；城之外，是星宇与长河。

“载尘望星”是尘之泪的个人中文站点，用于沉淀 AI 学习笔记、项目复盘和资源推荐。站点以 Astro 静态构建为基础，内容优先、视觉克制，部署目标为 Vercel。

## 内容方向

- 学习记录：代码、公式、复现步骤、参考资料和后续问题
- 项目记录：背景、方案、踩坑、结果和可复用资源
- 资源推荐：用途、推荐理由、适用人群、替代方案和标签
- 文章、归档、分类、标签、全文搜索和相册

## 本地开发

环境要求：

- Node.js >= 22
- pnpm >= 9

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm check       # Astro 类型与模板检查
pnpm lqips       # 清理并生成图片占位数据
pnpm build       # 生成静态站点、搜索索引和优化资源
pnpm preview     # 预览生产构建
pnpm new-post    # 创建文章草稿
```

## 目录结构

```text
src/config/       站点、导航、侧栏、背景和页面配置
src/content/      文章与特殊页面内容
src/components/   Astro / Svelte 组件
src/pages/        页面与 API 路由
src/data/         学习、项目和资源数据
public/           直接发布的静态资源
scripts/          构建和内容辅助脚本
docs/             需求文档与内容模板
```

学习笔记使用 `docs/templates/learning-note.md`，项目记录使用 `docs/templates/project-record.md`。新增文章放在 `src/content/posts/`。

## 部署

项目输出静态站点到 `dist/`，可直接部署到 Vercel。线上域名通过环境变量 `SITE_URL` 配置，例如：

```text
SITE_URL=https://example.com
```

源文件应同时保存在本地和 GitHub，迁移时不需要依赖特定托管平台的数据服务。

## 许可证

项目代码遵循仓库中的 [MIT License](LICENSE)。文章内容默认使用 CC BY-NC-SA 4.0，版权归尘之泪所有。
