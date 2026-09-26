// 视觉中心：罗盘时钟。
//
// 一只金属星盘，盘上有三圈汉字刻度环（十二地支 / 十二时辰 / 十二月令），
// 中心一枚针，读数与现实一致 —— 针就是秒针，汉字环按此刻的时辰与月份高亮。
//
// 三层拖拽：
//   ① 拨针   按住盘内靠近针的地方往外拖。**圈数无限**，松手后缓动回到真实时间。
//   ② 转盘   按住盘面拖。整只盘俯仰偏转，带惯性，松手后来回摆几下才停。
//   ③ 转环   按住某一圈汉字拖。阻尼收敛，字不会变形（环只是整体转，一个字一格）。
//
// 三维用的是**各向异性缩放**（`S(tilt) · R(spin)`）而不是透视投影：
// 一只平放的圆盘绕盘内两轴转，正投影本来就是一个椭圆，用缩放表达是精确的；
// 真正需要透视的是胶卷（它们不在盘面上），那一层自己按三维投影算（见 reels.ts）。
// 于是「罗盘跟手的三维感」是这只盘与那圈胶卷**读同一组 tilt 值**得到的，不是两套。

import { hasGlyph, writeChar } from "./brush-ink";
import { RING_STEPS, RINGS } from "./data";
import {
	clamp,
	type Dual,
	goldCss,
	lerp,
	smoothstep,
	type View,
} from "./state";

const TAU = Math.PI * 2;
const STEP = TAU / RING_STEPS;

export type Memory = { turns: number; ch: string; at: number };

export type HitKind = "memory" | "needle" | "ring" | "disc";
export type Hit = { kind: HitKind; index: number };

export type Geom = { cx: number; cy: number; R: number; appear: number };

type RingBake = {
	canvas: HTMLCanvasElement;
	ext: number;
	size: number;
	rr: number;
	key: string;
};

export type Compass = {
	resize(view: View): void;
	geom(d: Dual, view: View): Geom;
	/** 屏幕坐标 → 盘面局部坐标（抹掉 tilt 与自转）。命中判定一律在这一侧做。 */
	toLocal(
		d: Dual,
		view: View,
		x: number,
		y: number,
	): { lx: number; ly: number };
	hit(d: Dual, view: View, x: number, y: number): Hit | null;
	draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number): void;
	memories: Memory[];
	/** 落一个记忆点（写完一个字时调）。 */
	remember(turns: number, ch: string): void;
};

export function createCompass(): Compass {
	let bakes: (RingBake | null)[] = [null, null, null];
	let dpr = 1;
	const memories: Memory[] = [];

	function resize(view: View) {
		dpr = view.dpr;
		bakes = [null, null, null];
	}

	function geom(d: Dual, view: View): Geom {
		const appear = smoothstep((clamp(d.focus, -1, 1) - 0.24) / 0.62);
		const cy = lerp(view.river * 1.02, view.river * 0.6, appear);
		const R =
			Math.min(view.w * 0.295, view.river * 0.4, 360) * lerp(0.72, 1, appear);
		return { cx: view.w / 2, cy, R: Math.max(1, R), appear };
	}

	/**
	 * `S(tilt)·R(spin)` 的四个数，按 canvas `transform(a,b,c,d,·,·)` 的顺序给 ——
	 * 也就是把矩阵当成 [[m0, m2], [m1, m3]]。`toLocal` 的反解用的是同一套约定，
	 * ⚠️ 两处的约定必须一致：改一处不改另一处，症状是"针画在这儿、点那儿才有反应"。
	 */
	function mat(d: Dual): [number, number, number, number] {
		const cs = Math.cos(d.qspin);
		const sn = Math.sin(d.qspin);
		const ax = Math.cos(d.tiltY);
		const ay = Math.cos(d.tiltX);
		return [ax * cs, ay * sn, -ax * sn, ay * cs];
	}

	function toLocal(d: Dual, view: View, x: number, y: number) {
		const gm = geom(d, view);
		const [a, b, c, e] = mat(d);
		const det = a * e - b * c || 1e-6;
		const px = x - gm.cx;
		const py = y - gm.cy;
		return {
			lx: (e * px - c * py) / det,
			ly: (-b * px + a * py) / det,
		};
	}

	/** 把一圈字烘成一张位图：环自己转的时候只需要 drawImage 一次，不必每帧写几十个毛笔字。 */
	function bakeRing(i: number, R: number): RingBake {
		const def = RINGS[i];
		const size = def.size * R;
		const rr = def.radius * R;
		const ext = rr + size * 1.6;
		const key = `${Math.round(R)}|${dpr}`;
		const hit = bakes[i];
		if (hit && hit.key === key) return hit;

		const c = document.createElement("canvas");
		c.width = Math.max(2, Math.ceil(ext * 2 * dpr));
		c.height = c.width;
		const g = c.getContext("2d");
		if (g) {
			g.scale(dpr, dpr);
			g.translate(ext, ext);
			for (let k = 0; k < RING_STEPS; k++) {
				const th = k * STEP;
				const word = def.words[k];
				g.save();
				g.translate(Math.sin(th) * rr, -Math.cos(th) * rr);
				g.rotate(th);
				writeChar(g, word[0], -((word.length - 1) * size * 0.56), 0, {
					size,
					progress: 1,
					color: "rgb(226 212 178)",
					alpha: 0.9,
					halo: 0.6,
					dry: true,
				});
				if (word.length > 1) {
					writeChar(g, word[1], size * 0.56, 0, {
						size,
						progress: 1,
						color: "rgb(226 212 178)",
						alpha: 0.9,
						halo: 0.6,
						dry: true,
					});
				}
				g.restore();
			}
		}
		const baked: RingBake = { canvas: c, ext, size, rr, key };
		bakes[i] = baked;
		return baked;
	}

	function ringAngle(d: Dual, i: number): number {
		return d.rings[i] ?? 0;
	}

	function hit(d: Dual, view: View, x: number, y: number): Hit | null {
		const gm = geom(d, view);
		if (gm.appear < 0.35) return null;
		const { lx, ly } = toLocal(d, view, x, y);
		const r = Math.hypot(lx, ly);
		if (r > gm.R * 1.12) return null;

		// ① 记忆点在最外圈，优先
		for (let i = 0; i < memories.length; i++) {
			const a = -Math.PI / 2 + memories[i].turns * TAU;
			const mx = Math.cos(a) * gm.R * 1.045;
			const my = Math.sin(a) * gm.R * 1.045;
			if (Math.hypot(lx - mx, ly - my) < gm.R * 0.075)
				return { kind: "memory", index: i };
		}

		// ② 针：一条从 0.14R 到 0.92R 的窄带。
		// ⚠️ 这里要的是"针在**屏幕上**指的方向"，而针是 `g.rotate(rot)` 之后沿局部 −y
		// 画的（`moveTo(0, -R*0.9)`），所以屏幕方向 = `rot - π/2`（canvas 的 y 朝下，
		// 正角顺时针）。原先这里拿 `na` 当屏幕角直接比，比 `draw()` 差了整整 90° ——
		// 症状就是"针看得见、抓不住"。两处现在共用同一条：0 秒指 12 点，与刻度同约定。
		const na = -Math.PI / 2 + needleLocal(d) * TAU;
		const pa = Math.atan2(ly, lx);
		let diff = pa - na;
		// 针是一条**过圆心**的线（尖端在一侧、尾摆在对侧），所以按 π 取模，两段都算命中
		while (diff > Math.PI / 2) diff -= Math.PI;
		while (diff <= -Math.PI / 2) diff += Math.PI;
		if (Math.abs(diff) < 0.085 && r > gm.R * 0.14 && r < gm.R * 0.92) {
			return { kind: "needle", index: 0 };
		}

		// ③ 三圈汉字：挑离得最近的那一圈
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (let i = 0; i < RINGS.length; i++) {
			const rr = RINGS[i].radius * gm.R;
			const dd = Math.abs(r - rr);
			if (dd < RINGS[i].size * gm.R * 0.8 && dd < bestD) {
				bestD = dd;
				best = i;
			}
		}
		if (best >= 0) return { kind: "ring", index: best };

		return { kind: "disc", index: 0 };
	}

	/** 针在"盘面本地"的角度：真实秒数 + 拨出来的圈数。 */
	function needleLocal(d: Dual): number {
		const t = new Date(d.now);
		return (t.getSeconds() + t.getMilliseconds() / 1000) / 60 + d.turns;
	}

	function draw(g: CanvasRenderingContext2D, d: Dual, view: View, _dt: number) {
		const gm = geom(d, view);
		if (gm.appear <= 0.01) return;
		const R = gm.R;
		const t = new Date(d.now);
		const local = needleLocal(d);

		// 盘体：先铺一层环境金雾，再落盘
		g.save();
		g.globalAlpha = gm.appear;
		g.globalCompositeOperation = "lighter";
		const halo = g.createRadialGradient(
			gm.cx,
			gm.cy,
			R * 0.2,
			gm.cx,
			gm.cy,
			R * 1.9,
		);
		halo.addColorStop(0, `rgb(255 214 150 / ${0.14 + 0.05 * d.age})`);
		halo.addColorStop(0.55, "rgb(140 108 60 / 0.06)");
		halo.addColorStop(1, "rgb(80 60 30 / 0)");
		g.fillStyle = halo;
		g.fillRect(gm.cx - R * 1.9, gm.cy - R * 1.9, R * 3.8, R * 3.8);
		g.globalCompositeOperation = "source-over";

		g.translate(gm.cx, gm.cy);
		const m = mat(d);
		g.transform(m[0], m[1], m[2], m[3], 0, 0);

		// ② 盘面
		g.beginPath();
		g.arc(0, 0, R, 0, TAU);
		const disc = g.createRadialGradient(
			-R * 0.28,
			-R * 0.34,
			R * 0.06,
			0,
			0,
			R * 1.12,
		);
		disc.addColorStop(0, "#2b2b34");
		disc.addColorStop(0.42, "#1b1c22");
		disc.addColorStop(0.78, "#12131a");
		disc.addColorStop(1, "#0a0b10");
		g.fillStyle = disc;
		g.fill();

		// 盘面上的金属高光：跟着 tilt 走，于是"立起来"这件事看得出来
		const spec = g.createLinearGradient(
			-R * 0.9 * Math.cos(d.tiltY),
			-R * 0.9 * Math.cos(d.tiltX),
			R * 0.9 * Math.cos(d.tiltY),
			R * 0.9 * Math.cos(d.tiltX),
		);
		spec.addColorStop(0, "rgb(255 240 210 / 0)");
		spec.addColorStop(
			0.42,
			`rgb(255 240 210 / ${0.05 + 0.05 * Math.abs(Math.sin(d.tiltX))})`,
		);
		spec.addColorStop(0.52, "rgb(255 248 230 / 0.02)");
		spec.addColorStop(1, "rgb(255 240 210 / 0)");
		g.fillStyle = spec;
		g.beginPath();
		g.arc(0, 0, R, 0, TAU);
		g.fill();

		// 外金边 + 内刻圈
		g.lineWidth = Math.max(1, R * 0.012);
		g.strokeStyle = goldCss(d, 0.72);
		g.beginPath();
		g.arc(0, 0, R * 0.995, 0, TAU);
		g.stroke();
		g.lineWidth = Math.max(0.7, R * 0.004);
		g.strokeStyle = goldCss(d, 0.3);
		for (const rr of [0.505, 0.665, 0.835, 0.975]) {
			g.beginPath();
			g.arc(0, 0, R * rr, 0, TAU);
			g.stroke();
		}
		// 60 道细刻度
		g.strokeStyle = goldCss(d, 0.36);
		for (let i = 0; i < 60; i++) {
			const a = (i / 60) * TAU - Math.PI / 2;
			const big = i % 5 === 0;
			const r0 = R * (big ? 0.945 : 0.962);
			g.lineWidth = big ? Math.max(1, R * 0.006) : Math.max(0.6, R * 0.003);
			g.beginPath();
			g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
			g.lineTo(Math.cos(a) * R * 0.995, Math.sin(a) * R * 0.995);
			g.stroke();
		}

		// ① 三圈汉字刻度环
		for (let i = 0; i < RINGS.length; i++) {
			const bk = bakeRing(i, R);
			const ang = ringAngle(d, i);
			const cur =
				((Math.round(-ang / STEP) % RING_STEPS) + RING_STEPS) % RING_STEPS;
			g.save();
			g.rotate(ang);
			// 当前那一格：底下一小片金晕，转环的时候一眼看得出"现在在哪一格"
			if (i === 0) {
				const th = cur * STEP;
				const gg = g.createRadialGradient(
					Math.sin(th) * bk.rr,
					-Math.cos(th) * bk.rr,
					0,
					Math.sin(th) * bk.rr,
					-Math.cos(th) * bk.rr,
					bk.size * 2.1,
				);
				gg.addColorStop(0, goldCss(d, 0.3));
				gg.addColorStop(1, "rgb(0 0 0 / 0)");
				g.fillStyle = gg;
				g.beginPath();
				g.arc(
					Math.sin(th) * bk.rr,
					-Math.cos(th) * bk.rr,
					bk.size * 2.1,
					0,
					TAU,
				);
				g.fill();
			}
			g.globalAlpha = 0.82 + 0.18 * (i === 0 ? 1 : 0.6);
			g.drawImage(bk.canvas, -bk.ext, -bk.ext, bk.ext * 2, bk.ext * 2);
			g.globalAlpha = 1;
			g.restore();
		}

		// ③ 记忆点：写完一个字就在外圈落一颗金点，点它跳回那一刻
		for (const mem of memories) {
			const a = -Math.PI / 2 + mem.turns * TAU;
			const rr = R * 1.045;
			const gx = Math.cos(a) * rr;
			const gy = Math.sin(a) * rr;
			const pulse = 1 + 0.16 * Math.sin(d.now / 420 + mem.at);
			g.fillStyle = goldCss(d, 0.95);
			g.beginPath();
			g.arc(gx, gy, R * 0.018 * pulse, 0, TAU);
			g.fill();
			g.strokeStyle = goldCss(d, 0.4);
			g.lineWidth = 1;
			g.beginPath();
			g.arc(gx, gy, R * 0.034 * pulse, 0, TAU);
			g.stroke();
		}

		// ① 针。拖得越快，"运动模糊"的残影越多 —— 这是拨针唯一的动势来源
		const speed = Math.abs(d.turnsV);
		const ghosts = d.lite ? 0 : clamp(Math.round(speed * 9), 0, 4);
		// ⚠️ 旋转量 `na` 与"针在屏幕上的方向"差 π/2：针沿局部 −y 画，屏幕方向是
		// `na - π/2`。要让 0 秒指 12 点（跟刻度、记忆点同约定），旋转量就是 `local*TAU`。
		const na = local * TAU;
		for (let i = ghosts; i >= 0; i--) {
			const back = (i / 6) * Math.sign(d.turnsV);
			const a = na - back;
			const ga = i === 0 ? 1 : 0.14 * (1 - i / (ghosts + 1));
			g.save();
			g.rotate(a);
			g.fillStyle = i === 0 ? goldCss(d, 0.98) : goldCss(d, ga);
			g.beginPath();
			g.moveTo(0, -R * 0.9);
			g.lineTo(R * 0.016, -R * 0.12);
			g.lineTo(0, R * 0.075);
			g.lineTo(-R * 0.016, -R * 0.12);
			g.closePath();
			g.fill();
			if (i === 0) {
				// 针脊上那道反光：倾斜时会滑，金属感就靠它
				g.fillStyle = `rgb(255 252 236 / ${0.5 + 0.3 * Math.abs(Math.sin(d.tiltX))})`;
				g.beginPath();
				g.moveTo(0, -R * 0.88);
				g.lineTo(R * 0.005, -R * 0.14);
				g.lineTo(0, -R * 0.13);
				g.lineTo(-R * 0.005, -R * 0.14);
				g.closePath();
				g.fill();
			}
			g.restore();
		}
		// 针的尾摆
		g.fillStyle = goldCss(d, 0.85);
		g.beginPath();
		g.arc(0, 0, R * 0.03, 0, TAU);
		g.fill();

		g.restore();

		// ---------- 盘外的读数（不跟着 tilt 转，永远正的）----------
		g.save();
		g.globalAlpha = gm.appear;
		const hh = String(t.getHours()).padStart(2, "0");
		const mm = String(t.getMinutes()).padStart(2, "0");
		const ss = String(t.getSeconds()).padStart(2, "0");
		g.textAlign = "center";
		g.fillStyle = goldCss(d, 0.9);
		g.font = `500 ${Math.max(13, R * 0.1)}px "LXGW WenKai Screen", "PingFang SC", serif`;
		g.fillText(`${hh}:${mm}:${ss}`, gm.cx, gm.cy + R * 0.03);
		const sc =
			RINGS[1].words[
				((Math.round(-ringAngle(d, 1) / STEP) % RING_STEPS) + RING_STEPS) %
					RING_STEPS
			];
		g.fillStyle = goldCss(d, 0.62);
		g.font = `400 ${Math.max(11, R * 0.062)}px "LXGW WenKai Screen", "PingFang SC", serif`;
		g.fillText(sc, gm.cx, gm.cy + R * 0.135);
		// 拨回去了就给一行小字说明现在是"几圈之前"
		if (Math.abs(d.turns) > 0.02) {
			g.fillStyle = goldCss(d, 0.5);
			g.font = `400 ${Math.max(10, R * 0.05)}px "LXGW WenKai Screen", "PingFang SC", serif`;
			g.fillText(
				`往回 ${Math.abs(d.turns).toFixed(2)} 圈 · 松手即归`,
				gm.cx,
				gm.cy + R * 0.215,
			);
		}
		g.restore();
	}

	function remember(turns: number, ch: string) {
		// 只有真的烘过笔画的字才配得上一个记忆点
		if (!hasGlyph(ch)) return;
		memories.push({ turns, ch, at: Math.random() * 6.28 });
		if (memories.length > 6) memories.shift();
	}

	return { resize, geom, toLocal, hit, draw, memories, remember };
}
