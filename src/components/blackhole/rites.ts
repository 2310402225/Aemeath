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
 * 台面高度剖面：内高外低、**四层阶梯**。单位 = 升起高度 `riseH`（见 `Wire.z`）。
 * 🔴 参考图里那些法阵都是"一圈套一圈、越往里越高的台"。平滑地线性上升会读成**一顶帽子**，
 *    反过来（外高内低）读成**一只碗** —— 只有阶梯才读成"多层法阵盘"。
 */
function tierOf(rank: number): number {
	if (rank >= 0.9) return 0.04;
	if (rank >= 0.68) return 0.3;
	if (rank >= 0.42) return 0.58;
	return 0.84;
}

/** 折线的 tint：0 主色 / 1 副色（冷白） / 2 猩红（只给裂纹用，少量） */
type Tint = 0 | 1 | 2;

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
	 * 逐点高度（可省），给了就覆盖 `z`：两端不同 = 一道**坡**（把上下两层台阶连起来），
	 * 两端同 x/y 不同高 = 一片**竖刃**。这是"立体"能读出来的两条主要来源。
	 */
	zs?: number[];
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
	phase: Phase;
	/** 当前阶段已经过了多少秒 */
	t: number;
	dur: number;
	/** 0..1：展开度（生成阶段）/ 升起度 / 解体度 —— 同一个数在不同阶段各读各的 */
	u: number;
	drift: boolean;
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
	 * 把一条**平躺**的曲线按"离中心多远"披到台阶上去（逐点高度 `zs`）。
	 * 🔴 给螺旋线用：一圈一圈收进去的涡线如果整条躺在同一层，投影里就会读成
	 *    **一圈同心圆环**（"看起来杂"的头号来源，见 hole.ts 头注释）；披到台阶上之后
	 *    它变成一条**绕着台阶盘上去的旋转楼梯** —— 同一个形状，立刻读得出层次。
	 * ⚠️ 台阶是**阶梯函数**，所以这条线上会出现几段近乎竖直的短跳 —— 那不是瑕疵，
	 *    那正是"走到台阶边缘要抬一步"读出来的东西。
	 */
	const drape = (w: Wire, R: number): Wire => {
		const zs: number[] = [];
		for (let i = 0; i < w.pts.length / 2; i++) {
			const x = w.pts[i * 2] ?? 0;
			const y = w.pts[i * 2 + 1] ?? 0;
			zs.push(tierOf(Math.hypot(x, y) / R));
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
	 * 阵型配方（十三个）。共用同一套骨架：**外圈贴地 → 内圈抬高的四层台**
	 * ＋ 一圈立起来的节点 ＋ 一个中心核。骨架一样，变的是台面上刻什么。
	 *
	 * 三条规矩（都是在这一页翻过车之后定下的）：
	 *   ① 高度一律走 `tierOf(rank)`：外圈贴地、内圈抬高，读成"多层法阵盘"；
	 *      线性上升读成帽子，反过来读成碗（见 `tierOf`）。
	 *   ② 加任何东西之前先问"**它会不会读成一圈同心圆**" —— 同心圆环是"看起来杂"
	 *      的头号来源（见 hole.ts 头注释）。所以环只留有功能的那几圈：外圈、刻度带、轨道。
	 *   ③ 一个阵型控制在 **≤60 条 wire**。每条要描两趟（辉光 + 芯），同屏三座就是
	 *      三百多次 `stroke()`；过了 70 条开始掉帧。各阵型的线数在文件末尾记着。
	 */
	function buildSigil(
		kind: number,
		R: number,
		rand: () => number,
		rings: number,
		nodes: number,
	): Wire[] {
		const out: Wire[] = [];
		const T = tierOf;

		/**
		 * 阶梯剖面：每个方向**一笔**画出"从外圈走进中心"跨过的所有台阶 ——
		 * 每层都是「水平的 tread ＋ 竖直的 riser」，逐点高度 `zs` 让一笔自己折出台阶。
		 * 🔴 这是"立体感"里最省笔画的一条：**一笔 = 一整条剖面的侧影**，八个方向各一笔，
		 *    整座台子立刻从"一张贴纸"变成"一座有厚度的多层盘"。
		 * ⚠️ riser 必须是**同一 (x,y) 上的两个点**（投影里就是一条竖线）。写成"斜着爬上去"
		 *    的话整条会读成一根撑杆，"有几层台阶"就看不出来了。
		 * ⚠️ 四个分界半径（1 / 0.9 / 0.68 / 0.42）与高度取自 `tierOf` 的同一张表 ——
		 *    改 `tierOf` 的阈值就必须回来改这里。
		 */
		const stairs = (n: number, rot: number, rOuter = 1, base = 0.6): Wire[] => {
			const radii = [1, 0.9, 0.9, 0.68, 0.68, 0.42, 0.42, 0.08];
			const zs = [
				T(1),
				T(1),
				T(0.89),
				T(0.89),
				T(0.67),
				T(0.67),
				T(0.41),
				T(0.41),
			];
			const out2: Wire[] = [];
			for (let i = 0; i < n; i++) {
				const a = rot + (TAU * i) / n;
				const c = Math.cos(a);
				const s = Math.sin(a);
				const pts: number[] = [];
				for (const rr of radii)
					pts.push(c * R * rOuter * rr, s * R * rOuter * rr);
				out2.push(wire(pts, zs[0] ?? 0, 0.7, 0, base, zs));
			}
			return out2;
		};

		/** 共用骨架：外圈 ＋ 一圈立起来的节点 ＋ 八道阶梯剖面的侧影。 */
		const frame = (nNode: number, nStair: number, rOuter = 1) => {
			out.push(wire(circle(R * rOuter, 108), T(1), 1, 0, 0.9));
			out.push(...glyphs(R * rOuter * 0.99, nNode, 0.25, T(1), 1));
			out.push(...stairs(nStair, 0.12, rOuter));
		};

		// ── 0 三重圆环阵（基础）：三圈同心环 ＋ 外圈内侧一圈"尺" ＋ 中心小花
		if (kind === 0) {
			frame(nodes, 8);
			for (let i = 0; i < rings; i++) {
				const rk = lerp(0.44, 0.8, i / Math.max(1, rings - 1));
				out.push(wire(circle(R * rk, 96), T(rk), rk, 0, 0.85));
			}
			out.push(...band(R * 0.82, R * 0.94, 16, 0.08, T(0.88), 0.88, 0.5));
			out.push(wire(circle(R * 0.3, 64), T(0.3), 0.3, 1, 0.8));
			out.push(...fins(R * 0.56, 4, 0.2, Math.PI / 4, 0.56, 0, 0.6, T(0.58)));
			out.push(...petals(R * 0.2, 6, R * 0.1, 0.4, 0.24, 1, 0.75));
		}

		// ── 1 六芒星几何阵：一笔六芒 ＋ 内六边形弦网 ＋ 六个顶点各立一刃
		if (kind === 1) {
			frame(12, 8);
			out.push(wire(poly(R * 0.62, 6, 0.3), T(0.62), 0.62, 1, 0.7));
			out.push(...web(R * 0.62, 6, 2, 0.3, T(0.62), 0.62, 1, 0.5));
			out.push(...stars(R * 0.88, 6, 2, 0.3, T(0.88), 0.88, 0, 0.95));
			out.push(...fins(R * 0.88, 6, 0.24, 0.3, 0.88, 0, 0.8, T(0.9)));
			out.push(wire(circle(R * 0.24, 48), T(0.24), 0.24, 1, 0.85));
			out.push(...petals(R * 0.36, 6, R * 0.1, 0.3, 0.36, 1, 0.6));
		}

		// ── 2 月相仪式阵：两枚交错的月轨 ＋ 八枚月牙 ＋ 一圈密刻
		if (kind === 2) {
			frame(8, 8);
			out.push(
				wire(ellipse(R * 0.82, R * 0.34, -0.3, 96), T(0.82), 0.82, 0, 0.8),
			);
			out.push(
				wire(ellipse(R * 0.82, R * 0.34, 0.3, 96), T(0.82), 0.82, 1, 0.55),
			);
			out.push(wire(ellipse(R * 0.5, R * 0.22, 0.5, 72), T(0.5), 0.5, 1, 0.5));
			out.push(...band(R * 0.86, R * 0.94, 12, 0, T(0.9), 0.9, 0.45));
			out.push(...hooks(R * 0.68, 8, R * 0.085, 0.4, 0.68, 1, 0.85));
			out.push(...fins(R * 0.42, 4, 0.18, Math.PI / 4, 0.42, 1, 0.6, T(0.44)));
			out.push(wire(circle(R * 0.16, 40), T(0.16), 0.16, 1, 0.85));
		}

		// ── 3 裂纹封印阵：方框封印 ＋ 锯齿裂纹 ＋ 四角立碑
		if (kind === 3) {
			frame(8, 8);
			out.push(wire(poly(R * 0.86, 4, Math.PI / 4), T(0.86), 0.86, 0, 0.85));
			out.push(wire(poly(R * 0.62, 4, 0), T(0.62), 0.62, 1, 0.6));
			const n = 5 + Math.floor(rand() * 3);
			for (let i = 0; i < n; i++) {
				out.push(
					crack(
						R * (0.24 + rand() * 0.1),
						R * (0.86 + rand() * 0.12),
						(TAU * i) / n + rand() * 0.3,
						rand,
						rand() < 0.35 ? 2 : 0,
						T(0.88),
						0.88,
					),
				);
			}
			out.push(...fins(R * 0.86, 4, 0.22, Math.PI / 4, 0.86, 0, 0.7, T(0.88)));
			out.push(wire(circle(R * 0.2, 40), T(0.2), 0.2, 1, 0.8));
			out.push(...band(R * 0.68, R * 0.78, 12, 0.2, T(0.72), 0.72, 0.45));
		}

		// ── 4 时空折叠阵：四层错位椭圆叠成"折扇" ＋ 折轴上的立刃
		if (kind === 4) {
			frame(8, 8);
			for (let i = 0; i < 4; i++) {
				const rk = 0.46 + i * 0.14;
				out.push(
					wire(
						ellipse(R * rk, R * rk * 0.4, i * 1.0, 84),
						T(rk),
						rk,
						i === 1 || i === 3 ? 1 : 0,
						0.7,
					),
				);
			}
			out.push(...fins(R * 0.92, 4, 0.28, 0.4, 0.92, 0, 0.7, T(0.94)));
			out.push(
				...fins(R * 0.5, 4, 0.18, 0.4 + Math.PI / 4, 0.5, 1, 0.6, T(0.54)),
			);
			out.push(...petals(R * 0.3, 4, R * 0.12, 0.4, 0.3, 1, 0.6));
			out.push(wire(circle(R * 0.14, 36), T(0.14), 0.14, 1, 0.85));
		}

		// ── 5 幽青八芒阵：一笔八芒 ＋ 两个正方 ＋ 八颗卫星盘
		if (kind === 5) {
			frame(16, 8);
			out.push(...stars(R * 0.9, 8, 3, 0.2, T(0.9), 0.9, 0, 0.95));
			out.push(wire(poly(R * 0.6, 4, 0.2), T(0.6), 0.6, 1, 0.65));
			out.push(wire(poly(R * 0.6, 4, 0.2 + Math.PI / 4), T(0.6), 0.6, 1, 0.65));
			out.push(...satellites(R * 0.9, 8, R * 0.05, 0.2, 0.9, 1, 0.8));
			out.push(
				...fins(R * 0.6, 4, 0.2, 0.2 + Math.PI / 4, 0.6, 0, 0.65, T(0.62)),
			);
			out.push(wire(circle(R * 0.2, 40), T(0.2), 0.2, 1, 0.85));
		}

		// ── 6 暗金星轨阵：两条反向的扁轨道 ＋ 十二道星轨斜撑 ＋ 轨道上的行星
		if (kind === 6) {
			frame(12, 8);
			out.push(
				wire(ellipse(R * 0.94, R * 0.2, 0.5, 96), T(0.94), 0.94, 0, 0.65),
			);
			out.push(wire(ellipse(R * 0.7, R * 0.3, -0.6, 84), T(0.7), 0.7, 1, 0.5));
			out.push(
				...ramps(R * 0.28, R * 0.88, T(0.4), T(0.92), 12, 0.1, 0.9, 0.5),
			);
			out.push(...satellites(R * 0.94, 4, R * 0.045, 0.5, 0.94, 0, 0.85));
			out.push(wire(circle(R * 0.26, 48), T(0.26), 0.26, 0, 0.8));
			out.push(...petals(R * 0.4, 8, R * 0.085, 0.2, 0.4, 1, 0.55));
		}

		// ── 7 太极八卦阵（参考图 09 罗盘）：双环 ＋ 外圈刻度 ＋ 八卦爻线 ＋ 太极核
		if (kind === 7) {
			frame(8, 4);
			out.push(wire(circle(R * 0.86, 108), T(0.86), 0.86, 0, 0.85));
			out.push(wire(circle(R * 0.66, 96), T(0.66), 0.66, 1, 0.65));
			// ⚠️ 刻度只给 8 条。这套"8 组 ×三爻 + 断爻拆两段"本身就有 32 条 wire，
			//    再叠三条环就破 60 了（见文件末尾的线数表）。
			out.push(...band(R * 0.88, R * 0.96, 8, 0.06, T(0.92), 0.92, 0.5));
			// 八卦：8 组、每组三条短横；断的那一爻拆成两段 —— 认得出是"卦"
			for (let i = 0; i < 8; i++) {
				const a = 0.4 + (TAU * i) / 8;
				for (let k = 0; k < 3; k++) {
					const rr = R * (0.5 + k * 0.056);
					const dA = (R * 0.05) / Math.max(rr, 1);
					if ((i * 3 + k) % 3 === 0) {
						out.push(bar(rr, a - dA, a - dA * 0.28, T(0.6), 0.6));
						out.push(bar(rr, a + dA * 0.28, a + dA, T(0.6), 0.6));
					} else {
						out.push(bar(rr, a - dA, a + dA, T(0.6), 0.6));
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
		}

		// ── 8 莲花法阵（参考图 08 / 12）：内外两圈花瓣错开 22.5° ＋ 中心莲台
		if (kind === 8) {
			frame(8, 6);
			out.push(wire(circle(R * 0.88, 108), T(0.88), 0.88, 1, 0.7));
			out.push(...band(R * 0.9, R * 0.98, 12, 0.1, T(0.94), 0.94, 0.45));
			out.push(...petals(R * 0.66, 8, R * 0.19, 0.3, 0.7, 0, 0.85));
			out.push(
				...petals(R * 0.4, 8, R * 0.12, 0.3 + Math.PI / 8, 0.45, 1, 0.7),
			);
			out.push(
				...hooks(R * 0.52, 8, R * 0.06, 0.3 + Math.PI / 8, 0.52, 1, 0.5),
			);
			out.push(wire(poly(R * 0.3, 4, Math.PI / 4), T(0.3), 0.3, 0, 0.7));
			out.push(wire(circle(R * 0.15, 40), T(0.15), 0.15, 1, 0.85));
		}

		// ── 9 符文卫星阵（参考图 10 / 13）：四个卫星盘挂在 45° 对角上
		if (kind === 9) {
			frame(8, 6);
			out.push(wire(poly(R * 0.64, 4, Math.PI / 4), T(0.64), 0.64, 0, 0.85));
			out.push(wire(poly(R * 0.46, 4, 0), T(0.46), 0.46, 1, 0.65));
			out.push(...stars(R * 0.34, 8, 3, Math.PI / 8, T(0.34), 0.34, 0, 0.8));
			out.push(...satellites(R * 0.66, 4, R * 0.14, Math.PI / 4, 0.7, 1, 0.85));
			out.push(...fins(R * 0.62, 4, 0.24, Math.PI / 4, 0.62, 0, 0.7, T(0.66)));
			out.push(...glyphs(R * 0.38, 8, 0, T(0.38), 0.38, 0.7));
			out.push(wire(circle(R * 0.14, 36), T(0.14), 0.14, 1, 0.9));
		}

		// ── 10 玫瑰涡阵（参考图 11）：五条涡线错开起角，沿台阶盘上去
		if (kind === 10) {
			frame(8, 6);
			for (let i = 0; i < 5; i++) {
				out.push(
					drape(
						spiral(
							R * 0.92,
							R * 0.18,
							1.5,
							(TAU * i) / 5,
							0.9,
							i % 2 ? 1 : 0,
							0.5,
						),
						R,
					),
				);
			}
			// ⚠️ 涡线披到台阶上之后**不再需要**这条 0.66R 的环 ——
			//    留着它就正好凑成"一圈同心圆环"（原来它存在是因为涡线本身太扁，
			//    现在涡线自己有层次了）。省下的 1 条换给 `fins`。
			out.push(...band(R * 0.9, R * 0.98, 12, 0.1, T(0.94), 0.94, 0.45));
			out.push(...fins(R * 0.94, 5, 0.2, 0.1, 0.94, 0, 0.6, T(0.96)));
			out.push(spiral(R * 0.15, R * 0.02, 1.1, 0.5, 0.2, 1, 0.9));
			out.push(...petals(R * 0.26, 5, R * 0.08, 0.5, 0.28, 0, 0.7));
		}

		// ── 11 尖芒星阵（参考图 14）：内外两圈长短星刺 ＋ 八芒 ＋ 一圈节点
		if (kind === 11) {
			frame(8, 6, 0.96);
			out.push(...spikes(R * 0.96, R * 1.16, 8, 0.2, 0.04, 0.6));
			out.push(
				...spikes(R * 0.96, R * 1.06, 12, 0.2 + Math.PI / 12, 0.04, 0.4),
			);
			out.push(...stars(R * 0.78, 8, 3, 0.2, T(0.78), 0.78, 0, 0.9));
			out.push(...band(R * 0.8, R * 0.88, 12, 0.2, T(0.84), 0.84, 0.45));
			out.push(...glyphs(R * 0.68, 8, 0.1, T(0.7), 0.7, 0.7));
			out.push(wire(circle(R * 0.16, 40), T(0.16), 0.16, 1, 0.9));
		}

		// ── 12 星网阵列（参考图 02 / 06）：五芒 ＋ 内层十边形弦网（"星里再分格"）
		if (kind === 12) {
			frame(10, 6, 0.94);
			out.push(wire(poly(R * 0.94, 5, 0.3), T(0.94), 0.94, 1, 0.6));
			out.push(...stars(R * 0.94, 5, 2, 0.3, T(0.94), 0.94, 0, 0.95));
			out.push(...web(R * 0.42, 10, 3, 0.3, T(0.44), 0.44, 1, 0.45));
			out.push(...web(R * 0.42, 10, 4, 0.3, T(0.44), 0.44, 1, 0.35));
			// ⚠️ 这里**不再**补第二圈 glyphs：`frame` 已经在 0.93R 上立了 10 颗，
			//    再立 10 颗只错开 0.05 rad —— 视觉上完全重叠，白花 10 条 wire。
			out.push(...fins(R * 0.94, 5, 0.26, 0.3, 0.94, 0, 0.8, T(0.96)));
			out.push(spiral(R * 0.18, R * 0.02, 1.3, 0.3, 0.22, 1, 0.9));
			out.push(...petals(R * 0.3, 5, R * 0.1, 0.3, 0.34, 1, 0.65));
		}

		return out;
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
		const R = Math.min(v.w, v.h) * 0.34 * (0.72 + rand() * 0.28);
		const liteCap = s.lite ? 0.72 : 1;
		// 升起高度分低/中/高三档（spec §八）。两处觉醒加成：
		//   · 4 阶曜变：整体 +20%
		//   · 8 阶归墟：**自动提升一档**（低→中、中→高、高封顶）—— 与 +20% 是叠加的
		const tier = Math.min(2, Math.floor(rand() * 3) + (s.stage >= 8 ? 1 : 0));
		const riseH =
			R *
			([0.22, 0.36, 0.52][tier] ?? 0.36) *
			liteCap *
			(s.stage >= 4 ? 1.2 : 1);
		// 🔴 钳回可视区。外圈投影到屏幕上是一个**横半轴 R、纵半轴 R*k** 的椭圆，而
		//    `生成法阵` 按钮给的落点是 y = h/2 + sin(a)·h·0.24 —— 在 1258×566 上，
		//    法阵有半个身子落在画布外，看起来就是"法阵被截断了"（其实是中心算到了外面）。
		//    两个入口（点击 / 按钮）都从这里过，所以钳在 spawn 里最省事。
		// ⚠️ 留边按 **1.02R** 而不是 0.94R：尖芒星阵的刺探到 1.16R（唯一一个越过外圈的阵型），
		//    按 0.94 算的话落在画布边上就被切掉一截 —— "刺"变成"平头"。
		const padX = R * 1.02;
		const padY = R * v.k * 1.02 + riseH * 0.45;
		cx = clamp(cx, padX, Math.max(padX, v.w - padX));
		cy = clamp(cy, padY, Math.max(padY, v.h - padY));
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
			rgb2:
				rand() < 0.75
					? COLD
					: (PALETTE[Math.floor(rand() * PALETTE.length)]?.rgb ?? COLD),
			wires: buildSigil(kind, R, rand, rings, nodes),
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
			p.y = rite.cy + Math.sin(a) * rite.R * (0.5 + rand() * 0.5) * view.k;
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
			const [sx, sy] = project(rite.cx, rite.cy, rx, ry, z, view.k);
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

			r.spin += r.spinV * dt;

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
			const d = Math.hypot(x - r.cx, y - r.cy);
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
		// ⚠️ 这里是 `2` 不是 `1`。符文节点是**单点** wire（`[x,y]`），只有 1 个点 ——
		//    按 `n<1` 放过去的话，`at(r,w,1)` 会读到不存在的 pts[2]/pts[3]（→0），
		//    于是每一颗符文都会**多画一条从节点连到法阵中心**的放射线。十几个节点就是十几条，
		//    整座阵"脏"得很，而这是纯粹的绘制 bug，不是设计。
		if (n < 2) return;
		const [ox, oy] = [r.cx, r.cy];
		const k = view.k;
		// 🔴 高度 = "占 riseH 的比例" × 升起高度 × 升起进度。**少了 `r.riseH` 这一项**，
		//    高度就退化成 0.1~1.0 像素 —— 整座法阵看起来完全是平的（之前的症状）。
		const zBase = r.riseH * lift;
		const perVertex = !!w.zs;
		// 逐段画：每段自己的亮度由"深度"决定（前面的亮、后面的暗）
		const total = Math.max(1, Math.round((n - 1) * progress));
		g.beginPath();
		let drawing = false;
		for (let i = 0; i < total; i++) {
			const a = at(r, w, i);
			const b = at(r, w, i + 1);
			// 逐点高度：有 `zs` 就是一道坡（或一片竖刃），没有就是一层平台阶
			const za = zBase * (perVertex ? (w.zs?.[i] ?? w.z) : w.z);
			const zb = zBase * (perVertex ? (w.zs?.[i + 1] ?? w.z) : w.z);
			const [x0, y0] = project(ox, oy, a.rx, a.ry, za, k);
			const [x1, y1] = project(ox, oy, b.rx, b.ry, zb, k);
			const inHalf = (v: number) => (half < 0 ? v < 0 : v >= 0);
			if (!inHalf(a.ry) && !inHalf(b.ry)) continue;
			if (drawing) g.lineTo(x0, y0);
			else {
				g.moveTo(x0, y0);
				drawing = true;
			}
			g.lineTo(x1, y1);
		}
		if (!drawing) return;
		// 前后分层：两趟画（前半 y≥0 / 后半 y<0）本来就是为了让"靠近镜头的那半"亮一档。
		// 原来这里拿 `w.pts[1]`（起点的局部 y）当深度 —— 整圈圆环起点固定在 0°，永远算出同一个值，
		// 两层看着一样亮，"立体"就没了。直接按 half 给，才是这两趟画的意义。
		const depth = half > 0 ? 0.95 : 0.45;
		const core = clamp(alpha * depth * w.base, 0, 1);
		g.strokeStyle = tintCss(r, w.tint);
		const lw = Math.max(0.7, 1.5 + w.base * 1.7);
		// 🔴 辉光那一趟只给"主要"的线（`base ≥ 0.5`）。刻度带、爻线、小卷这些细件
		//    在一个阵型里占一半以上 —— 它们本来就不该发光，省下来的正好抵掉新增的图元。
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

	function tintCss(r: Rite, tint: Tint): string {
		if (tint === 1) return `rgb(${r.rgb2.join(" ")})`;
		if (tint === 2) return `rgb(${CRIMSON.join(" ")})`;
		return `rgb(${r.rgb.join(" ")})`;
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
						const [x, y] = project(
							r.cx,
							r.cy,
							p.rx,
							p.ry,
							w.z * r.riseH * lift,
							v.k,
						);
						// ⚠️ 晶体高度按**法阵半径**给。写死 4+10px 的话，法阵一大一小
						//    （R 从 40 到 160）晶体就不成比例了。
						const h = r.R * (0.05 + 0.1 * lift);
						const pulse = 1 + 0.35 * Math.sin(time * 2.4 + w.rank * 9);
						g.save();
						g.globalAlpha = clamp(
							alpha * (win - 0.6) * (0.5 + 0.5 * lift),
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
							alpha * 0.5 * pulse * (0.35 + 0.65 * lift),
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
			}

			// ④ 结构锁定：整座阵一次短促的"上锁"闪光（spec §四 阶段四）。
			//    少了这一下，成形就只是"淡进来了"，立不住。
			if (gen && lockT > 0) {
				const a = (1 - lockT) * 0.5;
				const rr = r.R * (1 + lockT * 0.24);
				g.save();
				g.globalCompositeOperation = "lighter";
				g.strokeStyle = `rgb(${COLD.join(" ")} / ${a})`;
				g.lineWidth = 2.6 * (1 - lockT) + 0.6;
				g.beginPath();
				g.ellipse(r.cx, r.cy, rr, rr * v.k, 0, 0, TAU);
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
 * 各阵型的 wire 数（离线无头试炼台实测，R ≈ 220~300px、完全升起那一帧）。
 * 🔴 这张表是**笔画预算**的唯一账本：每条线要描两趟（辉光 + 芯），同屏三座就是
 *    三倍；过 60 开始吃帧。加图元之前先看这里还剩多少。
 *
 *   k00 三重圆环阵  44~56（随 `nodes` 6/8/12/16、`rings` 2~4 变）
 *   k01 六芒星几何阵 43    k07 太极八卦阵 58 ← 最满的一个（八卦三爻 + 断爻拆两段 = 32 条）
 *   k02 月相仪式阵  45    k08 莲花法阵   54
 *   k03 裂纹封印阵  41~43 k09 符文卫星阵 39
 *   k04 时空折叠阵  34    k10 玫瑰涡阵   43
 *   k05 幽青八芒阵  49    k11 尖芒星阵   57
 *   k06 暗金星轨阵  52    k12 星网阵列   50
 *
 * 满的那两个（k07 / k11）再想加东西，只能先砍：k07 把刻度带从 12 条降到 8 条、
 * k11 把第二圈星刺从 16 根降到 12 根，都是这么腾出来的。
 */
