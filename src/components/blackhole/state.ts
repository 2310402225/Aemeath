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
//   · 高度 `z` 在这条链上有**两个单位**，别混：传给 `project()` 的 `z` 是**像素**，
//     而法阵 `Wire.z` 是"占该座升起高度 `riseH` 的比例"（画之前乘回 `riseH`，见 rites.ts）。

/**
 * 统一状态机。同一时刻只允许一个主动操作 —— 所有 pointerdown 入口都要先过 `claim()`，
 * 抢不到就什么都不做。这是"想拖动法阵，结果把黑洞拖走了"这类串台 bug 的唯一防线。
 * ⚠️ 没有 `drag_hole`：黑洞**钉死在页面中心**，不参与拖拽（理由见 black-hole.ts 头注释）。
 */
export type Op = "idle" | "pressing" | "drag_rite";

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

/**
 * 觉醒四阶（spec §2.3）。阈值 1/2/4/8。
 * 🔴 **由"已吞噬数"派生，不另存一份状态**。过载喷发要把层数打回 1 阶 ——
 *    派生写法只要 `swallowed = 0`，形态、法阵库、反馈自己就全回来了；
 *    置位写法得在"进阶"和"过载"两条路上各写一遍重置，迟早漏一条。
 */
export type Stage = 1 | 2 | 4 | 8;

export function stageOf(swallowed: number): Stage {
	if (swallowed >= 8) return 8;
	if (swallowed >= 4) return 4;
	if (swallowed >= 2) return 2;
	return 1;
}

/** 阶数 → 黑洞半径系数。
 * 🔴 神的要求：「黑洞初始时小一点，最大也就目前大小」→ **8 阶 = 1.0**（就是现在这个尺寸），
 *    1 阶收到 0.76。spec 写的"体积 +15% / +30%"于是落在 4 阶 1.18×、8 阶 1.32×，对得上。 */
export const STAGE_R: Record<Stage, number> = {
	1: 0.76,
	2: 0.84,
	4: 0.9,
	8: 1,
};

/** 坍缩脉冲的总时长（秒）。半径包络、亮度包络、符文圈都按它收尾。 */
export const COLLAPSE_DUR = 1.15;
/** 过载喷发的逆喷时长（秒）。烧完把层数打回 1 阶。 */
export const BURST_DUR = 1.3;

/**
 * 坍缩脉冲的**半径**包络：先收进去（10~15%），再猛地弹出去，然后回落。
 * ⚠️ 只在 `holeOf` 里用这一次 —— 命中判定、法阵生成、绘制全都从那里取半径，
 *    所以"缩进去的那一瞬间点不到洞口"这类错位根本不会发生。
 */
export function collapseR(c: number): number {
	if (c < 0) return 1;
	const A = 0.14;
	const B = 0.2;
	if (c < 0.16) return 1 - A * smoothstep(c / 0.16);
	if (c < 0.34) return 1 - A + (A + B) * smoothstep((c - 0.16) / 0.18);
	return 1 + B * (1 - smoothstep((c - 0.34) / 0.5));
}

/**
 * 坍缩脉冲的**亮度**包络（1 = 常态）：视界先变暗 → 回弹时过曝 → 落回常态。
 * ⚠️ 只乘在透镜那一套（爱因斯坦环、细弧、活丝）上。**盘要留着** ——
 *    全页一起暗下去读成"熄灯"，不是"那个天体自己在收缩"。
 */
export function collapseDark(c: number): number {
	if (c < 0) return 1;
	if (c < 0.18) return 1 - 0.6 * smoothstep(c / 0.18);
	if (c < 0.55) return 0.4 + 0.85 * smoothstep((c - 0.18) / 0.37);
	return 1.25 - 0.25 * smoothstep((c - 0.55) / 0.4);
}

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
	/** 黑洞中心。🔴 **只在 `relayout` 里写一次**（钉死在页面中心，不可拖动）。 */
	hx: number;
	hy: number;
	/** 吸积盘自转相位（弧度，只增不减） */
	spin: number;
	/** 吞噬脉冲强度 0..1（连续吞噬会叠加，但有上限） */
	pulse: number;
	/** 指针靠近黑洞的程度 0..1（吸积盘提速、星尘偏转都读它） */
	hover: number;
	/** 已吞噬的法阵数（读数用）。🔴 也是觉醒阶数的**唯一来源**（`stageOf`）—— 过载喷发把它清零。 */
	swallowed: number;
	/** 觉醒阶数（由 `swallowed` 派生）。形态、法阵库、粒子密度、吞速都读它。 */
	stage: Stage;
	/**
	 * 阶数系数的**平滑跟随值**（≈ `STAGE_R[stage]`，但不是真源 —— 真源是 `stage`）。
	 * 🔴 存在的理由：spec §2.4 要求"阶数跃迁有短暂的形态过渡动画，平滑不突兀"。
	 *    直接用 `STAGE_R[stage]` 的话，吞下第 4 座的那一帧半 radius 会**跳** 6% ——
	 *    一眼就看得出是"换了个尺寸"，不是"长大了"。由接线层用指数趋近推它。
	 */
	rScale: number;
	/** 视界坍缩脉冲计时（秒，<0 = 没有）。点击黑洞本体触发，唯一的写者是接线层。 */
	collapse: number;
	/** 8 阶过载喷发的逆喷计时（秒，<0 = 没有）。烧完把 `swallowed` 打回 0。 */
	burst: number;
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
		spin: 0,
		pulse: 0,
		hover: 0,
		swallowed: 0,
		stage: 1,
		rScale: STAGE_R[1],
		collapse: -1,
		burst: -1,
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
 * 法阵自己的**纵向压缩**。⚠️ 和黑洞那一层不是一套：
 *   · 黑洞是**躺在页面平面里的天体** → `view.k`（0.42，约 25° 俯视）；
 *   · 法阵是**浮在空中、正面朝向镜头的一片圆盘** → 0.84（几乎不压扁）。
 * 🔴 这一条是"法阵不还原"的直接原因：设定图里 16 张法阵**全是正圆顶视曼陀罗**，
 *    按 0.42 压成扁椭圆之后，五芒/六芒/八芒、同心环、放射线全挤成一团，
 *    形状一眼就不对。投影公式还是 `project()` 那一条，只是**传进去的 k 不同**。
 */
export const RITE_K = 0.84;

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
