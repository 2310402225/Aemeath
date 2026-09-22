// 月下灯市 · 浮游工具集 —— 数据层。
//
// 13 条工具的数据只在这里维护一份：页面花灯、悬停信息卡、正文分组共用同一份，
// 免得改一处漏一处。四种花灯的形状也在这里，好让「哪一种工具配哪一种灯」这件事
// 和数据挨着放，一眼能对。

export type LanternKind = "fish" | "shell" | "jelly" | "star";

export type Lantern = {
	/** 工具名 */
	name: string;
	/** 绰号，也是卡上最大的那行字 */
	epithet: string;
	/** 星级，空字符串表示这项没有可靠数据 */
	stars: string;
	/** 一句话核心能力 */
	brief: string;
	/** 仓库或官网 */
	url: string;
	kind: LanternKind;
};

export const KIND_LABEL: Record<LanternKind, string> = {
	fish: "小鱼花灯",
	shell: "贝壳花灯",
	jelly: "水母花灯",
	star: "海星花灯",
};

/** 每种灯的性情，也是正文里每节的副标题 */
export const KIND_TRAIT: Record<LanternKind, string> = {
	fish: "轻快灵动",
	shell: "沉稳开合",
	jelly: "通透柔和",
	star: "稳定立体",
};

/** 每种灯适配的工具门类 */
export const KIND_SCOPE: Record<LanternKind, string> = {
	fish: "代码效率与即时执行",
	shell: "配置、模板与工程规范",
	jelly: "AI 记忆、学术写作与长周期智能",
	star: "架构解析、复盘与旧项目梳理",
};

/**
 * 灯光的冷暖：给 CSS 当 `rgb(var(--glow) / a)` 用。
 * 都是暖底子上的一点偏色 —— 湖面上十三盏纸灯，只有"哪一种灯"在分色，
 * 不像以前那样每盏都饱和度拉满（那是贴纸感、幼稚感的来源）。
 */
export const KIND_GLOW: Record<LanternKind, string> = {
	fish: "255 208 138",
	shell: "196 234 226",
	jelly: "214 194 246",
	star: "206 232 176",
};

export const LANTERNS: Lantern[] = [
	{
		name: "superpowers",
		epithet: "代码自律班长",
		stars: "28.8万",
		brief:
			"动笔前先梳理思路，写完自动跑测试、识别错误并自己修，整条编码闭环都替你盯着。",
		url: "https://github.com/obra/superpowers",
		kind: "fish",
	},
	{
		name: "mattpocock/skills",
		epithet: "大佬私藏工具箱",
		stars: "26.4万",
		brief:
			"程序员自用的一套 Agent 配置集，可以单拎出某个子 skill 做需求澄清、架构评审或缺陷分诊。",
		url: "https://github.com/mattpocock/skills",
		kind: "shell",
	},
	{
		name: "ECC",
		epithet: "AI 全能打工仔",
		stars: "26万",
		brief:
			"自带记忆系统、用户习惯记录与安全校验模块，能对接各类主流 AI 编程助手。",
		url: "https://github.com/affaan-m/ECC",
		kind: "jelly",
	},
	{
		name: "hermes-agent",
		epithet: "越用越懂你的搭子",
		stars: "24.6万",
		brief:
			"持续迭代的 Agent，跟着使用者的偏好一路学下去，长期自适应你的交互习惯。",
		url: "https://github.com/NousResearch/hermes-agent",
		kind: "fish",
	},
	{
		name: "karpathy skills",
		epithet: "AI 翻车避雷手册",
		stars: "21.3万",
		brief:
			"把「先想清楚、别过度设计、别顺手重构」写成 AI 的默认姿势，规避幻觉与越界改动。",
		url: "https://github.com/multica-ai/andrej-karpathy-skills",
		kind: "star",
	},
	{
		name: "anthropics/skills",
		epithet: "官方原版说明书",
		stars: "17.7万",
		brief:
			"Anthropic 官方的 Agent Skill 范例集，想学「一个 skill 到底该怎么设计」，读原版最省事。",
		url: "https://github.com/anthropics/skills",
		kind: "shell",
	},
	{
		name: "ponytail",
		epithet: "拒绝废话代码侠",
		stars: "14万",
		brief:
			"精简输出、专注代码，能一行解决的事不写五十行，顺手把过度设计顶回去。",
		url: "https://github.com/DietrichGebert/ponytail",
		kind: "fish",
	},
	{
		name: "gstack",
		epithet: "单人创业特种兵",
		stars: "13.3万",
		brief:
			"把 AI 拆成一整队专业角色，从需求、开发到部署一站式跟完，一个人也能成军。",
		url: "https://github.com/garrytan/gstack",
		kind: "star",
	},
	{
		name: "ui-ux-pro-max",
		epithet: "页面颜值救星",
		stars: "12.8万",
		brief:
			"内置风格库、配色与字体搭配，自动优化布局、校验样式，专治界面不好看。",
		url: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
		kind: "jelly",
	},
	{
		name: "graphify",
		epithet: "祖传代码翻译官",
		stars: "11.9万",
		brief:
			"把代码与文档建成一张可查询的知识图谱，逆向解析旧项目、画架构图、给重构方案。",
		url: "https://github.com/safishamsi/graphify",
		kind: "star",
	},
	{
		name: "i-have-adhd",
		epithet: "高效直出模式",
		stars: "",
		brief:
			"改掉 AI 的阅读格式：首行给可执行动作，多步骤强制短列表，砍掉寒暄与发散。",
		url: "https://github.com/ayghri/i-have-adhd",
		kind: "fish",
	},
	{
		name: "Xtab",
		epithet: "浏览器效率新标签页",
		stars: "",
		brief:
			"浏览器新标签页扩展，书签、待办与快捷访问合成一页，打开浏览器就是工作台。",
		url: "https://xtab.app/",
		kind: "shell",
	},
	{
		name: "千笔AI",
		epithet: "学术写作辅助",
		stars: "",
		brief:
			"面向学生的学术工具：文献整理、论文润色、毕设思路辅助，一路陪你写到答辩。",
		url: "https://qianbi.ai/",
		kind: "jelly",
	},
];

/** 四组灯的登场顺序，正文分节与页面图例共用 */
export const KIND_ORDER: LanternKind[] = ["fish", "shell", "jelly", "star"];

export function lanternsOf(kind: LanternKind): Lantern[] {
	return LANTERNS.filter((l) => l.kind === kind);
}

/* ------------------------------------------------------------------ 月相 */

export type MoonPhase = "new" | "waxing" | "full" | "waning";

/**
 * 月相只用一个数字表示：遮挡圆相对本体的水平位移，单位是月盘半径。
 * 0 = 完全重合（新月），-1 = 露出右半（上弦），2 = 完全错开（满月），
 * 1.72 = 只剩左边一钩（残月）。一个数就能让四态连续过渡，
 * 比四张图叠来叠去省事得多。
 */
export const MOON_OFFSET: Record<MoonPhase, number> = {
	new: 0,
	waxing: -1,
	full: 2,
	waning: 1.72,
};

export const MOON_LABEL: Record<MoonPhase, string> = {
	new: "新月",
	waxing: "上弦月",
	full: "满月",
	waning: "残月",
};

export const MOON_HINT: Record<MoonPhase, string> = {
	new: "夜深如墨，灯在睡",
	waxing: "月亮醒了",
	full: "满月照湖",
	waning: "久无人来，灯自沉",
};
