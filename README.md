# Aemeath

> 朝朝听雨的公开博客源码与站点快照

Aemeath 是朝朝听雨（Rain）的个人博客站点源码，线上站点为 [rainzt.cn](https://rainzt.cn/)。它以 Astro 静态构建为基础，把个人写作、技术实践、项目记录、友链聚合和轻量工具放在同一个可维护的站点里。

当前公开快照包含 **V3.4.0** 的站点工作：白发主题随笔、文章影片、Lottie 动效画廊、工具卡片推荐、全局阅读进度和公开分析页。

## 站点内容

- 文章、归档、分类、标签与全文搜索
- 关于、友链、朋友圈 RSS 快照、留言板和工具页
- 相册、Lottie 动效画廊与文章内媒体展示
- 响应式布局、暗色模式、页面转场和可配置侧栏
- Waline 评论客户端与 Umami 公开统计展示
- 中文优先的多语言界面

## 本地开发

环境要求：

- Node.js >= 22
- pnpm >= 9

安装依赖并启动开发服务器：

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm check       # Astro 类型与模板检查
pnpm build       # 生成静态站点、搜索索引和优化资源
pnpm preview     # 预览生产构建
pnpm new-post    # 创建文章
pnpm post-studio # 启动本地文章编辑工具
```

## 目录结构

```text
src/config/       站点、导航、侧栏、评论和统计配置
src/content/      文章与特殊页面内容
src/components/   Astro / Svelte 组件
src/pages/        页面与 API 路由
src/data/         朋友圈快照与更新记录
public/           直接发布的静态资源
scripts/          构建和内容辅助脚本
```

站点配置集中在 `src/config/`，文章使用 Markdown 或 MDX，新增文章放在 `src/content/posts/`。

## 公开快照边界

这个仓库只保留可公开复用的站点源码、内容和静态资源。部署平台配置、服务器运维脚本、评论服务端代码、邮件模板、主机信息和密钥不属于公开快照；相关凭据应通过目标环境的服务端配置提供。

## 许可证

本项目遵循 [MIT License](LICENSE)。原有许可证与版权声明请以仓库中的 `LICENSE` 文件为准。
