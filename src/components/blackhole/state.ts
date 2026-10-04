// 黑洞法阵：全部共享状态。**只有一个真源** —— 四张画布都只读它，谁也不另存一份。
//
// 为什么必须是一份：这一页有四个会各自动的东西（星野、黑洞吸积盘、法阵、被引力牵引的粒子），
// 而它们又彼此耦合 —— 指针靠近黑洞，吸积盘转得更快、星尘偏转；法阵被吞噬，黑洞脉冲变亮、
// 引力波往外扩一圈，同时又去推星尘。上一页（时间走马灯）在这里吃过亏：钟拨回去了，灯还按
// 原来的速度转。所以这一页的规矩同样是"一份状态，四个读者"。
//
// ⚠️ 两个必须记住的单位约定：
//   · `now` 是**墙钟毫秒**（`Date.now()`），而这一页所有动画常量写的是**秒**。
//     模块内一律 `now * 0.001` 换算 —— 直接相减等于把 2.4 秒当 2.4 毫秒用，
//     症状不是"动画慢"，是"看起来根本没做动画"（走马灯上踩过）。
//   · 高度 `z` 是**像素**，投影时直接减在屏幕 y 上（见 `project`）。

/**
 * 统一状态机。同一时刻只允许一个主动操作 —— 所有 pointerdown 入口都要先过 `claim()`，
 * 抢不到就什么都不做。这是"想拖动法阵，结果把黑洞拖走了"这类串台 bug 的唯一防线。
 */
export type Op = "idle" | "pressing" | "drag_hole" | "drag_rite";

/** 法阵生命周期的六个阶段（spec 点名的六态）。 */
export type Phase =
	| "idle"
	| "generating"
	| "rising"
	| "active"
	| "dissolving"
	| "absorbing";

export type View = {
	/** 逻辑宽高（CSS 像素）与像素比 */
	w: number;
	h: number;
	dpr: number;
	/** 投影用的纵向压缩（越小越"趴"，0.42 约等于从 25° 俯视） */
	k: number;
};

export type Hole = {
	x: number;
	y: number;
	/** 事件视界半径（像素） */
	r: number;
};

export type Shared = {
	op: Op;
	/** 指针位置（CSS 像素），−1 = 不在页面上 */
	px: number;
	py: number;
	/** 黑洞中心（可被拖动偏移，松手弹回页面中心） */
	hx: number;
	hy: number;
	/**_v 是弹簧速度：拖拽时直接给位置，松手后带速度弹回 —— 不带速度会退化成"慢慢爬" */
	hvx: number;
	hvy: number;
	/** 吸积盘自转相位（弧度，只增不减） */
	spin: number;
	/** 吞噬脉冲强度 0..1（连续吞噬会叠加，但有上限） */
	pulse: number;
	/** 指针靠近黑洞的程度 0..1（吸积盘提速、星尘偏转都读它） */
	hover: number;
	/** 已吞噬的法阵数（读数用） */
	swallowed: number;
	/** 引力波：从黑洞往外扩的圈，−1 = 没有 */
	wave: number;
	/** 读数用：最新那座法阵的名字与阶段 */
	focusName: string;
	focusPhase: Phase;
	lite: boolean;
	calm: boolean;
	/** ⚠️ 墙钟毫秒。用时一律 `now * 0.001`。 */
	now: number;
};

export function createShared(): Shared {
	return {
		op: "idle",
		px: -1,
		py: -1,
		hx: 0,
		hy: 0,
		hvx: 0,
		hvy: 0,
		spin: 0,
		pulse: 0,
		hover: 0,
		swallowed: 0,
		wave: -1,
		focusName: "",
		focusPhase: "idle",
		lite: detectLite(),
		calm: detectCalm(),
		now: 0,
	};
}

export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function smoothstep(t: number): number {
	const u = clamp(t, 0, 1);
	return u * u * (3 - 2 * u);
}

/** 指数趋近：与帧率无关的"往目标滑"。`k` 越大越快。 */
export function approach(cur: number, target: number, k: number, dt: number) {
	return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

/** 帧率无关的阻尼弹簧。返回新的 [值, 速度]。⚠️ 必须逐帧带速度，见头注释。 */
export function spring(
	cur: number,
	v: number,
	target: number,
	k: number,
	damp: number,
	dt: number,
): [number, number] {
	const nv = v + (-k * (cur - target) - damp * v) * dt;
	return [cur + nv * dt, nv];
}

/** 无种子随机的可复现源：同一个 seed 每次展开的法阵长得一样（重绘时不能抖）。 */
export function rngOf(seed: number): () => number {
	let s = (seed * 2654435761) >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/**
 * 伪三维投影：法阵活在一个**水平面**里（像地上一座悬浮的仪式平台），
 * 点 (x, y, z)（单位像素，z 向上）落到屏幕上是 `(cx + x, cy + y*k − z)`。
 * `k` 是纵向压缩 —— 整页只在这一个函数里做立体感，别处不许各写一套。
 */
export function project(
	cx: number,
	cy: number,
	x: number,
	y: number,
	z: number,
	k: number,
): [number, number] {
	return [cx + x, cy + y * k - z];
}

/**
 * 高清屏倍率上限。
 * ⚠️ 上限按 dpr 换算后再比，别写死像素 —— 开发机 dpr=1 永远碰不到上限，于是"看不出问题"。
 */
export function dprCap(): number {
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const narrow = typeof window !== "undefined" && window.innerWidth <= 760;
	return Math.min(narrow ? 1.5 : 2, dpr);
}

/** 是不是该走降级路线：窄屏、粗指针、或者机器明显不够。 */
export function detectLite(): boolean {
	if (typeof window === "undefined") return false;
	const coarse = window.matchMedia("(pointer: coarse)").matches;
	const narrow = window.innerWidth <= 760;
	const weak = (navigator.hardwareConcurrency || 8) <= 4;
	return coarse || narrow || weak;
}

export function detectCalm(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
