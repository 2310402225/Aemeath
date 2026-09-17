import type { SiteConfig } from "@/types/siteConfig";

// 定义站点语言
// 语言代码，例如：'zh_CN', 'zh_TW', 'en', 'ja', 'ru'。
const SITE_LANG = "zh_CN";

export const siteConfig: SiteConfig = {
	// 站点标题
	title: "载尘望星",

	// 站点副标题
	subtitle: "城之内，是尘埃与眼泪；城之外，是星宇与长河",

	// 主题版本
	themeVersion: "V3.4.0",

	// 站点 URL
	// 部署到 Vercel 后把这里换成实际域名；构建时可用环境变量 SITE_URL 覆盖
	site_url:
		(typeof process !== "undefined" ? process.env.SITE_URL : undefined) ||
		"https://zaichen-wangxing.vercel.app",

	// 站点描述
	description:
		"载尘望星是尘之泪的个人站点，记录 AI 学习笔记、项目复盘与资源推荐，在技术之外保留一点人文视角。",

	// 站点关键词
	keywords: [
		"载尘望星",
		"尘之泪",
		"AI",
		"机器学习",
		"深度学习",
		"学习笔记",
		"个人博客",
	],

	// 主题色
	themeColor: {
		// 主题色的默认色相，范围从 0 到 360。例如：红色：0，青色：200，蓝绿色：250，粉色：345
		hue: 250,
		// 是否对访问者隐藏主题色选择器
		fixed: false,
		// 默认模式："light" 亮色，"dark" 暗色，"system" 跟随系统
		defaultMode: "system",
	},

	// 页面整体宽度（单位：rem）
	// 数值越大可以让页面内容区域更宽
	// 在使用单侧栏边栏时，建议调低一些宽度以获得更好的视觉效果。
	pageWidth: 112,

	// 网站Card样式配置
	card: {
		// 是否开启卡片边框和阴影，开启后让网站更有立体感
		border: true,
		// 是否让卡片风格跟随主题色相
		followTheme: false,
	},

	// Favicon 配置
	favicon: [
		{
			src: "/favicon/zaichen-avatar-512.png?v=20260916",
			sizes: "512x512",
		},
		{
			src: "/favicon/zaichen-avatar-192.png?v=20260916",
			sizes: "192x192",
		},
		{
			src: "/favicon/zaichen-avatar-180.png?v=20260916",
			sizes: "180x180",
		},
		{
			src: "/favicon/zaichen-avatar-32.png?v=20260916",
			sizes: "32x32",
		},
	],

	// 导航栏配置
	navbar: {
		// 导航栏Logo
		// 支持三种类型：
		// 1. Astro图标库: { type: "icon", value: "material-symbols:home-pin-outline" }
		// 2. 本地图片（public目录，不优化）: { type: "image", value: "/assets/images/logo.webp", alt: "Logo" }
		// 3. 本地图片（src目录，自动优化但会增加构建时间）: { type: "image", value: "assets/images/logo.webp", alt: "Logo" }
		// 4. 网络图片: { type: "url", value: "https://example.com/logo.png", alt: "Logo" }
		logo: {
			type: "image",
			value: "assets/images/zaichen-avatar.webp",
			alt: "载尘望星",
		},
		// 导航栏标题
		title: "载尘望星",
		// 全宽导航栏，导航栏是否占满屏幕宽度
		widthFull: false,
		// 导航菜单对齐方式，left：左对齐，center：居中
		menuAlign: "center",
		// 导航栏图标和标题是否跟随主题色
		followTheme: false,
		// 导航栏是否固定在顶部并始终可见
		stickyNavbar: true,
	},

	// 站点开始日期，用于统计运行天数
	siteStartDate: "2026-09-16",

	// 站点时区（IANA 时区字符串），用于格式化 RSS 等构建日期时间
	// 示例："Asia/Shanghai", "UTC", 如果为空，则按照构建服务器的时区进行时区转换
	timezone: "Asia/Shanghai",

	// 页面开关配置 - 控制特定页面的访问权限，设为false会返回404并自动隐藏对应的导航栏菜单项
	pages: {
		// 相册页面开关
		gallery: true,
	},

	// 分类导航栏开关，在首页和归档页顶部显示分类快捷导航
	categoryBar: true,

	// 归档页是否折叠非最新年份文章，禁用后默认展开全部年份
	foldArticle: true,

	// 文章列表布局配置
	postListLayout: {
		// 默认布局模式："list" 列表模式（单列布局），"grid" 网格模式（多列布局）
		defaultMode: "grid",
		// 移动端默认布局模式，不设置则跟随 defaultMode
		mobileDefaultMode: "grid",
		// 是否在文章列表中显示标签
		showTags: true,
		// 文章列表中最多显示的标签数量
		tagCount: 2,
		// 文章简介显示行数，设为 0 则不截断
		descriptionLines: 2,
		// 文章卡片底部统计和发布日期是否显示图标
		showStatsIcons: true,
		// 是否允许用户切换布局
		allowSwitch: true,
		// 网格布局配置，仅在 defaultMode 为 "grid" 或允许切换布局时生效
		grid: {
			// 是否开启瀑布流布局，同时有封面图和无封面图的混合文章推荐开启
			masonry: false,
			// 网格模式卡片最小宽度(px)，浏览器根据容器宽度自动计算列数
			columnWidth: 340,
		},
	},

	// 文章内容页配置
	post: {
		// 提醒框（Admonitions）配置，修改后需要重启开发服务器才能生效
		// 主题：'github' | 'obsidian' | 'vitepress' | 'docusaurus'，每个主题风格和语法不同，可根据喜好选择
		rehypeCallouts: {
			theme: "github",
			// 是否启用兼容 Python-Markdown 风格的 admonition 语法（!!!和???语法）
			// 注意：只有 theme 配置成 obsidian 主题才能基本支持这些语法，其他主题会有样式问题或不兼容的情况
			enablePythonMarkdownAdmonitions: false,
		},
		// 文章页底部的"上次编辑时间"卡片开关
		showLastModified: true,
		// 文章过期阈值（天数），超过此天数才显示"上次编辑"卡片
		outdatedThreshold: 30,
		// 是否开启分享海报生成功能
		sharePoster: true,
		// OpenGraph图片功能，注意开启后要渲染很长时间，不建议本地调试的时候开启
		generateOgImages: false,
	},

	// 分页配置
	pagination: {
		// 每页显示的文章数量
		// 当前公开文章数量不足以形成第二页时，保持首页完整展示，避免出现只剩一篇的孤立分页。
		postsPerPage: 12,
	},

	// 图像优化及响应式配置
	// 图像优化压缩只保留avif或webp
	// 响应式图像是为在不同设备上提高性能而调整的图像。这些图像可以调整大小以适应其容器，并且可以根据访问者的屏幕尺寸和分辨率以不同的大小提供。
	// Astro 仅能对 src 目录下的图像进行优化，src 目录下的图像越多，构建时间会越长
	// Astro 图像文档 https://docs.astro.build/zh-cn/guides/images/
	imageOptimization: {
		// 输出图片格式
		// - "avif": 仅输出 AVIF 格式（最新技术，最小体积，目前兼容性较低）
		// - "webp": 仅输出 WebP 格式（体积适中，兼容性好）
		// - "both": 同时输出 AVIF 和 WebP（推荐，浏览器自动选择最佳格式）
		formats: "webp",
		// 图片压缩质量 (1-100)，值越低体积越小但质量越差，推荐 70-85
		quality: 85,
		// 为特定域名的图片添加 referrerpolicy="no-referrer" 属性
		// 支持通配符 *，例如：["i0.hdslb.com", "*.bilibili.com"]
		// 可解决指定域名图片加载时的 403 问题
		noReferrerDomains: [],
	},

	// 站点语言，在本配置文件顶部SITE_LANG定义
	lang: SITE_LANG,
};
