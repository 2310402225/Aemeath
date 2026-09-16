# 仓库说明

## 项目结构

站点使用 Astro 7、Svelte 5 和 TypeScript。路由位于 `src/pages/`，布局位于 `src/layouts/`，组件位于 `src/components/`，样式位于 `src/styles/`，内容位于 `src/content/`，工具函数位于 `src/utils/`，Markdown 插件位于 `src/plugins/`。配置集中在 `src/config/`，对应类型位于 `src/types/`。静态资源放在 `public/`，文档放在 `docs/`，脚本放在 `scripts/`。

## 开发命令

必须使用 pnpm。

- `pnpm dev`：启动本地开发服务器
- `pnpm check`：运行 Astro 检查
- `pnpm type-check`：运行 TypeScript 检查
- `pnpm format`：格式化 `src`
- `pnpm lint`：运行 Biome 检查
- `pnpm lqips`：更新图片占位数据
- `pnpm build`：生成完整生产构建和搜索索引
- `pnpm preview`：预览生产构建
- `pnpm new-post`：创建中文文章草稿

## 编码约定

Biome 使用制表符缩进和双引号。Astro 与 Svelte 组件使用 `PascalCase`，配置模块使用 `camelCase`，工具文件使用描述性短横线命名。保持 `src/types` 与 `src/config` 同步，避免无关格式化改动。

## 验证要求

目前没有独立单元测试框架。内容、渲染或资源改动至少运行 `pnpm check`、`pnpm type-check` 和 `pnpm build`。视觉交互改动需要启动开发服务器，检查桌面端和移动端，并确认文字、按钮、卡片和导航没有重叠或溢出。

## 提交约定

提交信息使用 Conventional Commits，例如 `feat:`、`fix:` 和 `chore:`。每次提交只处理一个清晰目标。说明中应包含改动摘要、验证命令和必要的页面截图。

## 安全与配置

不要提交密钥、令牌、邮箱密码或第三方服务凭据。部署环境变量放在 Vercel 中。提交前检查 `dist/`、`src/constants/lqips.json` 和 `src/constants/icons.ts`，避免带入旧站资源或不必要的生成物。
