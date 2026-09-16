import type { AnnouncementConfig } from "../types/announcementConfig";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题
	title: "欢迎来到载尘望星",

	// 公告内容
	content:
		"这里存学习笔记、项目复盘和用过的资源。技术内容尽量写清来龙去脉，也留一点属于人的东西。",

	// 是否允许用户关闭公告
	closable: true,

	links: [
		{
			// 启用链接
			enable: true,
			// 链接文本
			text: "关于本站",
			// 链接 URL
			url: "/about/",
			// 内部链接
			external: false,
		},
		{
			// 暂时没有公开仓库，先关闭这个入口
			enable: false,
			// 链接文本
			text: "学习笔记",
			// 链接 URL
			url: "/learning/",
			// 内部链接
			external: false,
		},
	],
};
