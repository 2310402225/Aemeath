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
	/** 静思：0 一切如常，1 全页停住（针不走、灯不转、金尘不逸）。
	 *  写满六句题记之后进这一档 —— 收尾该是安静的，不是再来一轮热闹。 */
	still: number;
	/** 新手引导：0 不用引导，1 该引导（指针轻晃）。
	 *  第一次真正动手之后自己衰减到 0，不需要谁去关它。 */
	hint: number;
	/** 六张灯片是不是都收藏齐了（齐了钟盘外沿出一圈金边）。 */
	allCollected: boolean;
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

/** 灯里的光。新的时候近白的暖黄，越往回拨越偏琥珀 ——
 *  「暖」是色相往橙里走，「暗」是整体亮度降一档。两件事都由 age 驱动，
 *  所以全页二十来处灯光一律调 `lampRgba`，没有哪个模块自己写死一个暖黄。 */
export const LAMP_NEW = [255, 230, 176] as const;
export const LAMP_OLD = [214, 154, 82] as const;

/** 灯片的木框。纸上的木也是会旧的，跟墨同一个规矩。 */
export const WOOD = [126, 94, 58] as const;
export const WOOD_AGED = [98, 72, 44] as const;

/** 灯壁：灯笼的内壁。**这一页唯一的「暗端」**，见 clock.ts 的 drawFace。
 *
 *  为什么非得有一档暗的：页面纸色 (240,234,222) 已经接近纯白，往白上加暖光
 *  最多只有六七级差 —— 实测钟内 0.72R 一整圈都是 L≈238，跟纸一个值，
 *  六道光纹画上去等于没画。光在画里不是画出来的，是**被周围的暗衬出来的**。
 *  先把灯的内壁压下去，六张纸灯片才有东西可亮、光纹才有地方可落。
 *
 *  ⚠️ 判定「赭」不许靠眼睛看截图，要量 `max(RGB) − min(RGB)`：赭石这一档得在 65 以上。
 *  第一版挑了 (74,58,42)，算出来只有 32 —— 那是**暖灰**，压到盘上就是一片灰扑扑的尘；
 *  混色混到最后明度掉了、饱和没上来，就是「脏」。
 *
 *  越往回拨越沉成褐 —— 跟灯、木框同一个规矩，由 age 驱动。 */
export const WALL_NEW = [126, 88, 52] as const;
export const WALL_OLD = [98, 66, 38] as const;

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

/** 灯光的 rgba。越旧越暖、越暗 —— 两个变化写在一处，调用方只给一个「要多亮」。 */
export function lampRgba(c: Couplings, alpha: number): string {
	const t = age(c);
	const r = Math.round(lerp(LAMP_NEW[0], LAMP_OLD[0], t));
	const g = Math.round(lerp(LAMP_NEW[1], LAMP_OLD[1], t));
	const b = Math.round(lerp(LAMP_NEW[2], LAMP_OLD[2], t));
	return `rgb(${r} ${g} ${b} / ${clamp(alpha * lerp(1, 0.55, t), 0, 1)})`;
}

/** 灯片木框的 rgba。 */
export function woodRgba(c: Couplings, alpha: number): string {
	const t = age(c);
	const r = Math.round(lerp(WOOD[0], WOOD_AGED[0], t));
	const g = Math.round(lerp(WOOD[1], WOOD_AGED[1], t));
	const b = Math.round(lerp(WOOD[2], WOOD_AGED[2], t));
	return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1)})`;
}

/** 灯壁的 rgba。浓度由调用方给 —— 灯壁是一道**从灯心往灯边渐浓的坡**，
 *  所以同一个颜色要按半径取好几个浓度，不能像灯那样把浓度也写死在这里。 */
export function wallRgba(c: Couplings, alpha: number): string {
	const t = age(c);
	const r = Math.round(lerp(WALL_NEW[0], WALL_OLD[0], t));
	const g = Math.round(lerp(WALL_NEW[1], WALL_OLD[1], t));
	const b = Math.round(lerp(WALL_NEW[2], WALL_OLD[2], t));
	return `rgb(${r} ${g} ${b} / ${clamp(alpha, 0, 1)})`;
}

/**
 * 四张画布共用的分辨率上限。
 *
 * 窄屏（手机）给到 1.5 就够：四张全屏画布按 dpr=2 铺开是 4×(2w×2h) 个设备像素，
 * Safari 在这种量级上会掉到 30 以下，而 dpr 从 2 降到 1.5、像素面积就砍掉 44%，
 * 是这一页唯一真正有效的那一档性能杠杆（水彩一样的软边看不出这 0.5 的差别）。
 */
export function dprCap(): number {
	const raw = window.devicePixelRatio || 1;
	const narrow = Math.min(window.innerWidth, window.innerHeight) < 760;
	return Math.min(narrow ? 1.5 : 2, raw);
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
