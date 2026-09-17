import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

// ============================================================================
// 导航栏配置 - 根据顺序动态生成导航栏链接
// NavBar Configuration - Dynamically generate navigation bar links based on order
// ============================================================================
const getDynamicNavBarConfig = (): NavBarConfig => {
	// 基础导航栏链接
	const links: NavBarLink[] = [
		// 主页
		LinkPresets.Home,
	];

	// 内容优先级的三个主入口：学习、项目、资源
	links.push(LinkPresets.Learning);
	links.push(LinkPresets.Projects);
	links.push(LinkPresets.Resources);

	// 归档与检索
	links.push({
		name: "归档",
		url: "#",
		icon: "material-symbols:archive",
		children: [LinkPresets.Archive, LinkPresets.Categories, LinkPresets.Tags],
	});

	// 更多及其子菜单
	links.push({
		name: "更多",
		url: "#",
		icon: "material-symbols:more-horiz",
		children: [
			LinkPresets.Gallery,
			LinkPresets.Tools,
			LinkPresets.Lottie,
			LinkPresets.Changelog,
			LinkPresets.BlogChangelog,
			LinkPresets.Travellings,
		],
	});

	// 关于
	links.push(LinkPresets.About);

	return { links } as NavBarConfig;
};

// 导航搜索配置
export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

// ============================================================================
// 链接预设 - 可自由自定义导航栏链接的名称、图标和URL
// Link Presets - Allows free customization of the name, icon, and URL of navigation bar links
// ============================================================================
export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Travellings: {
		name: "开往",
		url: "https://www.travellings.cn/go.html",
		external: true,
		iconImage: "https://www.travellings.cn/assets/travelling.png",
	},
	Archive: {
		name: "归档",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	Learning: {
		name: "学习",
		url: "/learning/",
		icon: "material-symbols:school",
	},
	Projects: {
		name: "项目",
		url: "/projects/",
		icon: "material-symbols:deployed-code",
	},
	Resources: {
		name: "资源",
		url: "/resources/",
		icon: "material-symbols:bookmark-manager",
	},
	Categories: {
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Tools: {
		name: "工具",
		url: "/tools/",
		icon: "material-symbols:construction-rounded",
	},
	Changelog: {
		name: "项目更新日志",
		url: "/changelog/",
		icon: "material-symbols:history-edu-rounded",
	},
	About: {
		name: "关于",
		url: "/about/",
		icon: "material-symbols:info",
	},
	Lottie: {
		name: "动态表情",
		url: "/lottie/",
		icon: "material-symbols:auto-awesome-rounded",
	},
	BlogChangelog: {
		name: "博客日志",
		url: "/blog-changelog/",
		icon: "material-symbols:auto-stories-rounded",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
