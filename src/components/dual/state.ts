// 双位面的全部共享状态。**只有一个真源** —— 四张画布都只读它，谁也不另存一份。
//
// 为什么必须是一份：这一页有五个会「各自动」的东西（星空、河、墨、罗盘、胶卷），
// 而它们又彼此耦合（拨针 → 墨变旧 → 星变暖 → 河变慢 → 胶卷滚得更快）。
// 上一版走马灯就在这里吃过亏：钟拨回去了，灯还按原来的速度转。
//
// 状态机只有一个「主动操作」（`op`），场景是另一个维度（`scene`），两者不能互相冒充：
// 拖针的时候场景可能正在从 surface 进到 cosmos，这时候 op 已经是 dragging_pointer，
// 场景过渡必须还能继续跑。

/** 三个位面。surface = 双位面对望（默认），cosmos = 进入星空，ink = 进入水墨。 */
export type Scene = "surface" | "cosmos" | "ink";

/**
 * 统一状态机。同一时刻只允许一个主动操作 —— 所有 pointerdown 入口都要先过
 * `claim()`，抢不到就什么都不做。这是"点一下帧却顺手把罗盘转过来了"这类
 * 串台 bug 的唯一防线。
 */
export type Op =
	| "idle"
	| "dragging_pointer"
	| "dragging_compass"
	| "dragging_text"
	| "rolling_film"
	| "ink_writing"
	| "frame_preview";

export type Dual = {
	scene: Scene;
	/** 场景过渡的连续量：0 = 对称分割，+1 = 星空铺满，−1 = 水墨铺满。 */
	focus: number;
	op: Op;

	/**
	 * 指针相对真实时间转过的**圈数**，正数 = 往过去。
	 * 🔴 只能按帧增量累加（`turns -= delta`，跨 ±π 自己解绕）：用绝对 `atan2`
	 * 会在半圈处折回，于是"再往下拨突然弹回此刻"，最旧的几档永远够不着。
	 */
	turns: number;
	turnsV: number;
	/** `|turns|` 的平滑值，颜色/速度全从它派生（别各处各算一个）。 */
	age: number;

	/** 罗盘的三维姿态：绕屏幕水平轴俯仰、绕垂直轴偏转，都带速度（惯性回摆）。 */
	tiltX: number;
	tiltY: number;
	tiltVX: number;
	tiltVY: number;
	qspin: number;
	qspinV: number;

	/** 汉字刻度环：每圈一个角度 + 一个角速度（松手后阻尼收敛）。 */
	rings: number[];
	ringV: number[];
	/** 正在被拖的环，−1 = 没有。 */
	ringIdx: number;

	/** 胶卷展开度 0..1（1 = 旋开露出罗盘）。 */
	reelOpen: number;
	/** 胶片纹理的自转相位（逻辑①：随时间慢慢滚）。 */
	filmPhase: number;
	/** 跟手相位（逻辑②：拖针时全部快速旋转）。 */
	filmRoll: number;
	/** 随机自转的那一个胶卷（逻辑④）。 */
	soloIdx: number;
	/** 全屏帧：−1 = 未开启。 */
	frame: number;

	/** 指针在画面里的位置（CSS 像素），−1 = 不在。 */
	px: number;
	py: number;
	/** 河被扰动的波幅（会向两侧传播）。 */
	wave: number;

	lite: boolean;
	calm: boolean;
	/** ⚠️ 必须是**墙钟**（`Date.now()`），不是 rAF 时间戳：针角与读数都直接 `new Date(d.now)`。 */
	now: number;
};

/** 每帧算一次的视口量。四张画布共用同一份，别各自量一遍。 */
export type View = {
	/** 逻辑宽高（CSS 像素） */
	w: number;
	h: number;
	dpr: number;
	/** 时间之河所在的 y（CSS 像素）：上半是星空，下半是水墨 */
	river: number;
};

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
export function approach(
	cur: number,
	target: number,
	k: number,
	dt: number,
): number {
	return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

/** 跨 ±π 解绕：把角度差折进 (−π, π]。 */
export function wrapPi(d: number): number {
	let x = d;
	while (x > Math.PI) x -= Math.PI * 2;
	while (x <= -Math.PI) x += Math.PI * 2;
	return x;
}

/** 帧率无关的阻尼弹簧。返回新的 [值, 速度]。 */
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

/** 把 `age`（0..1）缓一下，让最旧的几档有停顿感。 */
export function ageEase(age: number): number {
	return smoothstep(clamp(age * 1.15, 0, 1));
}

/**
 * 墨色随罗盘偏移变旧：从亮墨走向褐墨。
 * ⚠️ 这里返回的是 RGB 而不是 rgba 字符串：墨痕要做 alpha 合成、要算洇的浓淡，
 * 拼字符串每次都得分一次，反而更慢也更难读。
 */
export function inkRgb(d: Dual): [number, number, number] {
	const t = ageEase(d.age);
	return [
		Math.round(lerp(30, 112, t)),
		Math.round(lerp(28, 84, t)),
		Math.round(lerp(26, 56, t)),
	];
}

export function inkCss(d: Dual, alpha: number): string {
	const [r, g, b] = inkRgb(d);
	return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1)})`;
}

/** 金：罗盘外圈、记忆点、河的金纹共用一支。旧了就沉一点。 */
export function goldCss(d: Dual, alpha: number): string {
	const t = ageEase(d.age);
	return `rgb(${Math.round(lerp(214, 158, t))} ${Math.round(
		lerp(176, 122, t),
	)} ${Math.round(lerp(96, 58, t))} / ${clamp(alpha, 0, 1)})`;
}

/** 星空被"旧"染暖、变暗。 */
export function starTint(d: Dual): [number, number, number] {
	const t = ageEase(d.age);
	return [lerp(1, 0.72, t), lerp(1, 0.66, t), lerp(1, 0.6, t)];
}

/** 河道分割线的高度（CSS 像素）。+1 → 涨到 0.86h，−1 → 落到 0.14h。 */
export function riverY(d: Dual, h: number): number {
	return h * (0.5 + 0.36 * clamp(d.focus, -1, 1));
}

/** 各场景在 `focus` 下的目标值。 */
export function sceneFocus(s: Scene): number {
	return s === "cosmos" ? 1 : s === "ink" ? -1 : 0;
}

/**
 * 高清屏倍率上限。
 * ⚠️ 上限必须按 dpr 换算后再比，而不是写死像素 —— 开发机 dpr=1 永远碰不到上限，
 * 于是"看不出问题"。窄屏（≤760px）压到 1.5：四张全屏画布在手机上按 3 倍铺
 * 会直接把内存吃光。
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

export function createDual(): Dual {
	return {
		scene: "surface",
		focus: 0,
		op: "idle",
		turns: 0,
		turnsV: 0,
		age: 0,
		tiltX: 0,
		tiltY: 0,
		tiltVX: 0,
		tiltVY: 0,
		qspin: 0,
		qspinV: 0,
		rings: [0, 0, 0],
		ringV: [0, 0, 0],
		ringIdx: -1,
		reelOpen: 0,
		filmPhase: 0,
		filmRoll: 0,
		soloIdx: -1,
		frame: -1,
		px: -1,
		py: -1,
		wave: 0,
		lite: detectLite(),
		calm: detectCalm(),
		now: 0,
	};
}
