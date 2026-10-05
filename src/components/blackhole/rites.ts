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
 * 七种阵型（spec §三 的随机库）。**索引就是 `kind`**，`buildSigil` 按它分支 ——
 * 所以下面那两张"哪几号属于哪一档"的表只能改内容、不能改顺序。
 */
const KINDS = [
	"三重圆环阵",
	"六芒星几何阵",
	"月相仪式阵",
	"裂纹封印阵",
	"时空折叠阵",
	"幽青八芒阵",
	"暗金星轨阵",
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

/** 折线的 tint：0 主色 / 1 副色（冷白） / 2 猩红（只给裂纹用，少量） */
type Tint = 0 | 1 | 2;

type Wire = {
	/** 扁平坐标 [x0,y0,x1,y1,…]，原点在法阵中心、单位像素 */
	pts: number[];
	/** 立体高度（像素），升起时按 lift 放大 */
	z: number;
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

	/** 放射线：n 条从 r0 到 r1 的短线（各自是一条 wire）。 */
	const spokes = (
		r0: number,
		r1: number,
		n: number,
		rot: number,
		z: number,
		rank: number,
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			out.push(
				wire(
					[
						Math.cos(a) * r0,
						Math.sin(a) * r0,
						Math.cos(a) * r1,
						Math.sin(a) * r1,
					],
					z,
					rank,
					0,
					0.85,
				),
			);
		}
		return out;
	};

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
	): Wire[] => {
		const out: Wire[] = [];
		for (let i = 0; i < n; i++) {
			const a = rot + (TAU * i) / n;
			const w = wire([Math.cos(a) * r, Math.sin(a) * r], z, rank, 1, 0.9);
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
	): Wire {
		return { pts, z, rank, tint, glyph: false, broke: false, base };
	}

	// ─────────────────────────────────────────── 七种阵型的配方

	function buildSigil(
		kind: number,
		R: number,
		rand: () => number,
		rings: number,
		nodes: number,
	): Wire[] {
		const out: Wire[] = [];
		const zOf = (rank: number) => (0.16 + 0.84 * rank) * 1; // 外圈高 → 圆台

		if (kind === 0 || kind === 6) {
			// 三重圆环阵 / 暗金星轨阵：同心环 + 刻度
			for (let i = 0; i < rings; i++) {
				const rk = lerp(0.4, 1, i / Math.max(1, rings - 1));
				const r = R * rk;
				out.push(
					wire(
						circle(r, 96),
						zOf(rk) * (i === rings - 1 ? 1 : 0.6),
						rk,
						0,
						0.9,
					),
				);
			}
			out.push(...glyphs(R * 0.86, nodes, 0.2, zOf(0.86), 0.86));
		}
		if (kind === 0 || kind === 3) {
			out.push(wire(circle(R * 0.62, 72), zOf(0.62) * 0.5, 0.62, 1, 0.55));
		}
		if (kind === 6) {
			// 星轨：压得很扁的椭圆 + 放射刻度
			out.push(
				wire(
					ellipse(R * 0.96, R * 0.2, 0.5, 96),
					zOf(0.96) * 0.4,
					0.96,
					0,
					0.5,
				),
			);
			out.push(...spokes(R * 0.42, R * 0.72, 12, 0.1, zOf(0.6) * 0.4, 0.6));
		}
		if (kind === 1 || kind === 5 || kind === 3) {
			// 六芒星 / 八芒：两个反向多边形叠起来
			const sides = kind === 5 ? 4 : 3;
			for (let s = 0; s < 2; s++) {
				out.push(
					wire(
						poly(R * 0.66, sides, (s * Math.PI) / sides),
						zOf(0.66) * 0.7,
						0.66,
						0,
						0.8,
					),
				);
			}
			out.push(wire(circle(R * 0.92, 96), zOf(0.92), 0.92, 0, 0.6));
		}
		if (kind === 5) {
			out.push(...spokes(R * 0.5, R, 8, 0.15, zOf(1) * 0.9, 1));
			out.push(...glyphs(R, 8, 0.15, zOf(1), 1));
		}
		if (kind === 2) {
			// 月相：节点上挂月牙（用两段弧线表示）
			out.push(
				wire(
					ellipse(R * 0.88, R * 0.4, -0.35, 96),
					zOf(0.88) * 0.5,
					0.88,
					0,
					0.6,
				),
			);
			out.push(
				wire(
					ellipse(R * 0.88, R * 0.4, 0.35, 96),
					zOf(0.88) * 0.5,
					0.88,
					1,
					0.4,
				),
			);
			for (let i = 0; i < nodes; i++) {
				const a = 0.3 + (TAU * i) / nodes;
				const r = R * 0.7;
				const w = wire(
					ellipse(0.11 * R, 0.11 * R, 0, 14, Math.PI * 1.15, a),
					0,
					r / R,
					1,
					0.95,
				);
				for (let k = 0; k < w.pts.length; k += 2) {
					w.pts[k] += Math.cos(a) * r;
					w.pts[k + 1] += Math.sin(a) * r;
				}
				w.z = zOf(r / R) * 0.8;
				out.push(w);
			}
		}
		if (kind === 3) {
			// 裂纹封印：几条锯齿裂纹，其中一两条是猩红
			const n = 5 + Math.floor(rand() * 3);
			for (let i = 0; i < n; i++) {
				out.push(
					crack(
						R * (0.28 + rand() * 0.12),
						R * (0.9 + rand() * 0.1),
						(TAU * i) / n + rand() * 0.3,
						rand,
						rand() < 0.35 ? 2 : 0,
						zOf(0.9) * 0.3,
						0.9,
					),
				);
			}
		}
		if (kind === 4) {
			// 时空折叠：多层错位椭圆
			for (let i = 0; i < 3; i++) {
				const rk = 0.55 + i * 0.22;
				out.push(
					wire(
						ellipse(R * rk, R * rk * 0.42, i * 1.1, 96),
						zOf(rk) * (0.35 + i * 0.3),
						rk,
						i === 1 ? 1 : 0,
						0.7,
					),
				);
			}
			out.push(...glyphs(R * 0.55, nodes, 0.6, zOf(0.55), 0.55));
		}
		// 每个阵都有一圈"节点"作为骨架，缺了会显得空
		if (kind !== 5 && kind !== 2 && kind !== 6) {
			out.push(...glyphs(R, nodes, 0.35, zOf(1), 1));
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
		const padX = R * 0.94;
		const padY = R * v.k * 0.94 + riseH * 0.45;
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
						w.z * (1 - r.u),
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
		const z = w.z * lift;
		// 逐段画：每段自己的亮度由"深度"决定（前面的亮、后面的暗）
		const total = Math.max(1, Math.round((n - 1) * progress));
		g.beginPath();
		let drawing = false;
		for (let i = 0; i < total; i++) {
			const a = at(r, w, i);
			const b = at(r, w, i + 1);
			const [x0, y0] = project(ox, oy, a.rx, a.ry, z, k);
			const [x1, y1] = project(ox, oy, b.rx, b.ry, z, k);
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
		// 两趟描同一条路径：先一圈宽的当辉光，再一圈窄的当芯。
		// 想用 shadowBlur 一把梭？每帧上百条折线（外圈一条就是 96 段），那一项直接吃掉整页预算。
		g.globalAlpha = core * 0.16;
		g.lineWidth = (1.5 + w.base * 1.7) * 2.6;
		g.stroke();
		g.globalAlpha = core;
		g.lineWidth = 1.5 + w.base * 1.7;
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
						const [x, y] = project(r.cx, r.cy, p.rx, p.ry, w.z * lift, v.k);
						const h = 4 + 10 * lift;
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
