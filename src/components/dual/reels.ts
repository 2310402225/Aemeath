// 包裹罗盘的那圈胶卷。
//
// 模型：每条胶卷是**一只三维的圆环**，圆心在盘心，半径 r，环面从盘面抬起 α、绕盘轴转 β。
// 把 α 从 0 铺到 π 就是包住整只罗盘的"胶片球"；把所有 α 抬到 90° 就变成一圈立起来的
// 胶片笼 —— 罗盘露出来，胶卷还在。**展开就是 α 从铺开走到立起，收缩就是走回去。**
//
// 分层不是靠 z-index 猜的：每个采样点都算出了它在相机空间的深度，于是环天然分成
// "近的一半"与"远的一半"，先画所有远半、再画罗盘、最后画所有近半。
// 上一版"胶卷把罗盘裁掉一块 / 层序乱"的毛病，根子就是没算这个深度 —— 这里它是免费的。
//
// 四套旋转逻辑（spec 点名要的）：
//   ① 胶片随时间慢慢自滚         → `d.filmPhase`
//   ② 拖针时全部快速旋转          → `d.filmRoll`（由指针的速度驱动）
//   ③ 转罗盘时跟着罗盘的三维姿态   → 只读 `tiltX/tiltY/qspin`，**自己不自滚**
//   ④ 转汉字环时随机一条独立自转   → `d.soloIdx` 那一条额外加转

import type { Geom } from "./compass";
import { FILM_FRAMES } from "./data";
import { clamp, type Dual, lerp, type View } from "./state";

const TAU = Math.PI * 2;
const FRAMES = 6;
const SAMPLES = 42;

type Reel = {
	r: number;
	alpha: number;
	beta: number;
	hw: number;
	solo: boolean;
};
type Slot = { x: number; y: number; w: number; h: number; idx: number };

export type Reels = {
	resize(view: View): void;
	/**
	 * 分两次画：`drawBack` 画在罗盘**后面**的那半圈，`drawFront` 画前面那半圈。
	 * 调用方必须按 back → 罗盘 → front 的次序，一次都不能省 —— 这条次序就是
	 * "胶片球包住罗盘"的全部秘密，拆开画正是为了让它由调用次序保证，
	 * 而不是靠 z-index 猜。
	 */
	drawBack(g: CanvasRenderingContext2D, d: Dual, view: View, gm: Geom): void;
	drawFront(g: CanvasRenderingContext2D, d: Dual, view: View, gm: Geom): void;
	frameAt(x: number, y: number): number;
	onReel(x: number, y: number, gm: Geom): boolean;
	/** 有几条胶卷 */
	count(): number;
	/** 指定哪一条在独立自转（−1 = 都不）。转汉字环的时候用。 */
	solo(index: number): void;
	/** 出现/消失的中间态里不接受命中，避免"看着没有却点得到" */
	ready(): boolean;
};

export function createReels(): Reels {
	let reels: Reel[] = [];
	let slots: Slot[] = [];
	let thumbs: (HTMLCanvasElement | null)[] = [];
	let loaded = false;
	let visible = 0;

	function makeThumb(src: string, i: number) {
		const img = new Image();
		img.decoding = "async";
		img.onload = () => {
			const w = 132;
			const h = Math.max(
				1,
				Math.round((img.naturalHeight / img.naturalWidth) * w),
			);
			const c = document.createElement("canvas");
			c.width = w;
			c.height = h;
			const g = c.getContext("2d");
			if (g) g.drawImage(img, 0, 0, w, h);
			thumbs[i] = c;
		};
		img.src = src;
	}

	function build(lite: boolean) {
		const n = lite ? 4 : 7;
		reels = [];
		for (let i = 0; i < n; i++) {
			reels.push({
				r: 0.46 + (i / Math.max(1, n - 1)) * 0.5,
				alpha: (i / n) * Math.PI,
				beta: (i / n) * Math.PI,
				hw: 0.072 - i * 0.003,
				solo: false,
			});
		}
	}

	function resize(view: View) {
		build(view.w <= 760);
		if (!loaded) {
			loaded = true;
			thumbs = FILM_FRAMES.map(() => null);
			for (let i = 0; i < FILM_FRAMES.length; i++)
				makeThumb(FILM_FRAMES[i].src, i);
		}
	}

	/** 局部三维点 → 屏幕点 + 相机深度。顺序：罗盘自转 → 俯仰偏转 → 正投影。 */
	function project(
		d: Dual,
		R: number,
		p: [number, number, number],
	): { x: number; y: number; z: number } {
		const cs = Math.cos(d.qspin);
		const sn = Math.sin(d.qspin);
		const x1 = p[0] * cs - p[1] * sn;
		const y1 = p[0] * sn + p[1] * cs;
		const z1 = p[2];
		const cb = Math.cos(d.tiltY);
		const sb = Math.sin(d.tiltY);
		const x2 = x1 * cb + z1 * sb;
		const z2 = -x1 * sb + z1 * cb;
		const ca = Math.cos(d.tiltX);
		const sa = Math.sin(d.tiltX);
		return { x: x2 * R, y: (y1 * ca - z2 * sa) * R, z: y1 * sa + z2 * ca };
	}

	/** 一条环上的采样点（局部坐标，单位 = 罗盘半径）。 */
	function ringPoint(
		alpha: number,
		beta: number,
		th: number,
		radius: number,
	): [number, number, number] {
		const x = radius * Math.cos(th);
		const y = radius * Math.sin(th);
		const ca = Math.cos(alpha);
		const sa = Math.sin(alpha);
		const y2 = y * ca;
		const z2 = y * sa;
		const cb = Math.cos(beta);
		const sb = Math.sin(beta);
		return [x * cb - y2 * sb, x * sb + y2 * cb, z2];
	}

	function drawPass(
		g: CanvasRenderingContext2D,
		d: Dual,
		gm: Geom,
		near: boolean,
	) {
		visible = gm.appear;
		if (near) slots = [];
		if (gm.appear <= 0.02) return;
		const { cx, cy, R } = gm;
		const o = clamp(d.reelOpen, 0, 1);
		const ease = o * o * (3 - 2 * o);
		const roll = d.filmPhase + d.filmRoll;

		// α / r 在"包住"与"展开"之间插值。
		// ⚠️ 展开**不能**倒向 π/2：那是把圆环侧立起来，正投影退化成一条穿过圆心的直线，
		// 七条一起就是一把插在罗盘上的刀，比包着的时候还糊。展开 = 往外让开 + 倒回接近
		// 与盘面同向，于是变成几圈套在罗盘外面的环，盘面整片露出来。
		const lay = reels.map((reel, i) => ({
			r: lerp(reel.r, 1.14 + i * 0.05, ease),
			alpha: lerp(reel.alpha, Math.PI * (0.06 + i * 0.035), ease),
			beta:
				reel.beta + roll * (0.18 + i * 0.02) + (reel.solo ? d.now / 900 : 0),
			hw: reel.hw * lerp(1, 0.72, ease),
			reel,
		}));

		g.save();
		g.globalAlpha = gm.appear;
		g.translate(cx, cy);
		paintPass(g, d, R, lay, cx, cy, near, roll);
		g.restore();
	}

	/** 一次画半圈（这一侧的第几段弧）。`near=false` 画在罗盘背后的一半。 */
	function paintPass(
		g: CanvasRenderingContext2D,
		d: Dual,
		R: number,
		lay: { r: number; alpha: number; beta: number; hw: number; reel: Reel }[],
		cx: number,
		cy: number,
		near: boolean,
		roll: number,
	) {
		for (let i = 0; i < lay.length; i++) {
			const L = lay[i];
			const reel = L.reel;
			const rate = reel.solo ? 1.9 : 1;
			const pts: { x: number; y: number; z: number }[] = [];
			for (let k = 0; k <= SAMPLES; k++) {
				const th = (k / SAMPLES) * TAU;
				const p = project(d, R, ringPoint(L.alpha, L.beta, th, L.r));
				pts.push({ x: p.x, y: p.y, z: p.z });
			}
			// 拆成若干段"同侧"的弧
			const runs: { x: number; y: number }[][] = [];
			let cur: { x: number; y: number }[] = [];
			for (const p of pts) {
				if (p.z >= 0 === near) cur.push({ x: p.x, y: p.y });
				else if (cur.length) {
					runs.push(cur);
					cur = [];
				}
			}
			if (cur.length) runs.push(cur);

			const hwPx = L.hw * R;
			for (const run of runs) {
				if (run.length < 3) continue;
				// 带子：中线左右各偏半个带宽
				g.beginPath();
				for (let k = 0; k < run.length; k++) {
					const a = run[Math.max(0, k - 1)];
					const b = run[Math.min(run.length - 1, k + 1)];
					const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
					const nx = -(b.y - a.y) / tl;
					const ny = (b.x - a.x) / tl;
					if (k === 0) g.moveTo(run[k].x + nx * hwPx, run[k].y + ny * hwPx);
					else g.lineTo(run[k].x + nx * hwPx, run[k].y + ny * hwPx);
				}
				for (let k = run.length - 1; k >= 0; k--) {
					const a = run[Math.max(0, k - 1)];
					const b = run[Math.min(run.length - 1, k + 1)];
					const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
					const nx = -(b.y - a.y) / tl;
					const ny = (b.x - a.x) / tl;
					g.lineTo(run[k].x - nx * hwPx, run[k].y - ny * hwPx);
				}
				g.closePath();
				// 胶片本体：半透明的琥珀，中间那一段更亮（像背后有光透过来）
				const gr = g.createLinearGradient(0, -R * 1.3, 0, R * 1.3);
				gr.addColorStop(0, "rgb(186 146 84 / 0.5)");
				gr.addColorStop(0.5, "rgb(232 194 122 / 0.62)");
				gr.addColorStop(1, "rgb(150 116 66 / 0.42)");
				g.fillStyle = gr;
				g.fill();
				g.strokeStyle = "rgb(255 232 184 / 0.34)";
				g.lineWidth = 1;
				g.stroke();

				// 齿孔：两条边上等距的小方孔
				const step = Math.max(2, Math.round(run.length / 12));
				for (let k = 0; k < run.length; k += step) {
					const a = run[Math.max(0, k - 1)];
					const b = run[Math.min(run.length - 1, k + 1)];
					const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
					const nx = -(b.y - a.y) / tl;
					const ny = (b.x - a.x) / tl;
					const tx = (b.x - a.x) / tl;
					const ty = (b.y - a.y) / tl;
					const p = run[k];
					g.fillStyle = "rgb(24 20 14 / 0.5)";
					for (const sgn of [-1, 1] as const) {
						const sxp = p.x + nx * hwPx * 0.72 * sgn;
						const syp = p.y + ny * hwPx * 0.72 * sgn;
						const ox = nx * hwPx * 0.1 * sgn;
						const oy = ny * hwPx * 0.1 * sgn;
						g.beginPath();
						g.moveTo(sxp - tx * hwPx * 0.16 + ox, syp - ty * hwPx * 0.16 + oy);
						g.lineTo(sxp + tx * hwPx * 0.16 + ox, syp + ty * hwPx * 0.16 + oy);
						g.lineTo(sxp + tx * hwPx * 0.16 - ox, syp + ty * hwPx * 0.16 - oy);
						g.lineTo(sxp - tx * hwPx * 0.16 - ox, syp - ty * hwPx * 0.16 - oy);
						g.closePath();
						g.fill();
					}
				}
			}

			// 电影格：每卷 6 格，沿环滚。只画属于这一侧的那些。
			const spin =
				(roll * 0.5 + i * 0.13) * rate + (reel.solo ? d.now / 2600 : 0);
			for (let j = 0; j < FRAMES; j++) {
				const th = ((j / FRAMES + spin) % 1) * TAU;
				const p = project(d, R, ringPoint(L.alpha, L.beta, th, L.r));
				if (p.z >= 0 !== near) continue;
				const q = project(d, R, ringPoint(L.alpha, L.beta, th + 0.05, L.r));
				const ang = Math.atan2(q.y - p.y, q.x - p.x);
				const fw = hwPx * 1.18;
				const fh = hwPx * 0.8;
				const idx = (i * FRAMES + j) % FILM_FRAMES.length;
				g.save();
				g.translate(p.x, p.y);
				g.rotate(ang);
				g.globalAlpha = frameAlpha(near);
				const tx = thumbs[idx];
				if (tx) g.drawImage(tx, -fw / 2, -fh / 2, fw, fh);
				else {
					g.fillStyle = "rgb(52 40 24 / 0.9)";
					g.fillRect(-fw / 2, -fh / 2, fw, fh);
				}
				g.strokeStyle = "rgb(255 236 190 / 0.5)";
				g.lineWidth = 1;
				g.strokeRect(-fw / 2, -fh / 2, fw, fh);
				g.restore();
				g.globalAlpha = visible;
				// 只记近侧的位置 —— 远侧被罗盘挡着，点不到才对
				if (near) slots.push({ x: cx + p.x, y: cy + p.y, w: fw, h: fh, idx });
			}
		}
	}

	/** 背面的格子压暗一档：它们在罗盘后面，本来就不该和前面的一样实。 */
	function frameAlpha(near: boolean): number {
		return visible * (near ? 1 : 0.62);
	}

	function frameAt(x: number, y: number): number {
		if (visible < 0.5) return -1;
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (const s of slots) {
			const dd = Math.hypot(x - s.x, y - s.y);
			if (dd < Math.max(s.w, s.h) * 0.62 && dd < bestD) {
				bestD = dd;
				best = s.idx;
			}
		}
		return best;
	}

	function onReel(x: number, y: number, gm: Geom): boolean {
		if (visible < 0.5) return false;
		return Math.hypot(x - gm.cx, y - gm.cy) < gm.R * 1.45;
	}

	return {
		resize,
		drawBack: (g, dd, _v, gm) => drawPass(g, dd, gm, false),
		drawFront: (g, dd, _v, gm) => drawPass(g, dd, gm, true),
		frameAt,
		onReel,
		count: () => reels.length,
		solo(index: number) {
			reels.forEach((r, i) => {
				r.solo = i === index;
			});
		},
		ready: () => visible > 0.5,
	};
}
