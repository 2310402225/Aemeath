/**
 * 潮声庆典 · 全息典藏（非官方）—— 六张全息卡的元数据。
 *
 * 卡面本体由 RuiC-card-skill 的 Blender 流水线离线产出：
 * 五层图层（subject / effects / background / lineart / text）→ GLB + 观看器。
 * 这里只描述「读哪个文件、印什么字、什么色调」，渲染逻辑在 holo-viewer.ts。
 *
 * 素材版权归库洛游戏所有，此处仅个人收藏与展示，不商用。
 */

export type Finish = "pearl" | "silver" | "gold" | "original";

export interface HoloCardMeta {
	/** 与 public/assets/cards/ 下的目录同名 */
	readonly id: string;
	readonly title: string;
	/** 卡片下方的拉丁名（海报未给出官方英文名，用拼音/音译） */
	readonly latin: string;
	readonly edition: string;
	/** 海报上若有台词就印在卡面下方，没有就留空 */
	readonly tagline: string;
	/** 轨道光晕与中心球取色的两端 */
	readonly accent: readonly [string, string];
	/** 中心球在悬停该卡时偏向的色相（度） */
	readonly hue: number;
}

export const COLLECTION = "潮声庆典 · 全息典藏（非官方）";
export const SUBTITLE = "鸣潮 · WUTHERING WAVES";
export const CREDIT =
	"同人二次创作，素材版权归库洛游戏所有，仅个人收藏与展示。";

export const CARDS: readonly HoloCardMeta[] = [
	{
		id: "01-jinxi",
		title: "今汐",
		latin: "JINXI",
		edition: "01 / 06",
		tagline: "",
		accent: ["#9CC1CB", "#EAEFEF"],
		hue: 198,
	},
	{
		id: "02-katixiya",
		title: "卡提希娅",
		latin: "CARTETHYIA",
		edition: "02 / 06",
		tagline: "",
		accent: ["#8594BB", "#C2D2E7"],
		hue: 228,
	},
	{
		id: "03-aimisi",
		title: "爱弥斯",
		latin: "AEMEATH",
		edition: "03 / 06",
		tagline: "但愿我会让你感到骄傲，但愿我没有让你失望。",
		accent: ["#ACBCDA", "#DAC9DC"],
		hue: 252,
	},
	{
		id: "04-feixue",
		title: "绯雪",
		latin: "FEIXUE",
		edition: "04 / 06",
		tagline: "深空联合的大义的确是正确，但我更能理解你想要拯救某人的这份心情。",
		accent: ["#A79CBE", "#E1DCEF"],
		hue: 268,
	},
	{
		id: "05-xin",
		title: "心",
		latin: "XIN",
		edition: "05 / 06",
		tagline: "同赏人间欢喜，共守……灯火长明。",
		accent: ["#E6BB8B", "#C4553A"],
		hue: 28,
	},
	{
		id: "06-shouanren",
		title: "守岸人",
		latin: "SHOREKEEPER",
		edition: "06 / 06",
		tagline: "",
		accent: ["#99A1BB", "#D1D9E7"],
		hue: 214,
	},
];

export function cardBase(id: string): string {
	return `/assets/cards/${id}`;
}

/** 轨道小卡与 overlay 占位用的静态图（不含任何运行时依赖） */
export function cardThumb(id: string): string {
	return `${cardBase(id)}/thumb.webp`;
}

export function cardPoster(id: string): string {
	return `${cardBase(id)}/poster.webp`;
}

/** 交给 holo-viewer 的运行时配置，字段与 Blender 流水线写出的 card-config.json 一一对应 */
export function viewerConfig(card: HoloCardMeta) {
	const base = cardBase(card.id);
	return {
		title: card.title,
		subtitle: SUBTITLE,
		technique: card.latin,
		edition: card.edition,
		collection: COLLECTION,
		description: CREDIT,
		assets: {
			model: `${base}/card.glb`,
			subject: `${base}/subject.webp`,
			background: `${base}/background.webp`,
			text: `${base}/text.webp`,
			lineart: `${base}/lineart.webp`,
			effects: `${base}/effects.webp`,
			back: `${base}/back.webp`,
		},
		parameters: {
			subjectScale: 1.25,
			subjectDepth: 0.4,
			backgroundDepth: -0.25,
			effectsDepth: 0.5,
			foil: 0.65,
		},
		safeArea: { scale: 1.12, offset: [-0.06, -0.085] as [number, number] },
		// 上游观看器的 WebGL 分支默认落在珠光，但 HTML 里印的默认标签是烫金；
		// 这里显式钉成烫金，跟 HoloCard 的控件初值对齐（否则首帧画面与高亮色板打架）。
		appearance: { finish: "gold" as const, background: "#0b1020" },
	};
}
