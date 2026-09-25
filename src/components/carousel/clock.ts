// 墨钟：一只用毛笔画出来的表盘 + 一根可以拨回去的针。
//
// 语义（三处交互都建立在这上面）：
//   一圈 = 一段可以回望的时间，12 点方向是「此刻」。
//   针自己顺时针慢慢走 —— 时间在流逝，所以你拨出来的倒流度会自己慢慢缩小。
//   你把针逆时针推回去，就是让时光倒流：纸开始褪色、墨开始变褐、灯转得慢下来。
//   双击钟心（或按右下角那颗按钮）把针拨回此刻。
//
// 刻度同时是「记忆的落点」：点刻度落一颗永久墨点，收藏一张灯片落一颗金点。

import {
	type Couplings,
	clamp,
	goldRgba,
	inkRgba,
	lerp,
	rewindFromAngle,
	smoothstep,
} from "./couplings";

/** 12 个刻度，4 个主刻度（含 12 点）。 */
export const TICK_COUNT = 12;
const TICK_MAIN_EVERY = 3;

/** 毛笔圆：画一圈要用多少段。抖动表必须与它等长 ——
 *  长度不等就会在 i 绕回 0 的地方把半径硬拽一下，圆上出现一个看得见的折点
 *  （96 段配 72 个抖动值时，折点正好落在 9 点方向）。 */
const RIM_SEGS = 96;
/** 针自己走一圈要多久（秒）。四分钟一圈：看得出在走，又不会一分钟就褪回原样。 */
const DRIFT_LAP_SECONDS = 240;
/** 指针可以被拖到的最外层 / 最内层（相对半径）。 */
const HAND_INNER = 0.16;

function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (1103515245 * s + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

/** 一点落在第几刻度上（0 = 12 点，顺时针）。 */
export function tickAt(x: number, y: number, cx: number, cy: number): number {
	const a = Math.atan2(x - cx, -(y - cy)); // 12 点方向为 0，顺时针为正
	const turns = (((a / (Math.PI * 2)) % 1) + 1) % 1;
	return Math.round(turns * TICK_COUNT) % TICK_COUNT;
}

export type Mark = {
	/** 落在第几刻度 */
	tick: number;
	kind: "ink" | "gold";
	/** 灯片下标（只有金点有） */
	slot: number;
	born: number;
};

export type Clock = {
	resize: () => void;
	frame: (dt: number) => void;
	/** 半径，走马灯要用它算内环 */
	radius: () => number;
	center: () => { x: number; y: number };
	/** 落点在钟的哪一部分：针 / 刻度 / 圆心 / 都不在 */
	partAt: (x: number, y: number) => "hand" | "tick" | "center" | null;
	/** 准备拨针：记下指针当前的角度，之后 drag 靠**累加角差**来转针。
	 *  为什么不拿 atan2 的绝对值直接换算：atan2 只落在 (−π, π]，针一旦被拨过半圈，
	 *  角度就折回来了 —— 表现为「再往下拨突然弹回此刻」，而且 smoothstep 那半边的
	 *  「少年 / 幼时」永远够不着。累加角差没有这个上界。 */
	beginDrag: (x: number, y: number) => void;
	/** 指针按下之后每一动的落点（内部会换算成倒流度） */
	drag: (x: number, y: number) => void;
	endDrag: () => void;
	reset: () => void;
	dropMark: (tick: number, kind: "ink" | "gold", slot?: number) => void;
	marks: () => readonly Mark[];
	/** 倒流度（由 couplings 持有，这里给个只读视图方便自测断言） */
	rewind: () => number;
	/** 唯一的真源：逆时针偏离 12 点的弧度。`rewind` 要等下一帧才会跟上，
	 *  所以要「从当前状态再拨一段」时必须读它，读 rewind 会拿到上一帧的旧值。 */
	sweep: () => number;
};

export function createClock(canvas: HTMLCanvasElement, c: Couplings): Clock {
	const ctxRaw = canvas.getContext("2d");
	if (!ctxRaw) throw new Error("clock: 拿不到 2d 上下文");
	// ⚠️ 必须另绑一个非空常量。`if (!ctx) throw` 的收窄**进不了下面那些被提升的
	// function 声明**（ts 18047）：函数声明会被提到守卫之前，TS 不敢假设守卫跑过。
	// 直接沿用 `ctx` 的话，那几十处全是「possibly null」，而运行期其实一定不空。
	const ctx: CanvasRenderingContext2D = ctxRaw;

	let w = 0;
	let h = 0;
	let dpr = 1;
	let cx = 0;
	let cy = 0;
	let R = 100;
	/** 逆时针偏离「此刻」的弧度，0..2π。这是本页唯一的时间真源。 */
	let swept = 0;
	/** 复位时用的缓动目标（null = 不在复位） */
	let resetting = false;
	/** 拨针时上一帧的指针角，见 beginDrag */
	let lastAngle = 0;
	/** 是不是正在拨（没 beginDrag 就 drag 会被忽略，免得拿陈旧的角算出一次大跳） */
	let turning = false;
	const marks: Mark[] = [];
	/** 纸纹那侧的随机：钟面的圆要有手画的抖，但不能每帧变。
	 *  预先把表旋转出几份，而不是在循环里 `(i + seed) % n` —— 后者到了绕回的那一段
	 *  会从表尾直接跳回表头，半径硬拽一下，圆上就多出一个折点。
	 *  旋转过的表首尾是连着的，怎么绕都不会断。 */
	const base = Array.from({ length: RIM_SEGS }, (_, i) => {
		const rnd = lcg(4471 + i);
		return (rnd() - 0.5) * 2;
	});
	const rimJitter = [0, 17].map((k) => base.slice(k).concat(base.slice(0, k)));
	let t = 0;

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = Math.min(2, window.devicePixelRatio || 1);
		w = Math.max(1, Math.round(rect.width));
		h = Math.max(1, Math.round(rect.height));
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		cx = w / 2;
		// 钟心明显偏下：上面那一条是留给标题的（眉题 + h1 + 副题 + 一句提示），
		// 钟顶必须落在它底下，否则 12 点那张灯片正好被标题压住 —— 六张灯片里
		// 少一张是看不出来的，只会觉得「上面那张怎么是空的」。
		cy = h * 0.6;
		// 宽屏按高度定半径（否则钟会撑出屏幕），窄屏按宽度定（否则手机上钟太小）。
		R = Math.min(w * 0.42, h * 0.33);
	}

	/** 毛笔圆：半径与线宽都带一点抖，闭合处重叠收尾 —— 手画的圆不可能等宽。 */
	function inkCircle(
		radius: number,
		baseWidth: number,
		alpha: number,
		seed: number,
	) {
		const segs = RIM_SEGS;
		// seed 在这里当「第几份抖动表」用（0 = 外圈，17 = 内圈）
		const jitter = rimJitter[seed % rimJitter.length];
		ctx.lineCap = "round";
		for (let i = 0; i < segs; i++) {
			const a0 = (i / segs) * Math.PI * 2;
			const a1 = ((i + 1) / segs) * Math.PI * 2;
			const j0 = jitter[i];
			const j1 = jitter[(i + 1) % segs];
			const r0 = radius + j0 * baseWidth * 0.8;
			const r1 = radius + j1 * baseWidth * 0.8;
			// 线宽沿着圆缓慢变化，像落笔时提按了一次
			const press = 0.55 + 0.45 * Math.sin((i / segs) * Math.PI * 2 + seed);
			ctx.lineWidth = baseWidth * (0.45 + press);
			ctx.strokeStyle = inkRgba(c, alpha * (0.75 + 0.25 * press));
			ctx.beginPath();
			ctx.moveTo(cx + Math.sin(a0) * r0, cy - Math.cos(a0) * r0);
			ctx.lineTo(cx + Math.sin(a1) * r1, cy - Math.cos(a1) * r1);
			ctx.stroke();
		}
	}

	function drawFace() {
		const ageT = c.rewind;
		// 有灯片展开时整圈退到后面：让位，但别整个消失（那是「退后」不是「关灯」）
		const back = 1 - 0.55 * c.focus;
		// 双圈：外圈稍浓、内圈极淡，像两层墨洇开的边
		inkCircle(R, Math.max(1.1, R * 0.0055), 0.72 * back, 0);
		inkCircle(R * 0.955, Math.max(0.6, R * 0.0022), 0.3 * back, 17);

		// 刻度
		for (let i = 0; i < TICK_COUNT; i++) {
			const a = (i / TICK_COUNT) * Math.PI * 2;
			const main = i % TICK_MAIN_EVERY === 0;
			const isNow = i === 0;
			const len = R * (main ? 0.062 : 0.036);
			const width = Math.max(0.9, R * (main ? 0.0085 : 0.0045));
			const r0 = R * 0.935;
			const r1 = r0 - len;
			ctx.strokeStyle = inkRgba(c, (isNow ? 0.8 : main ? 0.6 : 0.34) * back);
			ctx.lineWidth = width;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
			ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
			ctx.stroke();
			// 「此刻」的刻度旁边再点一个更小的点，好认
			if (isNow) {
				ctx.beginPath();
				ctx.arc(
					cx + Math.sin(a) * R * 1.035,
					cy - Math.cos(a) * R * 1.035,
					Math.max(1.4, R * 0.011),
					0,
					Math.PI * 2,
				);
				ctx.fillStyle = inkRgba(c, 0.55 * back);
				ctx.fill();
			}
		}

		// 内环的极淡底圆：给走马灯一个「转盘」的托，不至于悬在空中
		ctx.beginPath();
		ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
		ctx.strokeStyle = inkRgba(c, (0.1 + 0.06 * (1 - ageT)) * back);
		ctx.lineWidth = Math.max(0.6, R * 0.0018);
		ctx.stroke();
	}

	/** 墨点：一颗，不是一圈。三层同心、彼此错开一点，看起来才是墨洇出来的。 */
	function drawDot(
		x: number,
		y: number,
		radius: number,
		kind: "ink" | "gold",
		alpha: number,
	) {
		const rnd = lcg(Math.round(x * 7 + y * 13));
		const layers = kind === "gold" ? 2 : 3;
		for (let i = 0; i < layers; i++) {
			const off = rnd() * radius * 0.5;
			const ang = rnd() * Math.PI * 2;
			const r = radius * (1 - i * 0.24);
			const gx = x + Math.cos(ang) * off;
			const gy = y + Math.sin(ang) * off;
			const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
			if (kind === "gold") {
				grad.addColorStop(0, goldRgba(alpha * 0.95));
				grad.addColorStop(0.55, goldRgba(alpha * 0.55));
				grad.addColorStop(1, goldRgba(0));
			} else {
				grad.addColorStop(0, inkRgba(c, alpha * 0.9));
				grad.addColorStop(0.6, inkRgba(c, alpha * 0.45));
				grad.addColorStop(1, inkRgba(c, 0));
			}
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(gx, gy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawMarks() {
		const back = 1 - 0.55 * c.focus;
		for (const m of marks) {
			const a = (m.tick / TICK_COUNT) * Math.PI * 2;
			const r = R * (m.kind === "gold" ? 0.875 : 0.9);
			const x = cx + Math.sin(a) * r;
			const y = cy - Math.cos(a) * r;
			// 沉淀：落得越久，点越散、越淡 —— 墨在纸里是会走的
			const lifeMin = (t - m.born) / 60;
			const spread = 1 + Math.min(0.5, lifeMin * 0.06);
			const fade = Math.max(0.42, 1 - lifeMin * 0.02);
			drawDot(
				x,
				y,
				(m.kind === "gold" ? 7.4 : 5.6) * spread * (R / 300),
				m.kind,
				0.85 * fade * back,
			);
			if (m.kind === "gold") {
				ctx.beginPath();
				ctx.arc(x, y, 10.5 * (R / 300) * spread, 0, Math.PI * 2);
				ctx.strokeStyle = goldRgba(0.28 * fade * back);
				ctx.lineWidth = Math.max(0.6, R * 0.0022);
				ctx.stroke();
			}
		}
	}

	/** 针：一根毛笔。根部粗、约三分之一处最粗、尖端细成丝。 */
	function drawHand() {
		const a = -swept;
		const len = R * 0.74;
		const dirX = Math.sin(a);
		const dirY = -Math.cos(a);
		const nx = Math.cos(a);
		const ny = Math.sin(a);
		const steps = 26;
		ctx.beginPath();
		for (let i = 0; i <= steps; i++) {
			const p = i / steps;
			// 笔形：起点细 → 0.28 处最粗 → 尖端收成 0
			const thick = R * 0.026 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.86);
			const r = p * len;
			ctx.lineTo(cx + dirX * r + nx * thick, cy + dirY * r + ny * thick);
		}
		for (let i = steps; i >= 0; i--) {
			const p = i / steps;
			const thick = R * 0.026 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.86);
			const r = p * len;
			ctx.lineTo(cx + dirX * r - nx * thick, cy + dirY * r - ny * thick);
		}
		ctx.closePath();
		// 展开一张灯片时钟心被占住，针淡下去 —— 不然它的一截会从灯片上边戳出来。
		// 留住 0.3 而不是让它彻底消失：针不在了，这一页就不像一只钟了。
		ctx.fillStyle = inkRgba(c, 0.92 * (1 - 0.7 * c.focus));
		ctx.fill();

		// 拖影：倒流时从针尖再拖出一条淡尾，像是被拉长了
		if (c.rewind > 0.02) {
			ctx.beginPath();
			for (let i = 0; i <= steps; i++) {
				const p = i / steps;
				const thick = R * 0.009 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.9);
				const r = p * len * lerp(1, 0.6, 1 - c.rewind);
				const aa = a + c.rewind * 0.16 * (1 - p);
				ctx.lineTo(
					cx + Math.sin(aa) * r + Math.cos(aa) * thick,
					cy - Math.cos(aa) * r + Math.sin(aa) * thick,
				);
			}
			for (let i = steps; i >= 0; i--) {
				const p = i / steps;
				const thick = R * 0.009 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.9);
				const r = p * len * lerp(1, 0.6, 1 - c.rewind);
				const aa = a + c.rewind * 0.16 * (1 - p);
				ctx.lineTo(
					cx + Math.sin(aa) * r - Math.cos(aa) * thick,
					cy - Math.cos(aa) * r - Math.sin(aa) * thick,
				);
			}
			ctx.closePath();
			ctx.fillStyle = inkRgba(c, 0.22 * c.rewind);
			ctx.fill();
		}

		// 轴心：一颗小墨点，把针按在纸上
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(2.6, R * 0.019), 0, Math.PI * 2);
		ctx.fillStyle = inkRgba(c, 0.9 * (1 - 0.7 * c.focus));
		ctx.fill();
	}

	/** 倒流时纸整体压一层暖雾。这是「旧时光滤镜」里唯一一层覆盖色。 */
	function drawAgeVeil() {
		const a = smoothstep(c.rewind);
		if (a <= 0.004) return;
		ctx.fillStyle = `rgb(124 98 62 / ${0.09 * a})`;
		ctx.fillRect(0, 0, w, h);
		// 四角再压一点，像被翻旧了的边角
		const vg = ctx.createRadialGradient(
			cx,
			cy,
			R * 0.5,
			cx,
			cy,
			Math.max(w, h) * 0.78,
		);
		vg.addColorStop(0, "rgb(96 76 46 / 0)");
		vg.addColorStop(1, `rgb(96 76 46 / ${0.1 * a})`);
		ctx.fillStyle = vg;
		ctx.fillRect(0, 0, w, h);
	}

	function frame(dt: number) {
		t += dt;
		if (resetting) {
			// 复位不是瞬间跳回去：针要有「被拨回来」的动作，所以走缓动
			swept = Math.max(0, swept - dt * 9);
			if (swept <= 0.0005) {
				swept = 0;
				resetting = false;
			}
		} else if (!c.dragging) {
			// 时间在流逝：针顺时针慢慢走，于是倒流度自己一点点缩小
			swept = Math.max(
				0,
				swept - (Math.PI * 2 * dt * c.speed) / DRIFT_LAP_SECONDS,
			);
		}
		c.rewind = rewindFromAngle(swept);

		ctx.clearRect(0, 0, w, h);
		drawFace();
		drawMarks();
		drawHand();
		drawAgeVeil();
	}

	return {
		resize,
		frame,
		radius: () => R,
		center: () => ({ x: cx, y: cy }),
		partAt(x, y) {
			const d = Math.hypot(x - cx, y - cy);
			// 钟外一律 null：外面的落点是「空白」（写字）或旧物剪影的地盘
			if (d > R * 1.05) return null;
			if (d < R * HAND_INNER) return "center";
			if (d > R * 0.86) return "tick";
			return "hand";
		},
		beginDrag(x, y) {
			const d = Math.hypot(x - cx, y - cy);
			if (d < R * 0.12) {
				turning = false;
				return;
			}
			turning = true;
			lastAngle = Math.atan2(x - cx, -(y - cy));
		},
		drag(x, y) {
			// 落点换算成「逆时针偏离 12 点的弧度」。拖在钟心附近时角度不稳，直接忽略。
			if (!turning) return;
			const d = Math.hypot(x - cx, y - cy);
			if (d < R * 0.12) return;
			const cw = Math.atan2(x - cx, -(y - cy));
			// 跨过 ±π 的那一帧角差会突然差一整圈，补回来才是连续的手势
			let delta = cw - lastAngle;
			if (delta > Math.PI) delta -= Math.PI * 2;
			if (delta < -Math.PI) delta += Math.PI * 2;
			lastAngle = cw;
			// 指针逆时针走（delta < 0）＝ 把针往过去拨（swept 变大）
			swept = clamp(swept - delta, 0, Math.PI * 2);
			resetting = false;
		},
		endDrag() {
			turning = false;
			resetting = false;
		},
		reset() {
			resetting = true;
		},
		dropMark(tick, kind, slot = -1) {
			const norm = ((tick % TICK_COUNT) + TICK_COUNT) % TICK_COUNT;
			// 同一刻度上同一种点只留一颗，别叠出一坨黑
			const i = marks.findIndex((m) => m.tick === norm && m.kind === kind);
			if (i >= 0) {
				marks.splice(i, 1);
				return;
			}
			marks.push({ tick: norm, kind, slot, born: t });
		},
		marks: () => marks,
		rewind: () => c.rewind,
		sweep: () => swept,
	};
}
