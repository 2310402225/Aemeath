// 一份时间状态，四处交互都读它。
//
// 这一页有四组交互（拨钟 / 走马灯 / 写字 / 彩蛋），如果各自维护一份「现在是什么时候」，
// 画面迟早会对不上（钟拨回去了，灯还在按原来的速度转，纸也没褪色）。
// 所以把它们压成一份状态 + 一组派生量，任何模块只读不写，改动一律走下面的函数。

export type Couplings = {
	/** 0 = 此刻；1 = 拨到最旧。只有拨针与滚轮会写它。 */
	rewind: number;
	/** 拨针正在被拖（这期间不让自动回正，否则跟手打架）。 */
	dragging: boolean;
	/** 时间流速：1 是常速。滚轮 / 双指上下滑改它，灯环转速乘它。 */
	speed: number;
	/** 风动：0 静，1 长风扫墨。由近期指针速度衰减而来。 */
	wind: number;
	/** 焦点让位：0 = 全都在台上；1 = 有一张灯片展开、占住了钟心。
	 *  这时针、刻度、转盘环都该退到后面去 —— 不然针尖会从灯片上边戳出来一截，
	 *  看着像画错的一道墨。由 carousel 每帧从 ring.expandProgress() 写进来。 */
	focus: number;
	/** 已经放了多久（秒，按真实时间走，不受 speed 影响）—— 用来做呼吸与尘埃。 */
	clock: number;
	/** 系统是否要求减少动态效果。 */
	calm: boolean;
};

export const PAPER = "#f5f0e6";
export const PAPER_EDGE = "#e7dfcd";
/** 浓墨与「褪色后的墨」。旧时光不是加一层黄滤镜，是墨自己变淡、变褐。 */
export const INK = [28, 26, 23] as const;
export const INK_AGED = [86, 74, 56] as const;
/** 收藏用的金，取旧金而不是亮金：亮金在米白纸上会浮起来，像贴上去的。 */
export const GOLD = [168, 130, 58] as const;

export const REWIND_MIN = 0;
export const REWIND_MAX = 1;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;

export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** 缓入缓出，用来把「指针角度」变成「时间倒流度」这类需要停顿感的量。 */
export function smoothstep(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

/** 旧时光滤镜的浓度。真正的视觉由各模块自己插值，这里只给一个统一的进度。 */
export function age(c: Couplings): number {
	return smoothstep(c.rewind);
}

/** 混出一支「会随年代变老的墨」。各模块画线时一律调用它，别自己写死颜色。 */
export function inkColor(c: Couplings, tone = 1): string {
	const t = age(c);
	const r = Math.round(lerp(INK[0], INK_AGED[0], t) * tone);
	const g = Math.round(lerp(INK[1], INK_AGED[1], t) * tone);
	const b = Math.round(lerp(INK[2], INK_AGED[2], t) * tone);
	return `rgb(${r} ${g} ${b})`;
}

/** 同一个墨色的 rgba 版本（需要透明度时用）。tone 越大越浓。 */
export function inkRgba(c: Couplings, alpha: number, tone = 1): string {
	const t = age(c);
	const r = Math.round(lerp(INK[0], INK_AGED[0], t) * tone);
	const g = Math.round(lerp(INK[1], INK_AGED[1], t) * tone);
	const b = Math.round(lerp(INK[2], INK_AGED[2], t) * tone);
	return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1)})`;
}

export function goldRgba(alpha: number): string {
	return `rgb(${GOLD[0]} ${GOLD[1]} ${GOLD[2]} / ${clamp(alpha, 0, 1)})`;
}

/**
 * 把「指针逆时针扫过的角度」变成倒流度。
 *
 * 一圈 = 一整段可以用来回望的时间，指针回到 12 点方向即此刻（rewind = 0）。
 * 取 smoothstep 是为了两头有停顿：刚离开此刻时不该立刻整页变色，
 * 快到最旧时也不该还在猛变（那样指针的手感会「滑」）。
 */
export function rewindFromAngle(swept: number): number {
	const turns = clamp(swept / (Math.PI * 2), 0, 1);
	return smoothstep(turns * 1.0);
}

/** 读数文案。四点五档足够表达「退回去了多远」，不必真的编年代。 */
const ERA_WORDS = ["此刻", "近年", "旧日", "少年", "幼时"];
export function eraWord(c: Couplings): string {
	if (c.rewind <= 0.005) return ERA_WORDS[0];
	const idx =
		1 + Math.floor(clamp(c.rewind, 0, 0.999) * (ERA_WORDS.length - 1));
	return ERA_WORDS[Math.min(idx, ERA_WORDS.length - 1)];
}

/** 流速的读数：1.00x 这种，滚轮一动就能看见反馈。 */
export function speedWord(c: Couplings): string {
	if (Math.abs(c.speed - 1) < 0.02) return "常速";
	return `${c.speed.toFixed(2)}×`;
}
