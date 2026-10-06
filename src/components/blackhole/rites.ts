// 法阵：随机库 + 完整生命周期。这就是 spec 里那条闭环：
//   生成（由内向外展开）→ 立体升起 → 顶峰停留 → 从外向内解体 → 被黑洞引力牵引 → 吞噬 → 黑洞脉冲
//
// 三条工程底线：
//   · 图元在生成时**一次性抽样成折线**（`Wire`），之后画的时候只在折线上走。这样"逐段绘制"
//     （由内向外点亮 / 由外向内断裂）与"前后半分开画（深度分层）"两件事都能用同一段代码做完，
//     不必为圆环、多边形、放射线、椭圆各写一套进度逻辑。
//   · 粒子是**全局池**（上限 800），被吞掉的粒子当场改造成一粒短命闪光接着用 —— 池子不涨。
//   · 解体不许原地消失：图元断掉的那一刻是把它的折线交给粒子系统，改由引力往黑洞里送。

import {
	clamp,
	type Hole,
	lerp,
	type Phase,
	project,
	RITE_K,
	rngOf,
	type Shared,
	type Stage,
	smoothstep,
	type View,
} from "./state";

const TAU = Math.PI * 2;
/**
 * 碎片/粒子的引力系数：径向加速度 = ACC / max(70, 距离)。
 * ⚠️ 这个值是**扫出来的**：太小（如 92000）远场只有 ~90px/s²，配上阻尼要十几秒才能爬进视界，
 * 碎片早就在半路过期了；360000 时实测 d0=300/700/1100px 分别在 0.6/2.7/5.1 秒内被吞掉。
 */
const ACC = 360000;
/** 粒子池上限（spec：总量不超过 800，被吞的立即回收） */
const MAX_SPARKS = 800;

/** 主色五档（spec §八）：幽青、钴蓝、暗紫、银灰、暗金。 */
const PALETTE: { name: string; rgb: [number, number, number] }[] = [
	{ name: "幽青", rgb: [96, 226, 214] },
	{ name: "钴蓝", rgb: [96, 148, 255] },
	{ name: "暗紫", rgb: [172, 118, 255] },
	{ name: "银灰", rgb: [198, 208, 228] },
	{ name: "暗金", rgb: [216, 174, 100] },
];
const COLD: [number, number, number] = [228, 240, 255];
const CRIMSON: [number, number, number] = [206, 74, 78];

/**
 * 主色往冷白里和。
 * 🔴 设定图里**每一张法阵都是单色 ＋ 白高光**，没有第二色相 —— 原来的 `rgb2` 十有七八
 *    取的是固定的冷白 `COLD`，于是"暗金阵"会变成金 ＋ 冰蓝两种色相拼在一起，
 *    一眼就是"配色没定"。副色现在一律从主色调亮，色相统一、亮度分层。
 */
function lighten(
	c: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(c[0] + (COLD[0] - c[0]) * t),
		Math.round(c[1] + (COLD[1] - c[1]) * t),
		Math.round(c[2] + (COLD[2] - c[2]) * t),
	];
}

/**
 * 十三种阵型（spec §三 的随机库 + 照着 `blog/` 那 16 张设定图补的六个）。
 * **索引就是 `kind`**，`buildSigil` 按它分支 —— 所以下面那张"哪几号属于哪一档"的
 * 索引表只能改内容、不能改顺序。
 */
const KINDS = [
	"三重圆环阵",
	"六芒星几何阵",
	"月相仪式阵",
	"裂纹封印阵",
	"时空折叠阵",
	"幽青八芒阵",
	"暗金星轨阵",
	// ↓ 后六个是照着 `blog/` 根目录那 16 张法阵设定图补的（星网 / 八卦罗盘 / 莲花 /
	//   卫星盘 / 玫瑰涡 / 尖芒星）—— 前七号是原规格点名的库，顺序不能动，
	//   所以新阵型一律**追加在尾部**，靠 `BASE_KINDS` 决定谁属于基础库。
	"太极八卦阵",
	"莲花法阵",
	"符文卫星阵",
	"玫瑰涡阵",
	"尖芒星阵",
	"星网阵列",
] as const;

/**
 * 法阵库分级（spec §三）：
 *   基础库（1 阶就有）＝ 三重圆环阵 / 月相仪式阵 / 裂纹封印阵 / 暗金星轨阵
 *   高阶库（**4 阶曜变**才解锁）＝ 六芒星几何阵 / 幽青八芒阵 / 时空折叠阵
 * ⚠️ `KINDS` 的顺序是历史顺序（`buildSigil` 认它），所以这里用**索引表**而不是重排数组。
 */
const BASE_KINDS = [0, 2, 3, 6] as const;
/** 粒子密度系数（spec §2.3：2 阶 +50%、8 阶翻倍）。法阵粒子与解体碎片共用。 */
const densityK = (stage: Stage) => (stage >= 8 ? 2 : stage >= 2 ? 1.5 : 1);

/**
 * 台面高度剖面：**几乎同一高度**（0.94~1.0，单位是升起高度 `riseH`）。
 * 🔴 原来是 0.04~0.84 的四层大台阶 —— 那样确实"立体"，但同心环、星形、弦网会被抬得
 *    互相错位，整座法阵读不成**一个图形**（"法阵不还原"就是这个）。
 *    设定图里那些法阵全是**同一平面上的完整曼陀罗**，所以盘面必须基本共面。
 *    立体感改由**盘厚**给：外圈一圈侧壁 ＋ 一圈立齿（见 `skirt` / `fins`）。
 */
function tierOf(rank: number): number {
	if (rank >= 0.9) return 0.94;
	if (rank >= 0.68) return 0.96;
	if (rank >= 0.42) return 0.98;
	return 1;
}

/** 盘面高度：占 `riseH` 的比例。盘面上的一切都在这一层。 */
const DECK = 1;
/**
 * 盘底高度：外圈侧壁往下走这么深 —— `DECK - BODY` 就是"盘有多厚"。
 * 🔴 厚度**要薄**。原来给 0.58（厚度 = 0.42·riseH，最大 0.18R）实测读出来是**一只鼓**
 *    —— 侧壁比盘面上任何结构都抢眼，整座阵变成"扣在碗里的图案"。参考图里那些法阵是
 *    **薄盘**：厚度只是"这不是一张贴纸"的最低限度的证据。
 */
const BODY = 0.78;

// ─────────────────────────────────────────── 装饰单元路径库
//
// 参考图的"精致"有一半来自**边饰**：每一张法阵的环上都骑着一圈同款的卷草/花叶/垂坠，
// 8~16 枚等分排布、字头朝外。手写一套单元路径、之后按角度 stamp 出去，比逐枚硬编码省得多，
// 而且"同款重复"本身就是"这是法器而不是涂鸦"的读感来源。
//
// 单元坐标系：**x 从 0（根部，贴环）指向 1（尖端，朝外）**，y 是切向，范围约 ±0.5。
// stamp 时按"该枚所在的角度"整体旋转 + 平移，所以同一套路径在任何半径上都不用改。

/** 三次贝塞尔采样。装饰曲线全靠它拼 —— 手写点列不够顺。 */
function bez(
	p0: [number, number],
	p1: [number, number],
	p2: [number, number],
	p3: [number, number],
	n = 10,
): number[] {
	const out: number[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const u = 1 - t;
		const a = u * u * u;
		const b = 3 * u * u * t;
		const c = 3 * u * t * t;
		const d = t * t * t;
		out.push(
			a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
			a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
		);
	}
	return out;
}

/** 若干条子折线接成一条（装饰常常是"一笔折几道"，接起来才能一次描完）。 */
const cat = (...parts: number[][]): number[] => parts.flat();

/** 半径递减的螺线 —— 装饰端头那个"卷"。 */
function curl(
	cx: number,
	cy: number,
	r0: number,
	from: number,
	turns: number,
	n = 18,
): number[] {
	const out: number[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const a = from + t * turns * Math.PI * 2;
		const rr = r0 * (1 - t * 0.8);
		out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
	}
	return out;
}

/** 三叶鸢尾（参考图 927f / 1c0db 的边饰主款）。 */
const ORN_FLEUR = cat(
	bez([0, 0], [0.3, -0.07], [0.72, -0.07], [1, 0], 12),
	bez([1, 0], [0.72, 0.07], [0.3, 0.07], [0, 0], 12),
	bez([0.16, 0], [0.02, -0.28], [0.32, -0.44], [0.64, -0.3], 10),
	bez([0.16, 0], [0.02, 0.28], [0.32, 0.44], [0.64, 0.3], 10),
	[0, 0, -0.24, 0, -0.24, 0.15],
);

/** 三瓣花（花头收在尖端）。 */
const ORN_TREFOIL = cat(
	[0, 0, 0.34, 0],
	bez([0.34, 0], [0.5, -0.32], [0.98, -0.28], [0.96, 0], 10),
	bez([0.96, 0], [0.94, 0.28], [0.5, 0.32], [0.34, 0], 10),
	bez([0.62, -0.02], [0.56, -0.34], [0.8, -0.58], [1.0, -0.46], 8),
	bez([0.62, 0.02], [0.56, 0.34], [0.8, 0.58], [1.0, 0.46], 8),
);

/** 卷草（一笔茎 + 端头一卷 + 一片反向小叶）。 */
const ORN_SCROLL = cat(
	bez([0, 0], [0.26, -0.02], [0.46, -0.06], [0.58, -0.18], 8),
	curl(0.62, -0.2, 0.3, -Math.PI * 0.15, 1.85),
	bez([0.3, -0.03], [0.36, 0.18], [0.52, 0.24], [0.64, 0.12], 8),
);

/** 对生双叶。 */
const ORN_LEAF = cat(
	[0, 0, 0.66, 0],
	bez([0.1, 0], [0.26, -0.32], [0.54, -0.32], [0.66, 0], 10),
	bez([0.66, 0], [0.5, -0.15], [0.28, -0.13], [0.1, 0], 10),
	bez([0.1, 0], [0.26, 0.32], [0.54, 0.32], [0.66, 0], 10),
	bez([0.66, 0], [0.5, 0.15], [0.28, 0.13], [0.1, 0], 10),
);

/** 垂坠（参考图环外挂下来的那些小坠子）。 */
const ORN_TASSEL = cat(
	[0, 0, 0.34, 0],
	[0.34, 0, 0.54, -0.1, 0.74, 0, 0.54, 0.1, 0.34, 0],
	[0.74, 0, 0.9, 0],
	[0.9, 0, 0.9, 0.14, 1.0, 0.22],
	[1.0, 0.22, 0.9, 0.22, 0.9, 0.14],
);

/** 尖碑 / 剑（尖芒星、封印阵的立碑用）。 */
const ORN_BLADE = cat(
	[0, -0.08, 0.4, -0.12, 0.76, -0.06, 1, 0],
	[1, 0, 0.76, 0.06, 0.4, 0.12, 0, 0.08, 0, -0.08],
	[0.3, -0.1, 0.3, 0.1],
);

/** 六款装饰。索引就是 `rim()` 的款式号，顺序可按阵型挑。 */
const ORN: number[][] = [
	ORN_FLEUR,
	ORN_TREFOIL,
	ORN_SCROLL,
	ORN_LEAF,
	ORN_TASSEL,
	ORN_BLADE,
];

/** 铭文字库：只用 ASCII 大写 + 数字 + 几个安全符号（CJK 依赖系统回退，回退失败就是豆腐块）。 */
const RUNE_POOL = "AIEBCODLMFNGHKPVRXSTYZ·0123456789·+×";
/** 罗盘/八卦款：罗马数字 + 十二支的拉丁转写，读起来更像"刻度铭文"。 */
const RUNE_ROMAN = "IVXLCDM·IVXLCDM··ABCDEFGHIKLM·";

/** 折线的 tint：0 主色 / 1 副色（冷白） / 2 猩红（只给裂纹用，少量） */
type Tint = 0 | 1 | 2;

/** 附带细纹（`Wire.extra` 的元素）：一条独立子折线 ＋ 它自己的逐点高度。 */
type Sub = {
	/** 扁平坐标，与 `Wire.pts` 同一套局部坐标（原点在法阵中心） */
	p: number[];
	/** 逐点高度（占 `riseH` 的比例），省则用主折线的 `z` */
	zs?: number[];
};

type Wire = {
	/** 扁平坐标 [x0,y0,x1,y1,…]，原点在法阵中心、单位像素 */
	pts: number[];
	/**
	 * 立体高度，**单位 = 升起高度 `riseH`**（0 = 贴在台面、1 = 台顶）。升起时按 `lift` 放大。
	 * 🔴 单位必须是"占 riseH 的比例"，不能写像素：这一页原来 `zOf` 返回 0.16~1.0 而
	 *    绘制处只做 `w.z * lift`，于是高度是 **0.1~1.0 像素** —— 整座法阵在视觉上
	 *    完全是平的（"立体感没体现"的根因就在这一行）。现在统一乘 `r.riseH`。
	 */
	z: number;
	/**
	 * 逐点高度（可省），给了就覆盖 `z`：两端不同 = 一道**坡**，
	 * 两端同 x/y 不同高 = 一片**竖刃**（投影里就是一条竖线 = 有厚度）。
	 */
	zs?: number[];
	/**
	 * 一起描的**附带细纹**（可省）：`strokeWire` 把它们与主折线塞进**同一个 path**，
	 * 最后只 `stroke()` **一次**。
	 * 🔴 这是"密度"唯一的正确来源。设定图里每张法阵都有几百条细纹（外圈齿、放射线、
	 *    一圈小节点），逐条描就是几百次 `stroke()`（还会在 `lighter` 下把端点叠成珠子）。
	 * **一批同色同宽同高的细纹永远合成一条。**
	 */
	extra?: Sub[];
	/** 闭合**填充**（菱形/三角/星面）。有它就只 `fill()` 不描边 —— 线给"形"，面给"量"。 */
	fill?: boolean;
	/** 占外圈半径的比例 0..1：由内向外展开、由外向内解体都读它 */
	rank: number;
	tint: Tint;
	/** 符文节点：画成小晶体，不是线段 */
	glyph: boolean;
	/** 已经断掉了（解体时只触发一次） */
	broke: boolean;
	/** 基础亮度 */
	base: number;
};

export type Rite = {
	id: number;
	name: string;
	kind: number;
	/** 当前中心（含拖动与漂移） */
	cx: number;
	cy: number;
	R: number;
	riseH: number;
	/** 吞噬速度档（1 = 快档） */
	speed: number;
	spin: number;
	spinV: number;
	rgb: [number, number, number];
	rgb2: [number, number, number];
	wires: Wire[];
	/** 环上的铭文（`fillText`，不进折线体系、不占 `stroke` 预算） */
	txts: Txt[];
	/** 盘面上方的悬浮光环 */
	rings: Ring3[];
	phase: Phase;
	/** 当前阶段已经过了多少秒 */
	t: number;
	dur: number;
	/** 0..1：展开度（生成阶段）/ 升起度 / 解体度 —— 同一个数在不同阶段各读各的 */
	u: number;
	drift: boolean;
};

/**
 * 铭文环上的一枚字。参考图里**每一张**法阵都有一圈沿环排布的铭文 —— 这是"精致"里
 * 性价比最高的一笔：几十个字符沿环内切排布、字头朝外，一眼就是"刻上去的文字环"，
 * 而成本只有 N 次 `fillText`（不占 `stroke` 预算，也不进 `Wire` 的折线体系）。
 * ⚠️ 字只用 **ASCII 大写 + 数字 + `·×+`**：CJK 依赖系统字体回退，回退失败就是一片豆腐块。
 */
type Txt = {
	ch: string;
	/** 角度（弧度）。逐帧再叠上 `r.spin` */
	a: number;
	/** 半径（像素） */
	r: number;
	/** 字号（像素） */
	size: number;
	/** 高度（占 `riseH` 的比例） */
	z: number;
	rank: number;
	tint: Tint;
	base: number;
};

/**
 * 悬浮轨道环：**在盘面上方**（`z` > `DECK`）倾斜着转的一圈细光环。
 * 参考图的 in-world 版本里全都有它（654686 / 6bb2c / 1c0db 右下角 / 73df130 顶图），
 * 是"这是一个立体法阵"最直接的一笔，也是盘面读成"实体"而不是"贴纸"的第二依据。
 * ⚠️ 不必做真三维：绕 x 轴倾斜 φ 之后投影出来就是一条 `ry = r·(cosφ·k − sinφ)` 的椭圆，
 *    直接当椭圆画。`flat` 取负 = 翻到盘面的另一侧（看起来像向下的环）。
 * ⚠️ **正圆环转起来看不见** → 必须靠"缺口 + 珠"给转速（见 `draw`），不能只画一整圈。
 */
type Ring3 = {
	r: number;
	/** 高度（占 `riseH` 的比例，> DECK 才在盘面上方） */
	z: number;
	/** 投影后的纵向半径比（可正可负） */
	flat: number;
	/** 自转速度系数与初相 */
	k: number;
	ph: number;
	width: number;
	rank: number;
	tint: Tint;
	base: number;
};

type Spark = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	t: number;
	life: number;
	rgb: [number, number, number];
	kind: "shard" | "flow" | "rise" | "fog" | "flash";
};

export type Rites = {
	resize(view: View): void;
	/** 点一下生成一座法阵。位置太挤 / 冷却没到 → 返回 false。 */
	spawn(x: number, y: number, s: Shared, view: View, hole: Hole): boolean;
	/** 推进所有法阵与粒子。返回**本次被吞掉的法阵数**（交接线层去触发黑洞脉冲）。 */
	update(dt: number, view: View, hole: Hole, s: Shared): number;
	/** 画法阵层与粒子层。深度分层靠"算深度"，两层都从 `project()` 出。 */
	draw(
		g: CanvasRenderingContext2D,
		gs: CanvasRenderingContext2D,
		view: View,
		s: Shared,
	): void;
	/**
	 * 视界坍缩脉冲的"主动献祭"：**跳过停留**，全场法阵一起进入解体（spec §2.2）。
	 * 解体比自然那趟快一档 —— 全场同时塌才有"共振"的意思，各按各的节奏就散了。
	 */
	forceDissolve(): void;
	/** 命中：返回最合适被拖的那座法阵下标（−1 = 没有）。精度优先见 `grab`。 */
	grab(x: number, y: number): number;
	drag(i: number, x: number, y: number): void;
	release(i: number): void;
	count(): number;
	newest(): Rite | null;
	/** 点击的涟漪：一圈冲击波 + 把星尘往外推一下 */
	shock(x: number, y: number, power: number): void;
	clear(): void;
};

export function createRites(): Rites {
	let view: View = { w: 1, h: 1, dpr: 1, k: 0.42 };
	let rites: Rite[] = [];
	let sparks: Spark[] = [];
	let shockRing: { x: number; y: number; t: number } | null = null;
	let nextId = 1;
	let cooldown = 0;
	let time = 0;
	// ⚠️ 种子必须来自时钟：形状在 spawn 那一刻抽样一次就**存进 `wires`**，之后每帧只是重画同一份点。
	//    所以"可复现"要的是"同一座法阵前后帧不抖"，而不是"每次打开都长一样" —— 写死 1337 的话，
	//    每次刷新页面的**第一座**法阵永远是同一个阵型（用户的观感就是"没随机"）。
	let nextSeed = (Date.now() ^ 0x9e3779b9) >>> 0;

	// ─────────────────────────────────────────── 图元抽样

	const circle = (r: number, n: number, from = 0, sweep = TAU): number[] => {
		const pts: number[] = [];
		for (let i = 0; i <= n; i++) {
			const a = from + (sweep * i) / n;
			pts.push(Math.cos(a) * r, Math.sin(a) * r);
		}
		return pts;
	};

	const ellipse = (
		rx: number,
		ry: number,
		rot: number,
		n: number,
		sweep = TAU,
		from = 0,
	): number[] => {
		const c = Math.cos(rot);
		const s = Math.sin(rot);
		const pts: number[] = [];
		for (let i = 0; i <= n; i++) {
			const a = from + (sweep * i) / n;
			const x = Math.cos(a) * rx;
			const y = Math.sin(a) * ry;
			pts.push(x * c - y * s, x * s + y * c);
		}
		return pts;
	};

	const poly = (r: number, sides: number, rot: number): number[] => {
		const pts: number[] = [];
		for (let i = 0; i <= sides; i++) {
			const a = rot + (TAU * i) / sides;
			pts.push(Math.cos(a) * r, Math.sin(a) * r);
		}
		return pts;
	};

	/** 把一组局部点整体平移（拼合图形用）。 */
	const move = (pts: number[], cx: number, cy: number): number[] => {
		for (let i = 0; i < pts.length; i += 2) {
			pts[i] = (pts[i] ?? 0) + cx;
			pts[i + 1] = (pts[i + 1] ?? 0) + cy;
		}
		return pts;
	};

	/**
	 * 星形折线：n 个顶点、每次跳 `step` 格。5/2 = 五芒、8/3 = 八芒 —— 这两种
	 * `gcd(n,step)=1`，一笔连完，是**一条** wire。
	 *
	 * ⚠️ 但 6/2 这种 `gcd(n,step)=m>1` 的跳法**会走成 m 个各自闭合的小环**：
	 *    从 0 出发只够到 {0,2,4}（一个正三角），跑完 n 步回到 0 就停了，
	 *    {1,3,5} 那半圈**根本不经过** —— 于是"六芒星"画出来是一个三角形。
	 *    正确做法是把 m 条闭合链分开走（六芒 = 两个三角，互错 60°），**合起来**才是六芒。
	 *    `step` 与 `n` 互质时 m=1，与老写法完全一致。
	 */
	const stars = (
		r: number,
		n: number,
		step: number,
		rot: number,
		z: number,
		rank: number,
		tint: Tint,
		base: number,
	): Wire[] => {
		let g = n;
		for (let b = step; b; ) {
			const t = g % b;
			g = b;
			b = t;
		}
		const out: Wire[] = [];
		const per = n / g;
		for (let s = 0; s < g; s++) {
			const pts: number[] = [];
			let i = s;
			for (let k = 0; k <= per; k++) {
				const a = rot + (TAU * i) / n;
				pts.push(Math.cos(a) * r, Math.sin(a) * r);
				i = (i + step) % n;
			}
			out.push(wire(pts, z, rank, tint, base));
		}
		return out;
	};

	/** 弦网：把 n 边形顶点按 `step` 格两两连起来 —— 参考图里"星上再分格"的那种网。 */
	const web = (
		r: number,
		n: number,
		step: number,
		rot: number,
		z: number,
		rank: number,
		tint: Tint,
		base: number,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a0 = rot + (TAU * i) / n;
			const a1 = rot + (TAU * (i + step)) / n;
			out.push(
				wire(
					[
						Math.cos(a0) * r,
						Math.sin(a0) * r,
						Math.cos(a1) * r,
						Math.sin(a1) * r,
					],
					z,
					rank,
					tint,
					base,
				),
			);
		}
		return out;
	};

	/** 刻度带：r0→r1 之间一圈短径向线（罗盘 / 表盘那圈"尺"）。 */
	const band = (
		r0: number,
		r1: number,
		n: number,
		rot: number,
		z: number,
		rank: number,
		base = 0.5,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const c = Math.cos(a);
			const s = Math.sin(a);
			out.push(wire([c * r0, s * r0, c * r1, s * r1], z, rank, 1, base));
		}
		return out;
	};

	/** 坡道：r0(低) → r1(高) 的斜撑 —— 把上下两层台阶连起来，是"立体"的主要来源之一。 */
	const ramps = (
		r0: number,
		r1: number,
		z0: number,
		z1: number,
		n: number,
		rot: number,
		rank: number,
		base = 0.7,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const c = Math.cos(a);
			const s = Math.sin(a);
			out.push(
				wire([c * r0, s * r0, c * r1, s * r1], z0, rank, 0, base, [z0, z1]),
			);
		}
		return out;
	};

	/**
	 * 立鳍 / 立碑：环上 n 处各立一片竖直的刃（平面位置相同、只差高度）。
	 * 🔴 这是"立体感"最直接的来源之一 —— 一片竖起来的刃在投影里就是一条竖线，
	 *    一眼就知道这东西有厚度，而平躺的环不管画多少圈都读成一张贴纸。
	 */
	const fins = (
		r: number,
		n: number,
		h: number,
		rot: number,
		rank: number,
		tint: Tint,
		base = 0.75,
		z0 = 0.28,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const x = Math.cos(a) * r;
			const y = Math.sin(a) * r;
			out.push(wire([x, y, x, y], z0, rank, tint, base, [z0, z0 + h]));
		}
		return out;
	};

	/** 星刺：一圈朝外的尖芒（细长三角，读成"刺"而不是"线"）。 */
	const spikes = (
		r0: number,
		r1: number,
		n: number,
		rot: number,
		z: number,
		base: number,
	): Wire[] => {
		const out: Wire[] = [];
		const dA = 0.055;
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			out.push(
				wire(
					[
						Math.cos(a - dA) * r0,
						Math.sin(a - dA) * r0,
						Math.cos(a) * r1,
						Math.sin(a) * r1,
						Math.cos(a + dA) * r0,
						Math.sin(a + dA) * r0,
					],
					z,
					1,
					0,
					base,
				),
			);
		}
		return out;
	};

	/** 卫星盘：一圈小圆盘（挂在环上的小法阵，参考图 10 / 13）。 */
	const satellites = (
		r: number,
		n: number,
		size: number,
		rot: number,
		rank: number,
		tint: Tint,
		base = 0.8,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const cx = Math.cos(a) * r;
			const cy = Math.sin(a) * r;
			out.push(
				wire(move(circle(size, 20), cx, cy), tierOf(rank), rank, tint, base),
			);
			const dot = wire([cx, cy], tierOf(rank), rank, 1, base);
			dot.glyph = true;
			out.push(dot);
		}
		return out;
	};

	/** 涡线：阿基米德螺线（参考图 11 那种一圈圈收进去的玫瑰涡）。 */
	const spiral = (
		r0: number,
		r1: number,
		turns: number,
		rot: number,
		rank: number,
		tint: Tint,
		base = 0.8,
	): Wire => {
		const n = Math.max(24, Math.round(turns * 34));
		const pts: number[] = [];
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			const a = rot + t * turns * TAU;
			const r = r0 + (r1 - r0) * t;
			pts.push(Math.cos(a) * r, Math.sin(a) * r);
		}
		return wire(pts, tierOf(rank), rank, tint, base);
	};

	/**
	 * 把一条**平躺**的曲线往里抬成一座浅漏斗（逐点高度 `zs`）。
	 * 🔴 原来是"披到台阶上"（`tierOf(离中心多远)`）—— 那是台面还是四层大阶梯的时候写的。
	 *    盘面改成基本共面之后 `tierOf` 只给 0.94~1.0 的起伏，`drape` 等于**什么都没做**，
	 *    于是涡线整条躺在同一层、投影里读成**一圈套一圈的同心圆**（"看起来杂"的头号来源）。
	 *    现在改成"中心高、外圈低"的**锥面**（0.86 → 1.0）：涡线有了"往中心旋进去"的深度，
	 *    同一个形状立刻读得出层次。⚠️ 0.14 是上限 —— 再深涡线会从盘面里戳出来。
	 */
	const drape = (w: Wire, R: number): Wire => {
		const zs: number[] = [];
		for (let i = 0; i < w.pts.length / 2; i++) {
			const x = w.pts[i * 2] ?? 0;
			const y = w.pts[i * 2 + 1] ?? 0;
			const t = clamp(1 - Math.hypot(x, y) / R, 0, 1);
			zs.push(0.86 + 0.14 * t);
		}
		return { ...w, zs };
	};

	/** 花瓣环：n 片朝外的花瓣（每片是一个小椭圆的整圈）。 */
	const petals = (
		r: number,
		n: number,
		len: number,
		rot: number,
		rank: number,
		tint: Tint,
		base = 0.75,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			out.push(
				wire(
					move(
						ellipse(len, len * 0.42, a, 20),
						Math.cos(a) * r,
						Math.sin(a) * r,
					),
					tierOf(rank),
					rank,
					tint,
					base,
				),
			);
		}
		return out;
	};

	/** 卷草钩：n 处一枚小卷（参考图 05 / 08 那种边饰），沿切线方向卷出去。 */
	const hooks = (
		r: number,
		n: number,
		len: number,
		rot: number,
		rank: number,
		tint: Tint,
		base = 0.55,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			out.push(
				wire(
					move(
						ellipse(len, len * 0.62, a + Math.PI / 2, 12, 4.0),
						Math.cos(a) * r,
						Math.sin(a) * r,
					),
					tierOf(rank),
					rank,
					tint,
					base,
				),
			);
		}
		return out;
	};

	/** 短横（爻）：半径 r 上、角度 a0→a1 之间的一小段弦。八卦那三条爻就用它。 */
	const bar = (
		r: number,
		a0: number,
		a1: number,
		z: number,
		rank: number,
	): Wire =>
		wire(
			[Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r],
			z,
			rank,
			1,
			0.8,
		);

	/** 裂纹：从 r0 锯齿状爬到 r1（封印被激活的样子）。 */
	const crack = (
		r0: number,
		r1: number,
		rot: number,
		rand: () => number,
		tint: Tint,
		z: number,
		rank: number,
	): Wire => {
		const steps = 7;
		const pts: number[] = [];
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const r = lerp(r0, r1, t);
			const a = rot + (rand() - 0.5) * 0.42;
			pts.push(Math.cos(a) * r, Math.sin(a) * r);
		}
		return wire(pts, z, rank, tint, 0.95);
	};

	/** 符文节点：画成小晶体（升起来之后是立在环上的石柱/晶簇）。 */
	const glyphs = (
		r: number,
		n: number,
		rot: number,
		z: number,
		rank: number,
		base = 0.9,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const w = wire([Math.cos(a) * r, Math.sin(a) * r], z, rank, 1, base);
			w.glyph = true;
			out.push(w);
		}
		return out;
	};

	function wire(
		pts: number[],
		z: number,
		rank: number,
		tint: Tint,
		base: number,
		/** 逐点高度（可省）。给了就把这条折线读成坡 / 竖刃，见 `Wire.zs` */
		zs?: number[],
	): Wire {
		return { pts, z, rank, tint, glyph: false, broke: false, base, zs };
	}

	// ─────────────────────────────────────────── 阵型配方

	/**
	 * 阵型配方（十三个）。共用同一套骨架（见 `rim`）：**分层边饰带（含铭文/卷草/锯齿边）
	 * ＋ 满盘细放射线与斜织弦 ＋ 内圈花环 ＋ 盘心核 ＋ 盘厚**，再叠上每个阵型自己的几何体。
	 *
	 * 四条规矩（都是在这一页翻过车之后定下的）：
	 *   ① 盘面**必须基本共面**（`tierOf` 只给 0.94~1.0 的微小起伏）。设定图里的法阵全是
	 *      同一平面上的完整曼陀罗；盘面一抬高，同心环/星形/弦网就互相错位、读不成一个图形
	 *      —— 这是"法阵不还原"的第二个原因（第一个是 `RITE_K`）。
	 *   ② 加任何东西之前先问两件事：「**它会不会读成一圈同心圆**」（同心圆是"看起来杂"
	 *      的头号来源）和「**它该不该走 `extra` 合成一条**」（成批的短纹一律打包）。
	 *   ③ 一个阵型控制在 **≤65 条 wire**。每条要描两趟（辉光 + 芯），同屏三座就是三倍。
	 *      各阵型的线数在文件末尾记着。
	 *   ④ **盘内不许有纯黑的空底**。设定图里法阵是"一整个发光的场"，不是"黑盘上画亮线"；
	 *      只画线的话无论线多密，中间永远剩下几个黑洞（"看着劣质"的最后一块）。
	 *      填它的顺序是：发光场（`draw` 里那三层渐变）→ 细放射线/斜织弦（`radial`/`lattice`）
	 *      → 盘心核（`rim` 末尾那一下）。缺任何一层，眼睛都能看出"空"。
	 */
	function buildSigil(
		kind: number,
		R: number,
		rand: () => number,
		rings: number,
		nodes: number,
	): { wires: Wire[]; txts: Txt[]; rings: Ring3[] } {
		const out: Wire[] = [];
		const txts: Txt[] = [];
		const orbs: Ring3[] = [];
		const T = tierOf;

		/**
		 * 环上的铭文。参考图里每一张法阵都有一圈 —— 沿环内切排布、**字头朝外**。
		 * ⚠️ 用 `fillText` 而不是把字做成折线：字形轮廓要靠字体解析，代价不成比例。
		 *    代价是它不进 `Wire` 体系（不参与进度/解体），所以只当**边饰**用，
		 *    不给它承载信息；解体时整圈一起淡出即可。
		 */
		const runeRing = (
			r: number,
			n: number,
			size: number,
			rot: number,
			z: number,
			rank: number,
			tint: Tint,
			base: number,
			pool = RUNE_POOL,
		) => {
			for (let i = 0; i < n; i++) {
				txts.push({
					ch: pool[Math.floor(rand() * pool.length)] ?? "·",
					a: rot + (TAU * i) / n,
					r,
					size,
					z,
					rank,
					tint,
					base,
				});
			}
		};

		/**
		 * 把一族装饰单元路径按角度 stamp 到环上 —— **全部合成一条 `extra`**，只描一次。
		 * `mirror` 打开时相邻两枚左右镜像，读感立刻从"贴纸重复"变成"手绘套纹"。
		 */
		const ornRing = (
			path: number[],
			r: number,
			n: number,
			size: number,
			rot: number,
			z: number,
			rank: number,
			tint: Tint,
			base: number,
			mirror = 0,
		): Wire => {
			const subs: Sub[] = [];
			for (let i = 0; i < n; i++) {
				const a = rot + (TAU * i) / n;
				const ca = Math.cos(a);
				const sa = Math.sin(a);
				const flip = mirror && i % 2 ? -1 : 1;
				const p: number[] = [];
				for (let j = 0; j < path.length; j += 2) {
					const lx = (path[j] ?? 0) * size;
					const ly = (path[j + 1] ?? 0) * size * flip;
					p.push(ca * r + lx * ca - ly * sa, sa * r + lx * sa + ly * ca);
				}
				subs.push({ p });
			}
			return bundle(subs, z, rank, tint, base);
		};

		/**
		 * 外圈那圈**锯齿能量边**（参考图每张法阵外面都围着一道"电光"轮廓）。
		 * 一条 1 圈的闭合折线，240 点；锯齿由"每 5 点换一次跳变 + 一个缓慢正弦"叠出来。
		 * 1 条 wire、1 次 `stroke()` —— 这是整个边饰里性价比最高的一笔。
		 */
		const crackle = (
			r: number,
			n: number,
			amp: number,
			rot: number,
			z: number,
			rank: number,
			tint: Tint,
			base: number,
		): Wire => {
			const pts: number[] = [];
			let jit = 0;
			for (let i = 0; i <= n; i++) {
				// 🔴 跳变**每 4 点一次**（原来 5 点）：360 点上每段弧长只有 ~3.5px，
				//    4 点一换 = 每 ~14px 抖一次，读成"高频电流"；5 点一换就抖成"锯齿齿轮"了。
				if (i % 4 === 0) jit = rand() - 0.5;
				const a = rot + (TAU * i) / n;
				const rr = r * (1 + amp * jit + amp * 0.4 * Math.sin(i * 0.9));
				pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
			}
			return wire(pts, z, rank, tint, base);
		};

		/**
		 * 一批**一起描**的细纹：主折线留空，全部走 `extra` —— 一个阵型里成批的短纹
		 * （外圈齿、放射线、一圈小节点）都从这类图元出。
		 * 🔴 `stroke()` 只调一次。48 颗齿逐条描就是 48 次描边，`lighter` 下还会在端点叠成珠子。
		 */
		const bundle = (
			subs: Sub[],
			z: number,
			rank: number,
			tint: Tint,
			base: number,
		): Wire => ({ ...wire([], z, rank, tint, base), extra: subs });

		/** 外圈一圈**密齿**（罗盘那圈"尺"）。48 条 = 1 条 wire、1 次 `stroke()`。 */
		const teeth = (
			r0: number,
			r1: number,
			n: number,
			rot: number,
			tint: Tint = 1,
			base = 0.45,
		): Wire =>
			bundle(
				Array.from({ length: n }, (_, i) => {
					const a = rot + (TAU * i) / n;
					const c = Math.cos(a);
					const s = Math.sin(a);
					return { p: [c * r0, s * r0, c * r1, s * r1] };
				}),
				T(0.95),
				0.95,
				tint,
				base,
			);

		/**
		 * 满盘的**细放射线** —— 参考图里那层"织"出来的底纹（星形后面密密麻麻的蛛网）。
		 * 72 条 = 1 条 wire、1 次 `stroke()`。
		 * 🔴 它和"车轮"的区别**只有亮度和条数**：16~32 条又亮又等长的放射线是辐条；
		 *    72 条、亮度压到 0.1 的就是**织物**。所以这个函数只许给很低的 `base`。
		 */
		const radial = (
			r0: number,
			r1: number,
			n: number,
			rot: number,
			base = 0.22,
			tint: Tint = 0,
		): Wire =>
			bundle(
				Array.from({ length: n }, (_, i) => {
					const a = rot + (TAU * i) / n;
					const c = Math.cos(a);
					const s = Math.sin(a);
					return { p: [c * r0, s * r0, c * r1, s * r1] };
				}),
				T(0.6),
				0.6,
				tint,
				base,
			);

		/**
		 * 一层**斜织的弦**：把相邻两条放射线之间斜着连起来，正反两向都连。
		 * 参考图里星形外面那层蛛网就是它 —— 24 组 = 48 条 sub、**1 次 `stroke()`**。
		 * ⚠️ 亮度同样要低（0.09 量级）。它是**织物**，不是结构。
		 */
		const lattice = (
			r0: number,
			r1: number,
			n: number,
			rot: number,
			base: number,
			tint: Tint,
		): Wire => {
			const subs: Sub[] = [];
			for (let i = 0; i < n; i++) {
				const a0 = rot + (TAU * i) / n;
				const a1 = rot + (TAU * (i + 1)) / n;
				subs.push({
					p: [
						Math.cos(a0) * r0,
						Math.sin(a0) * r0,
						Math.cos(a1) * r1,
						Math.sin(a1) * r1,
					],
				});
				subs.push({
					p: [
						Math.cos(a1) * r0,
						Math.sin(a1) * r0,
						Math.cos(a0) * r1,
						Math.sin(a0) * r1,
					],
				});
			}
			return bundle(subs, T(0.62), 0.62, tint, base);
		};

		/** 一圈小节点圆（设定图里每颗星尖、每条齿根上那粒点）。24 颗 = 1 条 wire。 */ const dots =
			(r: number, n: number, size: number, rot: number): Wire =>
				bundle(
					Array.from({ length: n }, (_, i) => {
						const a = rot + (TAU * i) / n;
						return {
							p: move(circle(size, 8), Math.cos(a) * r, Math.sin(a) * r),
						};
					}),
					T(0.9),
					0.9,
					1,
					0.5,
				);

		/** 一圈**菱形面**（设定图里星尖、齿端那种小菱）。8 片 = 1 条 wire ＋ 1 次 `fill()`。 */
		const rhombs = (
			r: number,
			n: number,
			len: number,
			rot: number,
			tint: Tint = 1,
			base = 0.5,
		): Wire => ({
			...bundle(
				Array.from({ length: n }, (_, i) => {
					const a = rot + (TAU * i) / n;
					const c = Math.cos(a);
					const s = Math.sin(a);
					const w = len * 0.42;
					// 沿半径方向的菱形：外尖 → 侧尖 → 内尖 → 另一侧尖 → 回到外尖
					return {
						p: [
							c * (r + len),
							s * (r + len),
							c * r - s * w,
							s * r + c * w,
							c * (r - len),
							s * (r - len),
							c * r + s * w,
							s * r - c * w,
							c * (r + len),
							s * (r + len),
						],
					};
				}),
				T(0.95),
				0.95,
				tint,
				base,
			),
			fill: true,
		});

		/**
		 * 盘厚：外圈一圈**侧壁**（下沿整圈 ＋ 一圈竖直母线）。
		 * 🔴 一个圆盘看起来"是实体"而不是"一张贴纸"，唯一的依据就是**它的厚度**。
		 *    盘面本身必须共面（见 `tierOf`），所以立体感的预算全部给到这里。
		 * ⚠️ 48 条母线一律走 `extra` → 两条 wire、两次 `stroke()`。
		 *    前后分层交给 `half`：远半圈会被压到 0.45 亮度，正好读成"背面的边"。
		 */
		const skirt = (rOuter: number): Wire[] => {
			const rr = R * rOuter;
			// 96 条母线（原 48）：仍然只有一个 `extra`、只多花 0 次 `stroke()`，
			// 但盘缘的"实体感"明显厚 —— 48 条在 R≈200px 时每两条隔 26px，看着像栅栏。
			const n = 96;
			const vlines: Sub[] = [];
			for (let i = 0; i < n; i++) {
				const a = (TAU * i) / n;
				const x = Math.cos(a) * rr;
				const y = Math.sin(a) * rr;
				vlines.push({ p: [x, y, x, y], zs: [BODY, DECK] });
			}
			const ring = circle(rr, 108);
			return [
				wire(
					ring,
					BODY,
					1,
					1,
					0.7,
					ring.map(() => BODY),
				),
				bundle(vlines, BODY, 1, 1, 0.5),
			];
		};

		/**
		 * 共用骨架 = **分层边饰环**。这是这一轮重写的核心。
		 *
		 * 🔴 参考图里法阵的边**不是"一条圆线"**，是**一条完整的边饰带**，从外往里一共五层：
		 *    ① 外沿细圈；
		 *    ② 内侧副圈夹出一条**带**，带里 96 根密齿 ＋ 36 颗小节点；
		 *    ③ 带内一圈**铭文**（字头朝外）；
		 *    ④ 骑在带上的一圈**卷草装饰**（左右镜像交替）；
		 *    ⑤ 最外面一圈**锯齿能量边**（那道"电光"轮廓）；
		 *    再加盘厚 `skirt`。
		 * 🔴 原来的骨架是"一条细圆 + 48 齿 + **32 条满盘放射线** + 一圈节点" —— 32 条等长放射线
		 *    画出来是**车轮**，不是曼陀罗（"看起来劣质"的主因）。放射线现在只当外圈的一薄圈
		 *    短刻度用，或者干脆交给各阵型自己按需加。
		 *
		 * ⚠️ wire 预算：这套边饰只花 **7 条 wire**（齿/节点/装饰/锯齿各 1 条 `extra`）＋ 铭文
		 *    若干（`fillText`，不占 `stroke`）；密度是白拿的。
		 */
		const rim = (
			nNode: number,
			/** 装饰款式号（`ORN` 的索引） */
			orn: number,
			/** 铭文条数，0 = 不要 */
			nTxt: number,
			rOuter = 1,
			pool = RUNE_POOL,
		) => {
			const RO = R * rOuter;
			// ① 外沿主圈（唯一一条"实心"的边界）
			out.push(wire(circle(RO, 132), DECK, 1, 0, 0.95));
			// ② 边饰带：内侧副圈夹出一条 **10% R 宽**的带，带里 96 根密齿 ＋ 36 颗节点。
			//    ⚠️ 带**必须够宽**（原来是 5.5%）：太窄的话密齿糊成一道亮箍，
			//       读成"套了个铁圈"，而不是参考图里那条刻满东西的边饰。
			out.push(wire(circle(RO * 0.9, 120), DECK, 1, 1, 0.5));
			out.push(teeth(RO * 0.9, RO * 0.998, 96, 0, 1, 0.5));
			out.push(dots(RO * 0.965, 36, R * 0.007, 0.01));
			// ③ 铭文环：贴在边饰带的内侧（**不进带里** —— 带里已经有密齿，再叠字就糊了）
			if (nTxt > 0) {
				runeRing(RO * 0.822, nTxt, R * 0.062, 0.04, DECK, 0.88, 1, 0.8, pool);
			}
			// ④ 卷草装饰：**骑在边饰带里、探到环外**（参考图里这些大纹样就是外挂的，
			//    高度差不多等于整条带的宽度，是这一圈"贵气"的主要来源）
			out.push(
				ornRing(
					ORN[orn] ?? ORN_FLEUR,
					RO * 0.9,
					nNode >= 12 ? 12 : 8,
					R * 0.16,
					0,
					DECK,
					0.97,
					1,
					0.85,
					1,
				),
			);
			// ⑤ 锯齿能量边：整座阵最外那圈细"电光"。用**本阵自己的色**（副色），
			//    ⚠️ 原来给的是 `CRIMSON` —— 猩红在设定里是"坍缩/危险"的专用色，
			//       一圈红锯齿套在暗金/幽青的阵上，颜色直接打架（"劣质"里最扎眼的一笔）。
			out.push(crackle(RO * 1.1, 360, 0.008, 0.25, DECK, 0.99, 1, 0.32));
			// ⑥ 内圈副带：设定图从外往里是"亮箍 → 大纹样带 → 细圈 → 一圈小纹样 → 核心"，
			//    小纹样那圈是**贴在细圈上的小花**，不是又一道齿箍。
			const RI = RO * 0.76;
			out.push(wire(circle(RI, 108), DECK, 0.72, 1, 0.45));
			out.push(
				ornRing(ORN_TREFOIL, RI, 12, R * 0.058, 0.26, DECK, 0.74, 1, 0.7),
			);
			out.push(dots(RI + R * 0.085, 12, R * 0.009, 0.26));
			// ⑦ 满盘细放射线 ＋ 一层斜织的弦（参考图里那层"织"出来的蛛网底纹）
			out.push(radial(RO * 0.3, RO * 0.885, 72, 0.12, 0.1, 1));
			out.push(lattice(RO * 0.34, RO * 0.86, 24, 0.12, 0.09, 1));
			// ⑧ 中圈一圈小菱（把"花环"和内芯之间那条空带填上）
			out.push(rhombs(RO * 0.6, 8, R * 0.045, 0.12, 1, 0.4));
			// ⑨ 盘心那一小颗。🔴 少了它，中心就是**一块没有线经过的空底** —— 周围被弦纹
			//    织满、中间一小圈什么都没有，读出来就是"盘心破了个洞"（实测中心亮度
			//    (65,83,118) 其实比 0.35R 的 (45,66,111) 还亮，但眼睛认的是"线密不密"）。
			out.push(radial(0, RO * 0.115, 12, 0.26, 0.4, 1));
			out.push(dots(RO * 0.05, 6, R * 0.006, 0.26));
			// ⑩ 盘厚
			out.push(...skirt(rOuter));
		};

		/**
		 * 盘面上方的**悬浮光环**（1~3 圈）。参考图的 in-world 版本里全都有它，是"立体"最直接的一笔。
		 * ⚠️ `flat` 直接给投影后的纵向比（可正可负，负 = 翻到另一侧），不要算真三维 ——
		 *    绕 x 轴倾斜 φ 的结果本来就是 `cosφ·k − sinφ`，取到接近 0 时环会"立起来"成一条线，
		 *    所以这里把 |flat| 钳在 0.22 以上。
		 */
		const orbit = (n: number, base0: number) => {
			for (let i = 0; i < n; i++) {
				let flat = 0.82 - rand() * 1.3;
				if (Math.abs(flat) < 0.22) flat = flat < 0 ? -0.24 : 0.24;
				orbs.push({
					r: R * (base0 + i * 0.09 + rand() * 0.06),
					z: DECK + 0.38 + i * 0.36 + rand() * 0.12,
					flat,
					k: (i % 2 ? -1 : 1) * (0.5 + rand() * 0.6),
					ph: rand() * TAU,
					width: 1.1 + rand() * 1.3,
					rank: 0.9,
					tint: i % 2 ? 1 : 2,
					base: 0.85,
				});
			}
		};

		// ── 0 三重圆环阵（参考图 631 左上）：三圈同心环 ＋ 一圈珠 ＋ 中心八芒
		if (kind === 0) {
			rim(nodes, 0, 28);
			for (let i = 0; i < rings; i++) {
				const rk = lerp(0.42, 0.78, i / Math.max(1, rings - 1));
				out.push(wire(circle(R * rk, 108), T(rk), rk, i % 2 ? 1 : 0, 0.75));
			}
			// 一圈珠：参考图里"环与环之间那串小圆点"
			out.push(dots(R * 0.6, 18, R * 0.013, 0.06));
			// 核心（原来只有 0.29R，整座阵读完像一个"箍了边的大黑盘"）：八芒 ＋ 八面小菱 ＋ 六瓣
			out.push(wire(circle(R * 0.44, 84), T(0.44), 0.44, 1, 0.8));
			out.push(...stars(R * 0.44, 8, 3, 0.2, T(0.45), 0.45, 0, 0.9));
			out.push(rhombs(R * 0.44, 8, R * 0.06, 0.2, 1, 0.5));
			out.push(...glyphs(R * 0.6, 4, Math.PI / 4, T(0.62), 0.62, 0.7));
			out.push(...petals(R * 0.24, 6, R * 0.1, 0.3, 0.28, 1, 0.7));
			out.push(dots(R * 0.12, 6, R * 0.008, 0.4));
		}

		// ── 1 六芒星几何阵：一笔六芒 ＋ 内六边形弦网 ＋ 六个顶点各立一刃
		if (kind === 1) {
			rim(12, 1, 24);
			out.push(wire(circle(R * 0.8, 108), T(0.8), 0.8, 1, 0.45));
			out.push(...stars(R * 0.8, 6, 2, 0.3, T(0.82), 0.82, 0, 0.95));
			out.push(
				wire(poly(R * 0.56, 6, 0.3 + Math.PI / 6), T(0.56), 0.56, 1, 0.6),
			);
			out.push(
				...web(R * 0.56, 6, 2, 0.3 + Math.PI / 6, T(0.56), 0.56, 1, 0.45),
			);
			out.push(rhombs(R * 0.8, 6, R * 0.09, 0.3 + Math.PI / 6, 0, 0.5));
			out.push(...fins(R * 0.8, 6, 0.24, 0.3, 0.8, 0, 0.8, T(0.84)));
			out.push(wire(circle(R * 0.22, 48), T(0.22), 0.22, 1, 0.85));
			out.push(...petals(R * 0.34, 6, R * 0.1, 0.3, 0.34, 1, 0.6));
			orbit(1, 0.86);
		}

		// ── 2 月相仪式阵：两枚交错的月轨 ＋ 八枚月牙 ＋ 悬在盘上的月环
		if (kind === 2) {
			rim(8, 2, 20);
			out.push(
				wire(ellipse(R * 0.84, R * 0.32, -0.28, 108), T(0.84), 0.84, 0, 0.75),
			);
			out.push(
				wire(ellipse(R * 0.84, R * 0.32, 0.28, 108), T(0.84), 0.84, 1, 0.55),
			);
			out.push(wire(circle(R * 0.52, 84), T(0.52), 0.52, 1, 0.4));
			out.push(dots(R * 0.34, 12, R * 0.012, 0.2));
			out.push(...stars(R * 0.5, 8, 3, 0.4, T(0.5), 0.5, 0, 0.75));
			out.push(rhombs(R * 0.5, 8, R * 0.055, 0.4, 1, 0.45));
			out.push(...hooks(R * 0.64, 8, R * 0.095, 0.4, 0.64, 1, 0.85));
			out.push(...fins(R * 0.44, 4, 0.18, Math.PI / 4, 0.44, 1, 0.6, T(0.46)));
			out.push(wire(circle(R * 0.2, 40), T(0.2), 0.2, 1, 0.9));
			out.push(...petals(R * 0.3, 6, R * 0.1, 0.2, 0.3, 0, 0.6));
			orbit(2, 0.62);
		}

		// ── 3 裂纹封印阵：方框封印 ＋ 锯齿裂纹 ＋ 四角立碑
		if (kind === 3) {
			rim(8, 5, 20);
			out.push(wire(poly(R * 0.84, 4, Math.PI / 4), T(0.84), 0.84, 0, 0.85));
			out.push(wire(circle(R * 0.72, 96), T(0.72), 0.72, 1, 0.4));
			out.push(wire(poly(R * 0.58, 4, 0), T(0.58), 0.58, 1, 0.6));
			const nCr = 5 + Math.floor(rand() * 3);
			for (let i = 0; i < nCr; i++) {
				out.push(
					crack(
						R * (0.22 + rand() * 0.1),
						R * (0.84 + rand() * 0.12),
						(TAU * i) / nCr + rand() * 0.3,
						rand,
						rand() < 0.35 ? 2 : 0,
						T(0.86),
						0.86,
					),
				);
			}
			out.push(...fins(R * 0.84, 4, 0.22, Math.PI / 4, 0.84, 0, 0.7, T(0.86)));
			out.push(wire(circle(R * 0.2, 40), T(0.2), 0.2, 1, 0.85));
			out.push(...stars(R * 0.44, 4, 2, Math.PI / 4, T(0.44), 0.44, 1, 0.75));
			out.push(...band(R * 0.62, R * 0.7, 12, 0.2, T(0.66), 0.66, 0.4));
		}

		// ── 4 时空折叠阵：四层错位椭圆叠成"折扇" ＋ 折轴上的立刃
		if (kind === 4) {
			rim(8, 3, 24);
			for (let i = 0; i < 4; i++) {
				const rk = 0.44 + i * 0.13;
				out.push(
					wire(
						ellipse(R * rk, R * rk * 0.4, i * 1.0, 96),
						T(rk),
						rk,
						i === 1 || i === 3 ? 1 : 0,
						0.7,
					),
				);
			}
			out.push(...fins(R * 0.86, 4, 0.26, 0.4, 0.86, 0, 0.7, T(0.88)));
			out.push(
				...fins(R * 0.5, 4, 0.18, 0.4 + Math.PI / 4, 0.5, 1, 0.6, T(0.54)),
			);
			out.push(dots(R * 0.68, 16, R * 0.011, 0.5));
			out.push(...petals(R * 0.3, 4, R * 0.12, 0.4, 0.3, 1, 0.6));
			out.push(wire(circle(R * 0.14, 36), T(0.14), 0.14, 1, 0.9));
			orbit(2, 0.7);
		}

		// ── 5 幽青八芒阵（参考图 644）：一笔八芒 ＋ 两个正方 ＋ 八颗卫星盘
		if (kind === 5) {
			rim(16, 0, 32);
			out.push(wire(circle(R * 0.94, 108), T(0.94), 0.94, 1, 0.35));
			out.push(...stars(R * 0.9, 8, 3, 0.2, T(0.9), 0.9, 0, 0.95));
			out.push(rhombs(R * 0.9, 8, R * 0.085, 0.2, 1, 0.5));
			out.push(wire(poly(R * 0.6, 4, 0.2), T(0.6), 0.6, 1, 0.65));
			out.push(wire(poly(R * 0.6, 4, 0.2 + Math.PI / 4), T(0.6), 0.6, 1, 0.65));
			out.push(...satellites(R * 0.9, 8, R * 0.05, 0.2, 0.9, 1, 0.8));
			out.push(
				...fins(R * 0.6, 4, 0.2, 0.2 + Math.PI / 4, 0.6, 0, 0.65, T(0.62)),
			);
			out.push(wire(circle(R * 0.2, 40), T(0.2), 0.2, 1, 0.9));
			out.push(...petals(R * 0.36, 8, R * 0.08, 0.2, 0.36, 1, 0.5));
		}

		// ── 6 暗金星轨阵（参考图 654686）：两条扁轨道 ＋ 斜撑 ＋ 轨道上的行星 ＋ 悬浮光环
		if (kind === 6) {
			rim(12, 4, 24);
			out.push(
				wire(ellipse(R * 0.9, R * 0.22, 0.5, 108), T(0.9), 0.9, 0, 0.65),
			);
			out.push(
				wire(ellipse(R * 0.68, R * 0.3, -0.6, 96), T(0.68), 0.68, 1, 0.5),
			);
			out.push(
				...ramps(R * 0.28, R * 0.86, T(0.4), T(0.92), 12, 0.1, 0.9, 0.45),
			);
			out.push(...satellites(R * 0.9, 4, R * 0.05, 0.5, 0.9, 0, 0.85));
			out.push(wire(circle(R * 0.26, 48), T(0.26), 0.26, 0, 0.8));
			out.push(rhombs(R * 0.44, 8, R * 0.05, 0.3, 1, 0.45));
			out.push(...stars(R * 0.4, 8, 3, 0.3, T(0.4), 0.4, 0, 0.7));
			out.push(...petals(R * 0.4, 8, R * 0.085, 0.2, 0.4, 1, 0.55));
			orbit(3, 0.6);
		}

		// ── 7 太极八卦阵（参考图 98217 罗盘）：双环 ＋ 干支铭文环 ＋ 八卦爻线 ＋ 太极核
		if (kind === 7) {
			// 铭文用罗马数字款 —— 罗盘式"刻度铭文"的读感
			rim(8, 1, 36, 1, RUNE_ROMAN);
			out.push(wire(circle(R * 0.84, 108), T(0.84), 0.84, 0, 0.8));
			out.push(wire(circle(R * 0.64, 96), T(0.64), 0.64, 1, 0.6));
			out.push(...band(R * 0.86, R * 0.94, 8, 0.06, T(0.88), 0.88, 0.4));
			// 八卦：8 组、每组三条短横；断的那一爻拆成两段 —— 认得出是"卦"
			for (let i = 0; i < 8; i++) {
				const a = 0.4 + (TAU * i) / 8;
				for (let k = 0; k < 3; k++) {
					const rr = R * (0.48 + k * 0.054);
					const dA = (R * 0.05) / Math.max(rr, 1);
					if ((i * 3 + k) % 3 === 0) {
						out.push(bar(rr, a - dA, a - dA * 0.28, T(0.58), 0.58));
						out.push(bar(rr, a + dA * 0.28, a + dA, T(0.58), 0.58));
					} else {
						out.push(bar(rr, a - dA, a + dA, T(0.58), 0.58));
					}
				}
			}
			// 太极：圆 ＋ 一条 S（上下两段半圆拼出来）
			const rc = R * 0.19;
			out.push(wire(circle(rc, 56), T(0.2), 0.2, 0, 0.9));
			out.push(
				wire(
					move(ellipse(rc / 2, rc / 2, 0, 24, Math.PI, 0), 0, -rc / 2),
					T(0.2),
					0.2,
					1,
					0.8,
				),
			);
			out.push(
				wire(
					move(ellipse(rc / 2, rc / 2, 0, 24, Math.PI, Math.PI), 0, rc / 2),
					T(0.2),
					0.2,
					1,
					0.8,
				),
			);
			out.push(dots(R * 0.19, 8, R * 0.008, 0.4));
			orbit(2, 0.66);
		}

		// ── 8 莲花法阵（参考图 08 / 12 / 927f）：内外两圈花瓣错开 22.5° ＋ 中心莲台
		if (kind === 8) {
			rim(8, 1, 24);
			out.push(wire(circle(R * 0.82, 108), T(0.82), 0.82, 1, 0.6));
			out.push(...petals(R * 0.64, 8, R * 0.19, 0.3, 0.68, 0, 0.85));
			out.push(
				...petals(R * 0.4, 8, R * 0.13, 0.3 + Math.PI / 8, 0.44, 1, 0.7),
			);
			out.push(
				...hooks(R * 0.52, 8, R * 0.06, 0.3 + Math.PI / 8, 0.52, 1, 0.45),
			);
			out.push(dots(R * 0.78, 16, R * 0.01, 0.1));
			out.push(wire(poly(R * 0.3, 4, Math.PI / 4), T(0.3), 0.3, 0, 0.7));
			out.push(wire(circle(R * 0.15, 40), T(0.15), 0.15, 1, 0.9));
			out.push(...petals(R * 0.24, 4, R * 0.09, Math.PI / 4, 0.24, 0, 0.7));
		}

		// ── 9 符文卫星阵（参考图 927f 中）：方框 ＋ 四个对角卫星盘 ＋ 内八芒
		if (kind === 9) {
			rim(8, 5, 20);
			out.push(wire(circle(R * 0.8, 108), T(0.8), 0.8, 1, 0.35));
			out.push(wire(poly(R * 0.64, 4, Math.PI / 4), T(0.64), 0.64, 0, 0.85));
			out.push(wire(poly(R * 0.46, 4, 0), T(0.46), 0.46, 1, 0.6));
			out.push(...stars(R * 0.5, 8, 3, Math.PI / 8, T(0.5), 0.5, 0, 0.8));
			out.push(rhombs(R * 0.5, 8, R * 0.05, Math.PI / 8, 1, 0.45));
			out.push(...satellites(R * 0.66, 4, R * 0.14, Math.PI / 4, 0.7, 1, 0.85));
			out.push(...fins(R * 0.62, 4, 0.24, Math.PI / 4, 0.62, 0, 0.7, T(0.66)));
			out.push(...glyphs(R * 0.38, 8, 0, T(0.38), 0.38, 0.7));
			out.push(wire(circle(R * 0.14, 36), T(0.14), 0.14, 1, 0.9));
			orbit(1, 0.8);
		}

		// ── 10 玫瑰涡阵（参考图 73df130）：五条涡线错开起角往里旋
		if (kind === 10) {
			rim(8, 3, 20);
			for (let i = 0; i < 5; i++) {
				out.push(
					drape(
						spiral(
							R * 0.9,
							R * 0.14,
							// ⚠️ 圈数**不能多**：1.5 圈缩到中心时每圈半径变化很小，
							//    投影里就退化成一圈套一圈的**同心圆**（看着像"层"不像"涡"）。
							//    0.8 圈才是"一边转一边明显往里收"的旋涡。
							0.8,
							(TAU * i) / 5,
							0.9,
							i % 2 ? 1 : 0,
							0.5,
						),
						R,
					),
				);
			}
			out.push(...band(R * 0.86, R * 0.93, 12, 0.1, T(0.9), 0.9, 0.4));
			out.push(...fins(R * 0.9, 5, 0.2, 0.1, 0.9, 0, 0.6, T(0.94)));
			out.push(spiral(R * 0.15, R * 0.02, 1.1, 0.5, 0.2, 1, 0.9));
			out.push(...petals(R * 0.26, 5, R * 0.08, 0.5, 0.28, 0, 0.7));
		}

		// ── 11 尖芒星阵（参考图 d17ef44 / 1c0db）：内外两圈长短星刺 ＋ 八芒
		if (kind === 11) {
			rim(8, 5, 28, 0.94);
			out.push(...spikes(R * 0.94, R * 1.19, 8, 0.2, 0.04, 0.6));
			out.push(
				...spikes(R * 0.94, R * 1.08, 12, 0.2 + Math.PI / 12, 0.04, 0.4),
			);
			out.push(wire(circle(R * 0.84, 108), T(0.84), 0.84, 1, 0.35));
			out.push(...stars(R * 0.76, 8, 3, 0.2, T(0.76), 0.76, 0, 0.9));
			out.push(rhombs(R * 0.88, 8, R * 0.07, 0.2, 1, 0.5));
			out.push(...band(R * 0.78, R * 0.86, 12, 0.2, T(0.82), 0.82, 0.4));
			out.push(...stars(R * 0.46, 8, 3, 0.2, T(0.46), 0.46, 0, 0.75));
			out.push(wire(circle(R * 0.46, 84), T(0.46), 0.46, 1, 0.5));
			out.push(...glyphs(R * 0.66, 8, 0.1, T(0.68), 0.68, 0.7));
			out.push(wire(circle(R * 0.16, 40), T(0.16), 0.16, 1, 0.9));
		}

		// ── 12 星网阵列（参考图 644）：五芒 ＋ 内层十边形弦网 ＋ 菱
		if (kind === 12) {
			rim(10, 2, 30, 0.94);
			out.push(wire(circle(R * 0.94, 120), T(0.94), 0.94, 1, 0.4));
			out.push(wire(poly(R * 0.94, 5, 0.3), T(0.94), 0.94, 1, 0.6));
			out.push(...stars(R * 0.94, 5, 2, 0.3, T(0.94), 0.94, 0, 0.95));
			out.push(rhombs(R * 0.94, 10, R * 0.06, 0.3, 1, 0.45));
			out.push(...web(R * 0.42, 10, 3, 0.3, T(0.44), 0.44, 1, 0.45));
			out.push(...web(R * 0.42, 10, 4, 0.3, T(0.44), 0.44, 1, 0.35));
			out.push(...fins(R * 0.94, 5, 0.26, 0.3, 0.94, 0, 0.8, T(0.96)));
			out.push(spiral(R * 0.18, R * 0.02, 1.3, 0.3, 0.22, 1, 0.9));
			out.push(...petals(R * 0.3, 5, R * 0.1, 0.3, 0.34, 1, 0.65));
			orbit(2, 0.72);
		}

		return { wires: out, txts, rings: orbs };
	}

	// ─────────────────────────────────────────── 生成

	function spawn(
		x: number,
		y: number,
		s: Shared,
		v: View,
		hole: Hole,
	): boolean {
		if (cooldown > 0) return false;
		// 生成速度：2 阶起快 15%（spec §2.3 荧动）
		cooldown = 0.26 / (s.stage >= 2 ? 1.15 : 1);
		// 点得离黑洞近 → 从黑洞中心向外展开（spec §三）
		const near = Math.hypot(x - hole.x, y - hole.y) < Math.min(v.w, v.h) * 0.42;
		let cx = near ? hole.x : x;
		let cy = near ? hole.y : y;
		// 同一时间最多三座：最旧的那座优先进入解体（spec §三 参数约束）
		if (rites.length >= 3) {
			const oldest = rites[0];
			if (
				oldest &&
				oldest.phase !== "dissolving" &&
				oldest.phase !== "absorbing"
			) {
				oldest.phase = "dissolving";
				oldest.t = 0;
				oldest.dur = 0.9;
				oldest.u = 0;
			} else if (oldest) {
				return false;
			}
		}

		nextSeed = (nextSeed * 1103515245 + 12345) >>> 0;
		const rand = rngOf(nextSeed);
		// 法阵库分级：4 阶曜变之前只从**基础四阵**里抽（spec §三）。高阶三种进了库之后，
		// 抽法不变、只是候选变多 —— 所以"解锁"在观感上就是"突然会出现没见过的阵型"。
		const kind =
			s.stage >= 4
				? Math.floor(rand() * KINDS.length)
				: (BASE_KINDS[Math.floor(rand() * BASE_KINDS.length)] ?? 0);
		const pal = PALETTE[Math.floor(rand() * PALETTE.length)] ?? PALETTE[0];
		if (!pal) return false;
		const rings = 2 + Math.floor(rand() * 3);
		const nodes = [6, 8, 12, 16][Math.floor(rand() * 4)] ?? 8;
		// ⚠️ 半径比原来小了一档（0.34 → 0.27）：法阵从"压扁 0.42 的躺盘"改成"几乎正视的
		//    浮盘"之后，**纵向占的屏幕高度翻了近一倍**（`R·RITE_K` vs `R·0.42`），
		//    再按 0.34 给的话同屏三座会糊成一片、还容易压到黑洞身上。
		const R = Math.min(v.w, v.h) * 0.27 * (0.74 + rand() * 0.26);
		const liteCap = s.lite ? 0.72 : 1;
		// 悬浮高度分低/中/高三档（spec §八）。两处觉醒加成：
		//   · 4 阶曜变：整体 +20%
		//   · 8 阶归墟：**自动提升一档**（低→中、中→高、高封顶）—— 与 +20% 是叠加的
		// ⚠️ 三档也整体调小了（原 0.22/0.36/0.52）：这个数现在是**盘面离地多高**，
		//    不是"台面升多高"。盘厚是它的 `BODY`（0.58）倍，太高的话整座阵会飘到画面上半区。
		const tier = Math.min(2, Math.floor(rand() * 3) + (s.stage >= 8 ? 1 : 0));
		const riseH =
			R * ([0.2, 0.3, 0.42][tier] ?? 0.3) * liteCap * (s.stage >= 4 ? 1.2 : 1);
		// 🔴 钳回可视区。外圈投影到屏幕上是一个**横半轴 R、纵半轴 R*k** 的椭圆，而
		//    `生成法阵` 按钮给的落点是 y = h/2 + sin(a)·h·0.24 —— 在 1258×566 上，
		//    法阵有半个身子落在画布外，看起来就是"法阵被截断了"（其实是中心算到了外面）。
		//    两个入口（点击 / 按钮）都从这里过，所以钳在 spawn 里最省事。
		// ⚠️ 留边按 **RITE_K** 算（法阵自己的压缩率，不是黑洞那层的 `v.k`）：纵向半高是
		//    `R · RITE_K`，再往上还要留出悬浮的 `riseH`。最外的三样依次探到
		//    卷草尖端 1.08R、锯齿能量边 1.11R、尖芒星的刺 **1.19R** —— 按 1.16 算的话
		//    刺尖落在画布边上被切掉一截，"刺"变成"平头"。
		const padX = R * 1.21;
		const padY = R * RITE_K * 1.21 + riseH;
		cx = clamp(cx, padX, Math.max(padX, v.w - padX));
		cy = clamp(cy, padY, Math.max(padY, v.h - padY));
		const sig = buildSigil(kind, R, rand, rings, nodes);
		const rite: Rite = {
			id: nextId++,
			name: KINDS[kind] ?? "法阵",
			kind,
			cx,
			cy,
			R,
			riseH,
			speed: rand() < 0.45 ? 1.25 : 1,
			spin: rand() * TAU,
			spinV: (rand() < 0.5 ? -1 : 1) * (0.06 + rand() * 0.05),
			rgb: pal.rgb,
			// 副色 = 主色调亮 22%~45%（单色 ＋ 白高光，见 `lighten`）
			// ⚠️ 别调更大：`COLD` 是近乎白的冷色，和过头整座阵就读成"银白"、
			//    色相全丢（实测 0.45~0.7 时十三座里有六座是白的）。
			rgb2: lighten(pal.rgb, 0.22 + rand() * 0.23),
			wires: sig.wires,
			txts: sig.txts,
			rings: sig.rings,
			phase: "generating",
			t: 0,
			dur: 1.2 + rand() * 0.8,
			u: 0,
			drift: false,
		};
		rites.push(rite);
		// 粒子密度分阶（spec §2.3）
		spawnRise(rite, (s.lite ? 40 : 70) * densityK(s.stage), rand);
		shock(x, y, 1);
		return true;
	}

	// ─────────────────────────────────────────── 粒子池

	function push(sp: Spark): Spark {
		if (sparks.length >= (view.w < 760 ? 280 : MAX_SPARKS)) {
			// 池子满了就顶掉最老的一粒 —— 不增长、不阻塞
			sparks.shift();
		}
		sparks.push(sp);
		return sp;
	}

	/** @returns 让同一次生成的粒子分布有随机感，但又可复现（seed 固定） */
	function spawnRise(rite: Rite, n: number, rand: () => number) {
		for (let i = 0; i < n; i++) {
			const a = rand() * TAU;
			const p = push({
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				r: 0.8 + rand() * 1.4,
				t: 0,
				life: 2.2 + rand() * 2,
				rgb: rand() < 0.3 ? COLD : rite.rgb,
				kind: "rise",
			});
			// 先落在法阵外圈上，升起时顺着边缘往上飘
			p.x = rite.cx + Math.cos(a) * rite.R * (0.5 + rand() * 0.5);
			p.y = rite.cy + Math.sin(a) * rite.R * (0.5 + rand() * 0.5) * RITE_K;
			p.vx = (rand() - 0.5) * 14;
			p.vy = -(10 + rand() * 26);
		}
	}

	function spawnShards(
		rite: Rite,
		pts: number[],
		z: number,
		n: number,
		rand: () => number,
		hole: Hole,
	) {
		const count = pts.length / 2;
		if (count < 2) return;
		for (let i = 0; i < n; i++) {
			const k = Math.floor(rand() * count);
			const lx = pts[k * 2] ?? 0;
			const ly = pts[k * 2 + 1] ?? 0;
			// 复原到屏幕坐标（法阵被拖动过、也转过，所以走同一条投影）
			const a = rite.spin;
			const rx = lx * Math.cos(a) - ly * Math.sin(a);
			const ry = lx * Math.sin(a) + ly * Math.cos(a);
			const [sx, sy] = project(rite.cx, rite.cy, rx, ry, z, RITE_K);
			// 初速度：**切向 + 一点点向内**，绝不允许向外飘（spec §六 视觉细节 1）
			const d = Math.hypot(rx, ry) || 1;
			const tx = -ry / d;
			const ty = rx / d;
			const sp = 40 + rand() * 90;
			// ⚠️ 寿命要**按出发点离黑洞多远**给：离得远的碎片要走好几秒才到视界，
			//    写死 3.2s 的话它们在半路就淡没了 —— 看上去是"消散"，不是"被吞掉"。
			const dHole = Math.hypot(sx - hole.x, sy - hole.y);
			push({
				x: sx,
				y: sy,
				vx: tx * sp * (rand() < 0.5 ? -1 : 1) - (rx / d) * 30,
				vy: ty * sp * (rand() < 0.5 ? -1 : 1) - (ry / d) * 30,
				r: rand() < 0.16 ? 14 + rand() * 26 : 1 + rand() * 2.2,
				t: 0,
				life: clamp(dHole / 150, 1.8, 7),
				rgb: rand() < 0.14 ? CRIMSON : rite.rgb,
				// 大颗粒当暗雾用：解体时那层"雾"就是它们
				kind: rand() < 0.14 ? "fog" : "shard",
			});
		}
	}

	/** 点击涟漪：一圈冲击波，并把星尘往外推一下（spec §七 1）。 */
	function shock(x: number, y: number, power: number) {
		shockRing = { x, y, t: 0 };
		const n = view.w < 760 ? 10 : 22;
		for (let i = 0; i < n; i++) {
			const a = (TAU * i) / n;
			push({
				x: x + Math.cos(a) * 8,
				y: y + Math.sin(a) * 8,
				vx: Math.cos(a) * 90 * power,
				vy: Math.sin(a) * 90 * power,
				r: 1 + Math.random() * 1.6,
				t: 0,
				life: 0.9,
				rgb: COLD,
				kind: "flow",
			});
		}
	}

	// ─────────────────────────────────────────── 生命周期推进

	function update(dt: number, v: View, hole: Hole, s: Shared): number {
		view = v;
		time += dt;
		cooldown = Math.max(0, cooldown - dt);
		let eaten = 0;
		// 解体碎片密度分阶（spec §2.3）
		const dk = densityK(s.stage);
		// 吞噬速度：4 阶曜变起快 30%（spec §2.3）
		const eatK = s.stage >= 4 ? 1.3 : 1;

		for (let i = rites.length - 1; i >= 0; i--) {
			const r = rites[i];
			if (!r) continue;
			r.t += dt;
			const p = clamp(r.t / r.dur, 0, 1);

			if (r.phase === "generating") {
				// 由内向外：内圈先亮，外圈依次点亮（spec §四）
				r.u = smoothstep(p);
				if (p >= 1) {
					r.phase = "rising";
					r.t = 0;
					r.dur = 1 + Math.random() * 0.8;
					r.u = 0;
				}
			} else if (r.phase === "rising") {
				r.u = smoothstep(p);
				if (p >= 1) {
					r.phase = "active";
					r.t = 0;
					r.dur = 2 + Math.random();
					r.u = 1;
				}
			} else if (r.phase === "active") {
				r.u = 1;
				if (p >= 1) {
					r.phase = "dissolving";
					r.t = 0;
					r.dur = 0.9;
					r.u = 0;
				}
			} else if (r.phase === "dissolving") {
				// 由外向内逐圈断裂（spec §六 阶段一）
				r.u = p;
				const rand = rngOf(r.id * 977 + Math.floor(r.t * 60));
				for (const w of r.wires) {
					if (w.broke || r.u < (1 - w.rank) * 0.66) continue;
					w.broke = true;
					spawnShards(
						r,
						w.pts,
						// ⚠️ 碎片要落在**它原来所在的高度**上（`w.z` 是比例不是像素 —— 见 `Wire.z`）。
						//    漏掉 `riseH` 的话，一座抬高到 40px 的法阵解体时碎片全从台面冒出来。
						w.z * r.riseH * (1 - r.u),
						Math.round(4 * dk),
						rand,
						hole,
					);
				}
				if (p >= 1) {
					r.phase = "absorbing";
					r.t = 0;
					r.dur = (1.6 + Math.random() * 0.9) / r.speed / eatK;
					r.u = 0;
				}
			} else if (r.phase === "absorbing") {
				// 剩下没断干净的图元也交出去；扁平化已经完成（=0）
				r.u = p;
			}

			// 拖动松手后的漂移：主动往黑洞飘，飘到跟前就解体（spec §七 3）
			if (r.drift && r.phase !== "absorbing") {
				const dx = hole.x - r.cx;
				const dy = hole.y - r.cy;
				const d = Math.hypot(dx, dy) || 1;
				const sp = 46;
				r.cx += (dx / d) * sp * dt;
				r.cy += (dy / d) * sp * dt;
				if (d < r.R * 0.8 && r.phase !== "dissolving") {
					r.phase = "dissolving";
					r.t = 0;
					r.dur = 0.9;
					r.u = 0;
				}
			}

			// ⚠️ 自转要读 `calm`（`prefers-reduced-motion`）：这一页黑洞层、双位面都读了，
			//    法阵层原来漏了 —— 而法阵**永远在自转**（`spinV` 0.06~0.11 rad/s），
			//    是这一层里唯一的持续动画，恰恰是最该被降速的那一个。
			r.spin += r.spinV * dt * (s.calm ? 0.25 : 1);

			// 吞噬完成：该阵的碎片全没了才算（粒子不带归属，用 `hasOwnSparks` 近似判断）
			if (r.phase === "absorbing" && r.t > r.dur && !hasOwnSparks(r)) {
				rites.splice(i, 1);
				eaten++;
			}
		}

		updateSparks(dt, v, hole);
		if (shockRing) {
			shockRing.t += dt;
			if (shockRing.t > 1.1) shockRing = null;
		}
		return eaten;
	}

	/**
	 * 视界坍缩脉冲的"主动献祭"（spec §2.2）：**跳过停留**，全场法阵一起进入解体。
	 * ⚠️ 解体时长统一压到 0.55s（自然那趟是 0.9s）—— 全场同时塌才读得出"共振"，
	 *    各按各的节奏各走各的，脉冲扫过去就只是"碰巧大家都在解体"。
	 */
	function forceDissolve() {
		for (const r of rites) {
			if (r.phase === "dissolving" || r.phase === "absorbing") continue;
			r.phase = "dissolving";
			r.t = 0;
			r.u = 0;
			r.dur = 0.55;
			r.drift = false;
		}
	}

	/** 这座法阵还有自己的粒子在场吗（有就不算吞干净）。 */
	function hasOwnSparks(r: Rite): boolean {
		for (const sp of sparks) {
			if (sp.kind === "rise" || sp.kind === "shard" || sp.kind === "fog") {
				// 粒子不带归属，用"离黑洞还远不远"近似：只要还在半径外，就还没吞完
				if (Math.hypot(sp.x - r.cx, sp.y - r.cy) < r.R * 1.6) return true;
			}
		}
		return false;
	}

	function updateSparks(dt: number, v: View, hole: Hole) {
		const kill = hole.r * 1.02;
		for (let i = sparks.length - 1; i >= 0; i--) {
			const sp = sparks[i];
			if (!sp) continue;
			sp.t += dt;
			if (sp.t > sp.life) {
				sparks.splice(i, 1);
				continue;
			}
			const dx = hole.x - sp.x;
			const dy = hole.y - sp.y;
			const d = Math.hypot(dx, dy) || 1;
			const inv = 1 / d;

			if (sp.kind === "flow" || sp.kind === "rise") {
				// 冲击波与上升粒子：本来就在往外/往上走，引力只做轻微偏转
				sp.vx *= 0.986;
				sp.vy *= 0.986;
			} else {
				// 🔴 三项，缺一项都不对。这三条是扫参数扫出来的，别凭手感改：
				//   ① 径向 a = ACC/max(70,d)：越近越猛 —— 这就是"越近越快"。
				//   ② 偏转必须**垂直于速度**（洛伦兹那一项），**不能垂直于半径**：
				//      垂直于半径的力每一帧都在给粒子加角动量 = 一直在做正功，粒子会越绕越远，
				//      最后"被引力选中"变成"逃逸"（实测：起点 566px、初速 0，20 秒后飞到
				//      9754px 之外）。垂直于速度的力**不做功**，只改方向，弧线照有。
				//   ③ 阻尼：只有①②的话，粒子攒够切向速度就变成**永动的圆轨道**
				//      （实测 d0=566 转了 1169° 还在原地打转）。阻尼抽走能量，轨道才真的收缩。
				const a = ACC / Math.max(70, d);
				const curl = 0.7 * (0.5 + 0.95 * clamp(d / (v.h * 0.75), 0, 1));
				const nvx = sp.vx + dx * inv * a * dt - sp.vy * curl * dt;
				const nvy = sp.vy + dy * inv * a * dt + sp.vx * curl * dt;
				const keep = Math.max(0, 1 - 1.1 * dt);
				sp.vx = nvx * keep;
				sp.vy = nvy * keep;
			}
			// 限速 + 单帧位移钳制：不钳的话一帧就能跨过视界，"吞进去"会看成"凭空消失"
			const sp0 = Math.hypot(sp.vx, sp.vy);
			const cap = 1500;
			if (sp0 > cap) {
				sp.vx = (sp.vx / sp0) * cap;
				sp.vy = (sp.vy / sp0) * cap;
			}
			const move = Math.hypot(sp.vx * dt, sp.vy * dt);
			const maxMove = kill * 0.55;
			const scale = move > maxMove ? maxMove / move : 1;
			sp.x += sp.vx * dt * scale;
			sp.y += sp.vy * dt * scale;

			if (Math.hypot(hole.x - sp.x, hole.y - sp.y) <= kill) {
				// 接触视界：短暂变亮，然后消失（spec §六 阶段三）
				sp.kind = "flash";
				sp.life = 0.22;
				sp.t = 0;
				sp.vx *= 0.12;
				sp.vy *= 0.12;
				sp.r = Math.max(1.4, sp.r * 0.9);
				sp.rgb = COLD;
			}
		}
	}

	// ─────────────────────────────────────────── 命中与拖拽

	/** 抓法阵：从**最新的**往前找，谁离点最近抓谁（新的画在上面，优先被抓）。 */
	function grab(x: number, y: number): number {
		let best = -1;
		let bestD = 1e9;
		for (let i = 0; i < rites.length; i++) {
			const r = rites[i];
			if (!r) continue;
			// ⚠️ 命中区是一个**抬起来、压扁了的椭圆**：盘面浮在 `riseH` 高处、纵向按
			//    `RITE_K` 压。用"到 (cx,cy) 的圆距离"判的话，只有盘心附近点得到，
			//    "点边上那圈齿"会整片落空 —— 而且越是宽屏（R 越大、riseH 越大）越明显。
			const d = Math.hypot(x - r.cx, (y - (r.cy - r.riseH)) / RITE_K);
			// 只抓"成形之后"的法阵：还在从里往外飞的时候，位置全是中间态
			const solid = r.phase === "active" || r.phase === "dissolving";
			if (solid && d < r.R * 1.05 && d < bestD) {
				bestD = d;
				best = i;
			}
		}
		return best;
	}

	function drag(i: number, x: number, y: number) {
		const r = rites[i];
		if (!r) return;
		// 不许盖住黑洞主体（spec §七 3 最后一句）
		const dx = x - r.cx;
		const dy = y - r.cy;
		const nx = r.cx + dx * 0.35;
		const ny = r.cy + dy * 0.35;
		r.cx = nx;
		r.cy = ny;
	}

	function release(i: number) {
		const r = rites[i];
		if (r) r.drift = true;
	}

	// ─────────────────────────────────────────── 绘制

	/** 一条折线的局部点 → 屏幕点的中间量（含自转与投影）。 */
	function at(r: Rite, w: Wire, i: number) {
		const lx = w.pts[i * 2] ?? 0;
		const ly = w.pts[i * 2 + 1] ?? 0;
		const a = r.spin;
		return {
			rx: lx * Math.cos(a) - ly * Math.sin(a),
			ry: lx * Math.sin(a) + ly * Math.cos(a),
		};
	}

	/**
	 * 画一条折线。`half` 控制只画前半（y≥0，靠近镜头）/ 后半（y<0），
	 * 这是在**一个平面里做深度分层**，比 z-index 靠谱。
	 *
	 * ⚠️ `Wire.extra` 里的附带细纹会和主折线塞进**同一个 path**，最后一次 `stroke()` ——
	 *    所以这里不能按"主折线有几段"来决定要不要描边。
	 */
	function strokeWire(
		g: CanvasRenderingContext2D,
		r: Rite,
		w: Wire,
		lift: number,
		progress: number,
		half: -1 | 1,
		alpha: number,
	) {
		const n = w.pts.length / 2;
		const subs = w.extra ?? [];
		// ⚠️ 判据是 `2` 不是 `1`。符文节点是**单点** wire（`[x,y]`），只有 1 个点 ——
		//    按 `n<1` 放过去的话，`at(r,w,1)` 会读到不存在的 pts[2]/pts[3]（→0），
		//    于是每一颗符文都会**多画一条从节点连到法阵中心**的放射线。十几个节点就是十几条。
		// ⚠️ 而且**主折线为空不代表没事做**：`bundle` 出来的细纹就只有 `extra`。
		if (n < 2 && subs.length === 0) return;
		const [ox, oy] = [r.cx, r.cy];
		// 🔴 法阵走**自己的**压缩率（`RITE_K` = 0.84，几乎正视），不是黑洞那一层的 `view.k`。
		const k = RITE_K;
		// 🔴 高度 = "占 riseH 的比例" × 升起高度 × 升起进度。**少了 `r.riseH` 这一项**，
		//    高度就退化成 0.1~1.0 像素 —— 整座法阵看起来完全是平的。
		const zBase = r.riseH * lift;
		const perVertex = !!w.zs;
		const ca = Math.cos(r.spin);
		const sa = Math.sin(r.spin);
		const inHalf = (v: number) => (half < 0 ? v < 0 : v >= 0);
		g.beginPath();
		// 🔴 **两个标志，不能合并**：`drawing` 管"当前子折线还连不连着"（决定 `lineTo` 还是
		//    `moveTo`），`any` 管"这条 path 里到底有没有东西"（决定要不要 `stroke()`）。
		//    合并成一个的后果**不是"多一条线"，是"整条 wire 被丢掉"**：一圈 97 点的圆环
		//    在第 95 段跨出本 half 被 `continue` 时把 `drawing` 置回 false，循环正好结束，
		//    于是 `if (!drawing) return` 直接放弃 —— 实测 49 段明明都 `moveTo`/`lineTo`
		//    过了，却一次都没描。症状就是"法阵只剩一半"（整个上半圈空白）。
		let drawing = false;
		let any = false;
		if (n >= 2) {
			const total = Math.max(1, Math.round((n - 1) * progress));
			for (let i = 0; i < total; i++) {
				const a = at(r, w, i);
				const b = at(r, w, i + 1);
				// 逐点高度：有 `zs` 就是一道坡（或一片竖刃），没有就是盘面
				const za = zBase * (perVertex ? (w.zs?.[i] ?? w.z) : w.z);
				const zb = zBase * (perVertex ? (w.zs?.[i + 1] ?? w.z) : w.z);
				const [x0, y0] = project(ox, oy, a.rx, a.ry, za, k);
				const [x1, y1] = project(ox, oy, b.rx, b.ry, zb, k);
				// 🔴 段被跳过时必须**断开续接**（`drawing = false`）。否则下一段仍然 `lineTo`，
				//    就从"上一段的终点"（可能属于另一个 half、甚至在盘的另一侧）一条直线连到
				//    本段起点 —— 一圈 108 段的圆环只要跨过一次 half 边界，就会横贯全盘拉出
				//    一条 ~400px 的直线。正确做法：跳过的段之后重新 `moveTo`。
				if (!inHalf(a.ry) && !inHalf(b.ry)) {
					drawing = false;
					continue;
				}
				if (drawing) g.lineTo(x0, y0);
				else {
					g.moveTo(x0, y0);
					drawing = true;
				}
				g.lineTo(x1, y1);
				any = true;
			}
		}
		// 附带细纹：**整条**一起判深度（它们都很短，逐段没意义），同一 path 一次描边。
		// ⚠️ 只在展开的最后一段露面（`progress > 0.85`）—— 细纹是刻上去的，不该比结构先到。
		if (progress > 0.85) {
			for (const sub of subs) {
				const m = sub.p.length / 2;
				if (m < 2) continue;
				let sx = 0;
				let sy = 0;
				for (let i = 0; i < m; i++) {
					sx += sub.p[i * 2] ?? 0;
					sy += sub.p[i * 2 + 1] ?? 0;
				}
				if (!inHalf((sx / m) * sa + (sy / m) * ca)) continue;
				for (let i = 0; i < m; i++) {
					const px = sub.p[i * 2] ?? 0;
					const py = sub.p[i * 2 + 1] ?? 0;
					const [x, y] = project(
						ox,
						oy,
						px * ca - py * sa,
						px * sa + py * ca,
						zBase * (sub.zs?.[i] ?? w.z),
						k,
					);
					if (i === 0) g.moveTo(x, y);
					else g.lineTo(x, y);
				}
				drawing = true;
				any = true;
			}
		}
		if (!any) return;
		// 前后分层：两趟画（前半 y≥0 / 后半 y<0）本来就是为了让"靠近镜头的那半"亮一档。
		// 原来这里拿 `w.pts[1]`（起点的局部 y）当深度 —— 整圈圆环起点固定在 0°，永远算出同一个值，
		// 两层看着一样亮，"立体"就没了。直接按 half 给，才是这两趟画的意义。
		const depth = half > 0 ? 0.95 : 0.45;
		const core = clamp(alpha * depth * w.base, 0, 1);
		// 面：**只填不描**。"亮"留给线、"量"交给面 —— 面一发光就顶到 255（见 hole.ts 头注释）。
		if (w.fill) {
			g.globalAlpha = core * 0.3;
			g.fillStyle = tintCss(r, w.tint);
			g.fill();
			g.globalAlpha = 1;
			return;
		}
		g.strokeStyle = tintCss(r, w.tint);
		const lw = Math.max(0.7, 1.5 + w.base * 1.7);
		// 🔴 辉光那一趟只给"主要"的线（`base ≥ 0.5`）。齿、放射骨、小节点这些细件
		//    在一个阵型里占绝大多数 —— 它们本来就不该发光，省下来的正好抵掉新增的图元。
		if (w.base >= 0.5) {
			g.globalAlpha = core * 0.16;
			g.lineWidth = lw * 2.6;
			g.stroke();
		}
		// 窄的那趟是"芯"：叠在辉光上，一条线才有"中间亮、边缘淡"的样子。
		g.globalAlpha = core;
		g.lineWidth = lw;
		g.stroke();
		g.globalAlpha = 1;
	}

	/**
	 * 主色 → CSS 颜色。`Tint` 选第几套色（见 `Wire.tint`）。
	 * `a` 给 alpha（省略 = 1）。铭文是 `fillText`，没法像折线那样靠 `globalAlpha` 之外
	 * 再叠一层逐条亮度，所以它必须能把 alpha 写进颜色本身。
	 * ⚠️ `a >= 1` 时**故意输出旧的三参数写法** `rgb(r g b)` —— 少一次字符串差异，
	 *    也避开极老引擎对 `rgb(r g b / a)` 的解析分歧。
	 */
	function tintCss(r: Rite, tint: Tint, a = 1): string {
		const c = tint === 1 ? r.rgb2 : tint === 2 ? CRIMSON : r.rgb;
		return a >= 1 ? `rgb(${c.join(" ")})` : `rgb(${c.join(" ")} / ${a})`;
	}

	/**
	 * 环上的**铭文**。参考图里每一张法阵都有这么一圈 —— 沿环内切排布、**字头朝外**。
	 * 它不进 `Wire` 体系（不参与"由内向外展开"、也不参与解体断链），所以只当边饰：
	 * 结构锁定之后才露面，解体时跟着整体亮度一起淡出。
	 * 前后半各给一档亮度 —— 和折线共用同一套"算深度"的规矩，不然字会浮在盘面上。
	 */
	function drawTxts(
		g: CanvasRenderingContext2D,
		r: Rite,
		lift: number,
		alpha: number,
		half: -1 | 1,
	) {
		if (r.txts.length === 0 || alpha <= 0.01) return;
		g.save();
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.globalAlpha = clamp(alpha, 0, 1);
		for (const t of r.txts) {
			// 逐帧再叠 `r.spin` —— 铭文必须跟着盘一起转，否则一眼看出是"贴上去的字"。
			const a = t.a + r.spin;
			const ry = Math.sin(a) * t.r;
			if (ry < 0 !== half < 0) continue;
			const [x, y] = project(
				r.cx,
				r.cy,
				Math.cos(a) * t.r,
				ry,
				t.z * r.riseH * lift,
				RITE_K,
			);
			g.save();
			g.translate(x, y);
			// 字头朝外：切线角 = `a + π/2`（`a` = 该枚所在角度，屏幕 y 向下）。
			g.rotate(a + Math.PI / 2);
			g.font = `${t.size.toFixed(1)}px Georgia, "Times New Roman", serif`;
			// 🔴 先描一道**暗边**再填字：铭文底下现在是一整片发光的场（见 `draw` 的发光场），
			//    纯白字直接填上去会糊在光里 —— 设定图里那些数字/字母都带一圈暗描边。
			g.globalAlpha = clamp(alpha * 0.5, 0, 1);
			g.strokeStyle = "rgb(4 6 11 / 0.9)";
			g.lineWidth = Math.max(1.2, t.size * 0.16);
			g.strokeText(t.ch, 0, 0);
			g.globalAlpha = clamp(alpha, 0, 1);
			g.fillStyle = tintCss(
				r,
				t.tint,
				clamp(t.base * (half > 0 ? 1 : 0.5), 0, 1),
			);
			g.fillText(t.ch, 0, 0);
			g.restore();
		}
		g.restore();
	}

	/**
	 * **悬浮轨道环**：盘面上方倾斜着转的细光环。参考图的 in-world 版本里全都有它，
	 * 是"这是一座立体的阵"最直接的一笔。
	 * 🔴 **正圆环转起来看不见** —— 所以转速全靠沿弧等距的"珠"给；环本身只负责给形状。
	 *    `st` 是"自转时间"，`prefers-reduced-motion` 下由 `draw` 传 0（冻结，不是变慢）。
	 */
	function drawOrbits(
		g: CanvasRenderingContext2D,
		r: Rite,
		lift: number,
		alpha: number,
		half: -1 | 1,
		st: number,
	) {
		if (r.rings.length === 0 || alpha <= 0.01) return;
		g.save();
		for (const t of r.rings) {
			const rr = t.r;
			// `flat` 可正可负（翻到盘面另一侧），投影形状一样 → 取绝对值。
			const ry = rr * Math.abs(t.flat);
			const cy = r.cy - t.z * r.riseH * lift;
			const front = half > 0;
			const a0 = t.ph + st * t.k;
			g.globalAlpha = clamp(alpha * t.base * (front ? 0.85 : 0.3), 0, 1);
			g.strokeStyle = tintCss(r, t.tint);
			g.lineWidth = t.width;
			// 一圈拆成前后两道弧 —— 每半圈只描一次，合起来正好一整圈（不重叠、不翻倍）。
			g.beginPath();
			g.ellipse(
				r.cx,
				cy,
				rr,
				ry,
				0,
				front ? 0 : Math.PI,
				front ? Math.PI : TAU,
			);
			g.stroke();
			// 珠：转速唯一的依据。8 颗沿弧等距，屏幕上的间距天然不均 → 读得出这是三维的环。
			const nb = 8;
			for (let i = 0; i < nb; i++) {
				const th = a0 + (TAU * i) / nb;
				const sy = Math.sin(th);
				if (sy < 0 !== half < 0) continue;
				g.beginPath();
				g.arc(
					r.cx + Math.cos(th) * rr,
					cy + sy * ry,
					clamp(t.width * 1.5, 1, 2.6),
					0,
					TAU,
				);
				g.fillStyle = tintCss(r, t.tint, front ? 0.95 : 0.3);
				g.fill();
			}
		}
		g.restore();
	}

	function draw(
		g: CanvasRenderingContext2D,
		gs: CanvasRenderingContext2D,
		v: View,
		s: Shared,
	) {
		view = v;
		// 🔴 视界脉冲扫过全场时，所有法阵**一起亮一下**（spec §2.2"同步共振发光"）。
		//    这是唯一一处"法阵的亮度不由自己决定" —— 也是"脉冲扫过全场"看得见的原因。
		const reson = 1 + clamp(s.pulse, 0, 1.35) * 0.55;
		// ⚠️ 符文晶体的呼吸脉动是这一层里唯一"没有信息、纯装饰"的循环动画，
		//    `prefers-reduced-motion` 下直接停住（冻结在相位 0，不是变慢）。
		const pulseT = s.calm ? 0 : time;
		// 悬浮光环的自转同理：纯装饰 → 降级时冻结。
		const spinT = s.calm ? 0 : time;
		for (const r of rites) {
			const lift =
				r.phase === "generating"
					? 0
					: r.phase === "rising"
						? r.u
						: r.phase === "dissolving"
							? 1 - r.u
							: r.phase === "absorbing"
								? 0
								: 1;
			const rev = r.phase === "generating" ? r.u : 1;
			const fadeIn = r.phase === "generating" ? clamp(r.u * 5, 0, 1) : 1;
			const fadeOut = r.phase === "dissolving" ? 1 - r.u * 0.55 : 1;
			// 共振那一下也把"不在场的"法阵带亮 —— 它本来就是"被那个脉冲照到的"
			const alpha = (r.phase === "absorbing" ? 0.3 : fadeIn * fadeOut) * reson;

			// ⚠️ 成形那一段在 spec 里是**四拍**，不是"一整段一起淡进来"：
			//    ①种子点亮 → ②核心符文 → ③由内向外扩展 → ④结构锁定。
			//    四拍的进度全部从同一个 `u` 上切（再存一份进度迟早和它不同步）。
			const gen = r.phase === "generating";
			const gp = r.u;
			const seedT = clamp(gp / 0.14, 0, 1); // ① 种子长大
			const seedFade = 1 - clamp((gp - 0.12) / 0.22, 0, 1); // ② 核心亮起时让位
			const coreT = clamp((gp - 0.12) / 0.24, 0, 1); // ② 核心符文
			const outT = clamp((gp - 0.32) / 0.52, 0, 1); // ③ 由内向外
			const lockT = clamp((gp - 0.86) / 0.14, 0, 1); // ④ 结构锁定
			// 边饰层的入场：铭文是"刻上去的"、悬浮环是"架上去的"，都该在结构立住之后才露面。
			// 少了这道闸，生成那 1 秒里几十枚字会跟着一起闪，整段读成"一锅乱"。
			const decoIn = gen ? clamp((gp - 0.72) / 0.24, 0, 1) : 1;

			// ① 种子：中心先亮起一点，然后被核心符文接手
			if (gen && seedFade > 0.01) {
				g.save();
				g.globalCompositeOperation = "lighter";
				const rad = 7 + 18 * seedT;
				const g0 = g.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, rad);
				g0.addColorStop(0, `rgb(${COLD.join(" ")} / ${0.85 * seedFade})`);
				g0.addColorStop(0.42, `rgb(${r.rgb.join(" ")} / ${0.4 * seedFade})`);
				g0.addColorStop(1, `rgb(${r.rgb.join(" ")} / 0)`);
				g.fillStyle = g0;
				g.beginPath();
				g.arc(r.cx, r.cy, rad, 0, TAU);
				g.fill();
				g.restore();
			}

			// 升起时的中心光柱（spec §五 1）：先立柱子，圆环再往上抬
			if (r.phase === "rising" && r.u > 0.05) {
				g.save();
				g.globalAlpha = clamp(r.u * 0.5, 0, 0.5);
				const grd = g.createLinearGradient(0, r.cy, 0, r.cy - r.riseH * r.u);
				grd.addColorStop(0, `rgb(${r.rgb.join(" ")} / 0)`);
				grd.addColorStop(0.7, `rgb(${r.rgb2.join(" ")} / 0.5)`);
				grd.addColorStop(1, "rgb(255 255 255 / 0.55)");
				g.strokeStyle = grd;
				g.lineWidth = 2;
				g.beginPath();
				g.moveTo(r.cx, r.cy);
				g.lineTo(r.cx, r.cy - r.riseH * r.u);
				g.stroke();
				g.restore();
			}

			// 两趟：后半 → 前半。同一平面里靠"算出深度"分层，而不是 z-index。
			for (const half of [-1, 1] as const) {
				for (const w of r.wires) {
					if (w.broke) continue;
					// ② 核心符文先亮（只有内圈），③ 再由内向外把外圈依次点亮
					const win = gen
						? clamp(
								Math.max(
									coreT * (1 - w.rank * 2.2),
									(outT - w.rank * 0.55) / 0.45,
								),
								0,
								1,
							)
						: clamp((rev - w.rank * 0.55) / 0.45, 0, 1);
					if (win <= 0) continue;
					// 微弱轨迹先铺一层，再让能量把它填满
					if (win < 1) {
						strokeWire(g, r, w, lift, win, half, alpha * 0.9);
						strokeWire(g, r, w, lift, 1, half, alpha * 0.09);
					} else {
						strokeWire(g, r, w, lift, 1, half, alpha);
					}
					if (w.glyph && win > 0.6) {
						// 符文节点：升起后变成立在环上的小晶体
						const p = at(r, w, 0);
						// 🔴 **一颗符文只许画一趟**。原来这段在 `for (half)` 里面，于是每颗符文
						//    被前后两趟各画一次 —— 它在 `lighter` 下加色叠加，亮度直接翻倍顶上 255
						//    （渲染里那圈节点是过曝的白点），而且和"前后半亮度分档"的规矩自相矛盾。
						//    现在按它自己的 ry 判归哪一趟，并跟着压一档亮度。
						const back = p.ry < 0;
						if (back !== half < 0) continue;
						const [x, y] = project(
							r.cx,
							r.cy,
							p.rx,
							p.ry,
							w.z * r.riseH * lift,
							RITE_K,
						);
						// ⚠️ 晶体高度按**法阵半径**给。写死 4+10px 的话，法阵一大一小
						//    （R 从 40 到 160）晶体就不成比例了。
						const h = r.R * (0.05 + 0.1 * lift);
						const pulse = 1 + 0.35 * Math.sin(pulseT * 2.4 + w.rank * 9);
						const deth = back ? 0.55 : 1;
						g.save();
						g.globalAlpha = clamp(
							alpha * (win - 0.6) * (0.5 + 0.5 * lift) * deth,
							0,
							1,
						);
						g.strokeStyle = `rgb(${COLD.join(" ")})`;
						g.lineWidth = 1.1;
						g.beginPath();
						g.moveTo(x, y);
						g.lineTo(x, y - h);
						g.stroke();
						gs.save();
						gs.globalCompositeOperation = "lighter";
						gs.globalAlpha = clamp(
							alpha * 0.5 * pulse * (0.35 + 0.65 * lift) * deth,
							0,
							1,
						);
						gs.fillStyle = `rgb(${r.rgb2.join(" ")})`;
						gs.beginPath();
						gs.arc(x, y - h, 1.3 + 1.6 * lift, 0, TAU);
						gs.fill();
						gs.restore();
						g.restore();
					}
				}
				// 边饰层：悬浮环（在盘面上方）＋ 铭文环。两样都按 `half` 分深度，
				// 与上面的折线共用同一条规矩 —— 否则边饰会"浮"在盘面之外。
				drawOrbits(g, r, lift, alpha * decoIn, half, spinT);
				drawTxts(g, r, lift, alpha * decoIn, half);
			}

			// 中心辉光：整座阵"有一个光源"的依据 —— 参考图里每张法阵的盘心都比盘缘亮一档。
			// ⚠️ 加色绘制（`lighter`）：大面积叠色会直接顶到 255，所以峰值压到 0.22，
			//    并用径向渐变把能量收在中心那一小块（见 hole.ts 头注释）。
			if (lift > 0.02 && alpha > 0.02) {
				// 🔴 **发光场**：设定图里法阵不是"黑盘上画亮线"，是**一整个发光的圆场**
				//    —— 盘内没有一处是纯黑。这是"看着劣质"最后也是最大的一处来源：
				//    只画线的话，无论线多密，中间永远是几个黑洞。
				//    分三层：① 整场铺一层本阵色相的极淡辉光 → ② 盘缘一道"亮箍"（越外越亮）
				//    → ③ 中心一点核。全部加色，峰值 ≤0.2（大面积累加会顶到 255）。
				g.save();
				g.globalCompositeOperation = "lighter";
				g.translate(r.cx, r.cy - r.riseH * lift * DECK);
				// 盘面是压扁的，整个场也得跟着压扁 —— 否则是个"球"，不是"盘上的光"。
				g.scale(1, RITE_K);
				const live = alpha * lift;
				// ① 整场。⚠️ 这里是**单层**渐变铺一次，不是多层叠 —— 所以可以给到 0.3；
				//    "大面积 ≤0.2" 那条规矩管的是**多层累加**，单层给 0.3 也不会顶到 255。
				// 🔴 剖面方向：设定图是**盘缘最亮、越往里越暗**（光从边上打进来，中心是暗芯），
				//    反过来（中心亮）会读成"一个发光的球"，盘就没了。
				const f0 = g.createRadialGradient(0, 0, 0, 0, 0, r.R);
				f0.addColorStop(0, tintCss(r, 0, 0.08));
				f0.addColorStop(0.45, tintCss(r, 0, 0.16));
				f0.addColorStop(0.86, tintCss(r, 0, 0.36));
				f0.addColorStop(1, tintCss(r, 0, 0.3));
				g.globalAlpha = clamp(live, 0, 1);
				g.fillStyle = f0;
				g.beginPath();
				g.arc(0, 0, r.R, 0, TAU);
				g.fill();
				// ② 盘缘亮箍：从 0.78R 起加速，到盘缘封顶
				const f1 = g.createRadialGradient(0, 0, r.R * 0.78, 0, 0, r.R * 1.0);
				f1.addColorStop(0, tintCss(r, 1, 0));
				f1.addColorStop(0.55, tintCss(r, 1, 0.18));
				f1.addColorStop(1, tintCss(r, 1, 0.3));
				g.fillStyle = f1;
				g.beginPath();
				g.arc(0, 0, r.R, 0, TAU);
				g.fill();
				// ③ 溢出盘外的一圈光晕（"这道光有厚度"）。降级档省掉这一层：
				//    它是四层里唯一的"装饰性"铺底，去掉只少了点柔光，不损结构。
				if (!s.lite) {
					const f2 = g.createRadialGradient(0, 0, r.R, 0, 0, r.R * 1.22);
					f2.addColorStop(0, tintCss(r, 0, 0.16));
					f2.addColorStop(1, tintCss(r, 0, 0));
					g.fillStyle = f2;
					g.beginPath();
					g.arc(0, 0, r.R * 1.22, 0, TAU);
					g.fill();
				}

				const breath = s.calm ? 0.7 : 0.7 + 0.3 * Math.sin(pulseT * 0.9);
				const rc = r.R * 0.6;
				g.globalAlpha = clamp(live * 0.22 * breath, 0, 0.24);
				const gg = g.createRadialGradient(0, 0, 0, 0, 0, rc);
				gg.addColorStop(0, `rgb(${COLD.join(" ")})`);
				gg.addColorStop(0.34, `rgb(${r.rgb2.join(" ")})`);
				gg.addColorStop(1, `rgb(${r.rgb.join(" ")} / 0)`);
				g.fillStyle = gg;
				g.beginPath();
				g.arc(0, 0, rc, 0, TAU);
				g.fill();
				g.restore();
			}

			// ④ 结构锁定：整座阵一次短促的"上锁"闪光（spec §四 阶段四）。
			//    少了这一下，成形就只是"淡进来了"，立不住。
			//    ⚠️ 锁的是**盘面**那一圈，所以圆心要抬到 `DECK` 的高度上（不然闪在盘底）。
			if (gen && lockT > 0) {
				const a = (1 - lockT) * 0.5;
				const rr = r.R * (1 + lockT * 0.24);
				g.save();
				g.globalCompositeOperation = "lighter";
				g.strokeStyle = `rgb(${COLD.join(" ")} / ${a})`;
				g.lineWidth = 2.6 * (1 - lockT) + 0.6;
				g.beginPath();
				g.ellipse(r.cx, r.cy - r.riseH * lift, rr, rr * RITE_K, 0, 0, TAU);
				g.stroke();
				g.restore();
			}
		}

		// 粒子层：加色混合（薄光边缘、尘、被拉长的光丝都靠它）
		gs.save();
		gs.globalCompositeOperation = "lighter";
		for (const sp of sparks) {
			const f = clamp(1 - sp.t / sp.life, 0, 1);
			const [cr, cg, cb] = sp.rgb;
			if (sp.kind === "fog") {
				const grd = gs.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, sp.r);
				grd.addColorStop(0, `rgb(${cr} ${cg} ${cb} / ${0.05 * f})`);
				grd.addColorStop(1, `rgb(${cr} ${cg} ${cb} / 0)`);
				gs.fillStyle = grd;
				gs.fillRect(sp.x - sp.r, sp.y - sp.r, sp.r * 2, sp.r * 2);
				continue;
			}
			const sp0 = Math.hypot(sp.vx, sp.vy);
			const stretch = clamp(sp0 * 0.035, 0, 22);
			const a = (sp.kind === "flash" ? 0.95 : 0.55) * f;
			gs.globalAlpha = clamp(a, 0, 1);
			gs.strokeStyle = `rgb(${cr} ${cg} ${cb})`;
			gs.lineWidth = sp.r;
			if (stretch > 2) {
				const inv = 1 / (sp0 || 1);
				gs.beginPath();
				gs.moveTo(sp.x, sp.y);
				gs.lineTo(sp.x - sp.vx * inv * stretch, sp.y - sp.vy * inv * stretch);
				gs.stroke();
			} else {
				gs.beginPath();
				gs.arc(sp.x, sp.y, sp.r * 0.5, 0, TAU);
				gs.fillStyle = `rgb(${cr} ${cg} ${cb})`;
				gs.fill();
			}
		}
		if (shockRing) {
			const u = clamp(shockRing.t / 1.1, 0, 1);
			const f = 1 - u;
			gs.globalAlpha = f * 0.35;
			gs.strokeStyle = `rgb(${COLD.join(" ")})`;
			gs.lineWidth = 1.4 * f + 0.4;
			gs.beginPath();
			gs.arc(
				shockRing.x,
				shockRing.y,
				12 + u * Math.min(v.w, v.h) * 0.24,
				0,
				TAU,
			);
			gs.stroke();
		}
		gs.restore();
	}

	return {
		resize(v: View) {
			view = v;
		},
		spawn,
		update,
		draw,
		forceDissolve,
		grab,
		drag,
		release,
		count: () => rites.length,
		newest: () => rites[rites.length - 1] ?? null,
		shock,
		clear() {
			rites = [];
			sparks = [];
			shockRing = null;
		},
	};
}

/**
 * 各阵型的 wire 数 / 描边数（离线无头试炼台实测，1440×900、R ≈ 181~239px、
 * 完全升起那一帧）。**这一版是照 16 张设定图重做 `rim` 边饰之后的读数。**
 * 🔴 这张表是**笔画预算**的唯一账本：每条线最多描两趟（辉光 + 芯）× 前后两个 half，
 *    同屏三座就是三倍；wire 数过 70 开始吃帧。加图元之前先看这里还剩多少。
 *
 *   k00 三重圆环阵   34 / 110    k07 太极八卦阵 62 / 166 ← 最满的一个（八卦三爻 + 断爻拆两段）
 *   k01 六芒星几何阵 40 / 120    k08 莲花法阵   48 / 130
 *   k02 月相仪式阵   41 / 128    k09 符文卫星阵 42 / 114
 *   k03 裂纹封印阵   44 / 120    k10 玫瑰涡阵   44 / 124
 *   k04 时空折叠阵   34 / 118    k11 尖芒星阵   62 / 164
 *   k05 幽青八芒阵   50 / 132    k12 星网阵列   51 / 140
 *   k06 暗金星轨阵   49 / 128
 *
 * ⚠️ `subs`（`extra` 里那批一起描的细纹）每座约 **406~442 条**，但**一次 `stroke()`
 *    都不多花** —— 这正是"密度"能白拿的原因。要加密度，加 `subs`，不要加 `wire`。
 * ⚠️ 铭文（`Txt`）是 `fillText` ＋ 一道 `strokeText` 暗描边，**不进 `stroke()` 计数**，
 *    每座 20~36 条；悬浮光环（`Ring3`）0~3 圈。
 * ⚠️ 另外还有**每座 3~4 次全盘径向渐变填充**（发光场 / 盘缘亮箍 / 盘心 / 外溢光晕），
 *    这是"观感"上花钱最狠的一笔，也是降级档唯一砍掉的东西（`s.lite` 省掉外溢光晕）。
 * 满的那两个（k07 / k11）再想加东西只能先砍：k07 把刻度带从 12 条降到 8 条、
 * k11 把第二圈星刺从 16 根降到 12 根，都是这么腾出来的。
 */
