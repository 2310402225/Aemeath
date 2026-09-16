# 配置文件说明

本目录保存“载尘望星”的站点配置，统一由 `index.ts` 导出。

## 文件列表

| 文件 | 说明 |
|---|---|
| `siteConfig.ts` | 站点名称、副标题、域名、主题色、页面宽度和页面开关 |
| `announcementConfig.ts` | 首页公告 |
| `backgroundWallpaper.ts` | 桌面和移动端背景、横幅文字与遮罩 |
| `coverImageConfig.ts` | 文章封面和回退封面 |
| `effectsConfig.ts` | 樱花等轻量视觉效果 |
| `expressiveCodeConfig.ts` | 代码块主题、折叠和语言标签 |
| `fontConfig.ts` | 字体加载与回退 |
| `FooterConfig.html` | 页脚补充 HTML |
| `footerConfig.ts` | 页脚注入配置 |
| `galleryConfig.ts` | 相册列表和布局 |
| `homePortfolioIntro.ts` | 首页首屏内容 |
| `licenseConfig.ts` | 文章版权许可 |
| `navBarConfig.ts` | 导航菜单和链接预设 |
| `plantumlConfig.ts` | PlantUML 渲染方式 |
| `profileConfig.ts` | 头像、姓名、简介和公开链接 |
| `sidebarConfig.ts` | 侧栏位置、顺序和移动端组件 |
| `index.ts` | 统一导出入口 |

## 导入方式

优先使用统一入口：

```typescript
import { profileConfig, siteConfig } from "@/config";
```

也可以直接导入单个配置：

```typescript
import { siteConfig } from "@/config/siteConfig";
```

修改配置后运行 `pnpm check`，部署前运行 `pnpm build`。
