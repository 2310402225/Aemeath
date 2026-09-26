// 数据层：汉字刻度环的字表、字帖句子、胶卷帧、全屏滤镜。
//
// 字表全部来自 `glyphs.ts`（离线烘的笔顺骨架）—— 环上的字是**写**出来的，
// 不是字库渲染的。所以运行期不加载任何字体，换台机器字形也不会变。

/** 外圈：十二地支。子时从 23 点起，两个小时一个 —— 于是「罗盘上的汉字」与现实一致。 */
export const DIZHI = [
	"子",
	"丑",
	"寅",
	"卯",
	"辰",
	"巳",
	"午",
	"未",
	"申",
	"酉",
	"戌",
	"亥",
] as const;

/** 中圈：十二时辰的旧名，与地支一一对应。 */
export const SHICHEN = [
	"夜半",
	"鸡鸣",
	"平旦",
	"日出",
	"食时",
	"隅中",
	"日中",
	"日昃",
	"晡时",
	"日入",
	"黄昏",
	"人定",
] as const;

/** 内圈：十二月令。 */
export const YUELING = [
	"正月",
	"二月",
	"三月",
	"四月",
	"五月",
	"六月",
	"七月",
	"八月",
	"九月",
	"十月",
	"冬月",
	"腊月",
] as const;

/** 三个环，从外到内。`current()` 说「此刻真实是哪一格」。 */
export type RingDef = {
	id: string;
	label: string;
	words: readonly string[];
	/** 半径占罗盘半径的比例 */
	radius: number;
	/** 字号占罗盘半径的比例 */
	size: number;
	/** 这一环此刻真实落在哪一格 */
	current: (t: Date) => number;
};

export const RINGS: RingDef[] = [
	{
		id: "dizhi",
		label: "地支",
		words: DIZHI,
		radius: 0.92,
		size: 0.082,
		// 子时 = 23:00–01:00
		current: (t) => Math.floor(((t.getHours() + 1) % 24) / 2) % 12,
	},
	{
		id: "shichen",
		label: "时辰",
		words: SHICHEN,
		radius: 0.755,
		size: 0.062,
		current: (t) => Math.floor(((t.getHours() + 1) % 24) / 2) % 12,
	},
	{
		id: "yueling",
		label: "月令",
		words: YUELING,
		radius: 0.6,
		size: 0.058,
		current: (t) => t.getMonth(),
	},
];

/** 字帖上飘的四句话。翻到就展开一行，再点折起。 */
export const PHRASES = [
	"流年不语，灯影自明",
	"旧梦无声，光阴有痕",
	"少年一瞬，人间经年",
	"墨落定年，灯转忆昔",
] as const;

/** 浮现出来的水墨画。图题只用在读屏与全屏落款上，不进画面。 */
export const PAINTINGS = [
	{ src: "/assets/images/dual/ink/ink-01.webp", title: "墨龙" },
	{ src: "/assets/images/dual/ink/ink-02.webp", title: "青绿·层峦" },
	{ src: "/assets/images/dual/ink/ink-03.webp", title: "金崖·孤亭" },
	{ src: "/assets/images/dual/ink/ink-04.webp", title: "朱砂·墨龙" },
	{ src: "/assets/images/dual/ink/ink-05.webp", title: "蓝山·望月" },
	{ src: "/assets/images/dual/ink/ink-06.webp", title: "云海·晨光" },
	{ src: "/assets/images/dual/ink/ink-07.webp", title: "金缕·群山" },
	{ src: "/assets/images/dual/ink/ink-08.webp", title: "赤日·宫阙" },
	{ src: "/assets/images/dual/ink/ink-09.webp", title: "紫云·仙阙" },
	{ src: "/assets/images/dual/ink/ink-10.webp", title: "蓝湖·远岫" },
	{ src: "/assets/images/dual/ink/ink-11.webp", title: "金殿·灯影" },
	{ src: "/assets/images/dual/ink/ink-12.webp", title: "夜湖·金鳞" },
	{ src: "/assets/images/dual/ink/ink-13.webp", title: "玄金·孤峰" },
	{ src: "/assets/images/dual/ink/ink-14.webp", title: "飞瀑·烟峦" },
] as const;

/**
 * ⚠️ **素材占位**：胶卷里那些"照片"还没给，这里暂时借用上面这 14 张水墨画。
 * 换成真图时只动这一个数组 —— 帧的尺寸、纹理、层序都不用碰。
 */
export const FILM_FRAMES: {
	src: string;
	title: string;
	placeholder: boolean;
}[] = PAINTINGS.map((p) => ({ src: p.src, title: p.title, placeholder: true }));

/** 全屏帧的五种极简滤镜。只作用在放大后的那一帧上，帧外的画面不受影响。 */
export const FRAME_FILTERS = [
	{
		id: "vintage",
		label: "复古",
		css: "sepia(0.4) saturate(1.12) contrast(1.05) brightness(1.02)",
	},
	{
		id: "cold",
		label: "冷调",
		css: "saturate(0.84) hue-rotate(-14deg) brightness(1.05) contrast(1.04)",
	},
	{
		id: "gold",
		label: "暖金",
		css: "sepia(0.32) saturate(1.5) hue-rotate(-8deg) brightness(1.05)",
	},
	{
		id: "mono",
		label: "黑白",
		css: "grayscale(1) contrast(1.12) brightness(1.02)",
	},
	{
		id: "jade",
		label: "青绿",
		css: "saturate(1.32) hue-rotate(26deg) contrast(1.06)",
	},
] as const;

/** 汉字刻度环一圈有几格（三个环共用，几何才对得齐）。 */
export const RING_STEPS = 12;
