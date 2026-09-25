// 场景层：一张宣纸，纸上三件旧物，若有若无。
//
// 这一层几乎不动（纸纹是烘一次就完的），所以它单独占一张画布：只在
// 「剪影亮起／熄灭」这类少数时刻重绘，静置时一帧都不画。
//
// 三件旧物各自对应一组灯片 —— 灯片转到哪一组，对应的旧物就悄悄亮一点。
// 这是这一页的「认出来」时刻：它不是随机飘的背景装饰，是你自己转到那儿才看见的。
// 全部用 path 画，零位图。

import { type Couplings, inkRgba, PAPER, PAPER_EDGE } from "./couplings";

/** 三件旧物：显像管电视 / 游戏手柄 / 发条铁皮蛙。与灯片的对应关系见 lantern-ring.ts。 */
export const RELICS = ["crt", "pad", "frog"] as const;
export type Relic = (typeof RELICS)[number];

type Silhouette = {
	relic: Relic;
	/** 相对舞台的位置（0..1）与占宽比 */
	x: number;
	y: number;
	w: number;
	/** 当前亮度与目标亮度 */
	glow: number;
	target: number;
	/** 被指针按着（长按点亮） */
	pressed: boolean;
	/** 内部小动作的相位：雪花屏在闪、十字键被按了一下、发条在转 */
	phase: number;
	hit: (px: number, py: number, cx: number, cy: number, s: number) => boolean;
	draw: (g: CanvasRenderingContext2D, s: number, phase: number) => void;
};

function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (1103515245 * s + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

/** 三件旧物的形状。都画在「宽 s、高 s·0.72」的局部框里，原点在框中心。 */
const SHAPES: Record<
	Relic,
	{ hit: Silhouette["hit"]; draw: Silhouette["draw"] }
> = {
	// 显像管电视：圆角机身 + 一屏 + 两颗旋钮 + 顶上两根天线
	crt: {
		hit: (px, py, cx, cy, s) =>
			px > cx - s * 0.5 &&
			px < cx + s * 0.5 &&
			py > cy - s * 0.32 &&
			py < cy + s * 0.36,
		draw: (g, s, phase) => {
			const w = s;
			const h = s * 0.62;
			g.beginPath();
			g.roundRect(-w / 2, -h / 2, w, h, s * 0.06);
			g.fill();
			// 屏幕：比机身更淡一层，它才是「在发光的东西」
			g.save();
			g.globalCompositeOperation = "destination-out";
			g.beginPath();
			g.roundRect(-w * 0.4, -h * 0.32, w * 0.58, h * 0.66, s * 0.04);
			g.fill();
			g.restore();
			g.save();
			g.globalAlpha *= 0.5;
			g.beginPath();
			g.roundRect(-w * 0.4, -h * 0.32, w * 0.58, h * 0.66, s * 0.04);
			g.fill();
			g.restore();
			// 雪花：确定性取样，让「这台电视还在放」这件事看得出来
			g.save();
			g.beginPath();
			g.roundRect(-w * 0.4, -h * 0.32, w * 0.58, h * 0.66, s * 0.04);
			g.clip();
			const rnd = lcg(9137 + Math.floor(phase * 6));
			for (let i = 0; i < 70; i++) {
				const x = -w * 0.4 + rnd() * w * 0.58;
				const y = -h * 0.32 + rnd() * h * 0.66;
				g.fillRect(x, y, s * 0.012, s * 0.012);
			}
			g.restore();
			// 两颗旋钮
			for (const ky of [-0.12, 0.18]) {
				g.beginPath();
				g.arc(w * 0.32, h * ky, s * 0.035, 0, Math.PI * 2);
				g.fill();
			}
			// 天线
			g.lineWidth = s * 0.018;
			g.lineCap = "round";
			g.beginPath();
			g.moveTo(-s * 0.12, -h / 2);
			g.lineTo(-s * 0.26, -h / 2 - s * 0.22);
			g.moveTo(s * 0.04, -h / 2);
			g.lineTo(s * 0.2, -h / 2 - s * 0.26);
			g.stroke();
		},
	},
	// 游戏手柄：机身 + 左边十字键 + 右边两键 + 一根线
	pad: {
		hit: (px, py, cx, cy, s) =>
			px > cx - s * 0.5 &&
			px < cx + s * 0.5 &&
			py > cy - s * 0.24 &&
			py < cy + s * 0.2,
		draw: (g, s, phase) => {
			const w = s;
			const h = s * 0.34;
			g.beginPath();
			g.roundRect(-w / 2, -h / 2, w, h, h / 2);
			g.fill();
			// 十字键
			const kx = -w * 0.26;
			const ky = 0;
			const a = s * 0.05;
			g.beginPath();
			g.rect(kx - a / 2, ky - a * 1.5, a, a * 3);
			g.rect(kx - a * 1.5, ky - a / 2, a * 3, a);
			g.fill();
			// 两个圆键，其中一个按 phase 一下一下地亮
			for (const [i, bx] of [0.16, 0.31].entries()) {
				const r = s * 0.042;
				g.beginPath();
				g.arc(w * bx, -h * 0.08, r, 0, Math.PI * 2);
				g.fill();
				if (i === 0) {
					const press = Math.max(0, Math.sin(phase * Math.PI * 2)) ** 6;
					g.beginPath();
					g.arc(w * bx, -h * 0.08, r * (1.6 - press * 0.5), 0, Math.PI * 2);
					g.stroke();
				}
			}
			// 手柄线
			g.lineWidth = s * 0.016;
			g.lineCap = "round";
			g.beginPath();
			g.moveTo(-w / 2 + s * 0.02, 0);
			g.quadraticCurveTo(-w * 0.72, s * 0.18, -w * 0.78, s * 0.02);
			g.stroke();
		},
	},
	// 发条铁皮蛙：身子 + 两条后腿 + 背上一枚发条
	frog: {
		hit: (px, py, cx, cy, s) =>
			px > cx - s * 0.42 &&
			px < cx + s * 0.42 &&
			py > cy - s * 0.3 &&
			py < cy + s * 0.3,
		draw: (g, s, phase) => {
			g.beginPath();
			g.ellipse(0, 0, s * 0.3, s * 0.17, -0.14, 0, Math.PI * 2);
			g.fill();
			// 头与两只眼
			g.beginPath();
			g.ellipse(s * 0.3, -s * 0.05, s * 0.12, s * 0.1, 0, 0, Math.PI * 2);
			g.fill();
			for (const ey of [-0.42, -0.16]) {
				g.beginPath();
				g.ellipse(
					s * 0.33,
					s * ey * 0.2 - s * 0.02,
					s * 0.032,
					s * 0.03,
					0,
					0,
					Math.PI * 2,
				);
				g.fill();
			}
			// 后腿：折线，折叠角跟着 phase 略微开合
			const fold = 0.5 + 0.12 * Math.sin(phase * Math.PI * 2);
			g.lineWidth = s * 0.03;
			g.lineCap = "round";
			g.lineJoin = "round";
			for (const dir of [-1, 1]) {
				g.beginPath();
				g.moveTo(-s * 0.14, dir * s * 0.05);
				g.lineTo(-s * 0.3, dir * s * 0.16);
				g.lineTo(-s * 0.4, dir * s * 0.16 * fold);
				g.stroke();
			}
			// 背上那枚发条：圆 + 一根旋柄，慢慢转
			const wx = -s * 0.04;
			const wy = -s * 0.13;
			g.beginPath();
			g.arc(wx, wy, s * 0.055, 0, Math.PI * 2);
			g.stroke();
			const ang = phase * Math.PI * 2;
			g.beginPath();
			g.moveTo(wx, wy);
			g.lineTo(wx + Math.cos(ang) * s * 0.07, wy + Math.sin(ang) * s * 0.07);
			g.stroke();
		},
	},
};

export type Scenery = {
	resize: () => void;
	frame: (dt: number) => void;
	/** 指针落点命中哪件旧物（返回下标，没命中给 -1） */
	hit: (px: number, py: number) => number;
	/** 把某件旧物点亮／熄灭。灯片转过去、指针悬停、长按都会调它。 */
	setLit: (index: number, on: boolean) => void;
};

export function createScenery(
	canvas: HTMLCanvasElement,
	c: Couplings,
): Scenery {
	const ctxRaw = canvas.getContext("2d");
	if (!ctxRaw) throw new Error("scenery: 拿不到 2d 上下文");
	// 同 clock.ts：收窄进不了被提升的函数声明（ts 18047），另绑一个非空常量。
	const ctx: CanvasRenderingContext2D = ctxRaw;

	let w = 0;
	let h = 0;
	let dpr = 1;
	let dirty = true;
	/** 剪影还在动的时候需要一个低频重绘（雪花屏在闪、发条在转），静置时归零。 */
	let activity = 0;

	const items: Silhouette[] = [
		{
			relic: "crt",
			x: 0.135,
			y: 0.34,
			w: 0.2,
			glow: 0,
			target: 0,
			pressed: false,
			phase: 0,
			...SHAPES.crt,
		},
		{
			relic: "pad",
			x: 0.865,
			y: 0.36,
			w: 0.2,
			glow: 0,
			target: 0,
			pressed: false,
			phase: 0.3,
			...SHAPES.pad,
		},
		{
			relic: "frog",
			x: 0.2,
			y: 0.79,
			w: 0.16,
			glow: 0,
			target: 0,
			pressed: false,
			phase: 0.6,
			...SHAPES.frog,
		},
	];

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = Math.min(2, window.devicePixelRatio || 1);
		w = Math.max(1, Math.round(rect.width));
		h = Math.max(1, Math.round(rect.height));
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		dirty = true;
	}

	/** 纸纹：纤维、水渍、四角沉。全部确定性取样，同样的窗口尺寸永远画同一张纸。 */
	function drawPaper() {
		ctx.clearRect(0, 0, w, h);

		// 角落略沉，中心留亮 —— 一行 linear-gradient 做不出「压了很久」的旧纸
		const vg = ctx.createRadialGradient(
			w * 0.5,
			h * 0.42,
			0,
			w * 0.5,
			h * 0.42,
			Math.max(w, h) * 0.72,
		);
		vg.addColorStop(0, PAPER);
		vg.addColorStop(0.62, PAPER);
		vg.addColorStop(1, PAPER_EDGE);
		ctx.fillStyle = vg;
		ctx.fillRect(0, 0, w, h);

		// 纤维：短、弯、极淡。数量跟着面积走，窄屏别糊成一片。
		const fibers = Math.round((w * h) / 5200);
		const rnd = lcg(20260925);
		ctx.lineCap = "round";
		for (let i = 0; i < fibers; i++) {
			const x = rnd() * w;
			const y = rnd() * h;
			const len = 6 + rnd() * 26;
			const ang = rnd() * Math.PI * 2;
			ctx.strokeStyle = `rgb(150 138 116 / ${0.03 + rnd() * 0.05})`;
			ctx.lineWidth = 0.6 + rnd() * 0.7;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.quadraticCurveTo(
				x + Math.cos(ang) * len * 0.5 - Math.sin(ang) * len * 0.12,
				y + Math.sin(ang) * len * 0.5 + Math.cos(ang) * len * 0.12,
				x + Math.cos(ang) * len,
				y + Math.sin(ang) * len,
			);
			ctx.stroke();
		}

		// 两三处水渍：极淡的大斑，用来打破纸面的均匀
		const stains = 3;
		for (let i = 0; i < stains; i++) {
			const sx = (0.18 + rnd() * 0.64) * w;
			const sy = (0.16 + rnd() * 0.68) * h;
			const sr = (0.1 + rnd() * 0.16) * Math.max(w, h);
			const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
			sg.addColorStop(0, "rgb(168 156 128 / 0.05)");
			sg.addColorStop(0.7, "rgb(168 156 128 / 0.02)");
			sg.addColorStop(1, "rgb(168 156 128 / 0)");
			ctx.fillStyle = sg;
			ctx.beginPath();
			ctx.arc(sx, sy, sr, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	/** 剪影：淡墨块。用三层递增的透明度假出「墨在纸里洇开」的软边。
	 *  ⚠️ 不用 shadowBlur —— 那是逐像素模糊，为了三件旧物去付这个代价不值。 */
	function drawSilhouettes() {
		const s0 = Math.min(w, h * 1.5);
		for (const it of items) {
			const s = s0 * it.w;
			if (s < 26) continue; // 太小就别画了，只会变成一团脏点
			const cx = it.x * w;
			const cy = it.y * h;
			const alpha = (0.055 + it.glow * 0.16) * (1 - 0.35 * c.rewind);
			if (alpha <= 0.004) continue;
			ctx.save();
			ctx.translate(cx, cy);
			for (const [i, k] of [1.35, 1, 0.7].entries()) {
				ctx.save();
				ctx.scale(k, k);
				ctx.globalAlpha = alpha * (i === 0 ? 0.5 : 1);
				ctx.fillStyle = inkRgba(c, 1, 0.72);
				ctx.strokeStyle = inkRgba(c, 1, 0.72);
				it.draw(ctx, s, it.phase);
				ctx.restore();
			}
			ctx.restore();
		}
	}

	function frame(dt: number) {
		// 呼吸 & 衰减：亮起来的旧物按自己的目标值收敛，收到位之后就不再重绘
		let moving = false;
		for (const it of items) {
			const d = it.target - it.glow;
			if (Math.abs(d) > 0.0015) {
				// 点亮比熄灭快得多（像被一盏灯照到），退场慢慢来
				it.glow += d * Math.min(1, dt * (d > 0 ? 6 : 1.6));
				moving = true;
			} else if (it.glow !== it.target) {
				it.glow = it.target;
				moving = true;
			}
			if (it.glow > 0.02) {
				it.phase = (it.phase + dt * 0.42 * c.speed) % 1;
				moving = true;
			}
		}
		activity = moving ? 1 : 0;
		if (!dirty && !activity) return;
		dirty = false;
		drawPaper();
		drawSilhouettes();
	}

	return {
		resize,
		frame,
		hit(px, py) {
			const s0 = Math.min(w, h * 1.5);
			for (const [i, it] of items.entries()) {
				const s = s0 * it.w;
				if (s < 26) continue;
				if (it.hit(px, py, it.x * w, it.y * h, s)) return i;
			}
			return -1;
		},
		setLit(index, on) {
			const it = items[index];
			if (!it) return;
			it.target = on ? 1 : 0;
		},
	};
}
