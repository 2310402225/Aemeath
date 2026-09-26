// 上位面：寰宇星空。
//
// 画面全部当场算出来，不加载任何位图。五样东西按深度从后往前叠：
//   ① 蓝紫底 + 一层沉在背后的暗云   ② 星尘（带视差、会躲指针）
//   ③ 极光（低频飘的两条带）        ④ 垂落的星轨
//   ⑤ 金色地平环（与时间之河的顶边是同一条）
//
// 进入宇宙时"星空向两侧散开"不是另外写一套动画：每个星的横向位移
// 正比于 `d.focus` 乘它离中线的距离 —— 于是 focus 从 0 走到 1 的过程
// 天然就是"从中间裂开"。少一套状态，也少一处会对不上的地方。

import { clamp, type Dual, lerp, starTint, type View } from "./state";

type Star = {
	x: number;
	y: number;
	z: number;
	r: number;
	ph: number;
	sp: number;
};
type Trail = { x: number; y: number; len: number; sp: number; a: number };

export type Cosmos = {
	resize(view: View): void;
	draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number): void;
	/** 指针扫过时，靠近它的星尘被推开一点（累积位移，自己衰减回去）。 */
	avoid(x: number, y: number, radius: number): void;
};

export function createCosmos(): Cosmos {
	let stars: Star[] = [];
	let trails: Trail[] = [];
	/** 被指针推开的累积位移，按星索引存，自己逐帧衰减 */
	let pushX: Float32Array = new Float32Array(0);
	let pushY: Float32Array = new Float32Array(0);
	let seeded = 0;
	/** resize 时记下的视口：`avoid` 拿到的指针是 CSS 像素，得回到星的空间去比。 */
	let W = 1;
	let RIVER = 1;

	// 确定性随机：同一个种子每次刷新画出来的星空一模一样（否则每次进页面都像换了个宇宙）
	let seed = 20260926;
	const rnd = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 4294967296;
	};

	function resize(view: View) {
		W = Math.max(1, view.w);
		RIVER = Math.max(1, view.river);
		const n = Math.round(clamp((view.w * view.h) / 2600, 160, 900));
		stars = [];
		seed = 20260926;
		for (let i = 0; i < n; i++) {
			// z 越小越远：远星更暗更小、视差也更弱
			const z = 0.16 + rnd() * 0.84;
			stars.push({
				x: rnd(),
				y: rnd() * rnd(),
				z,
				r: (0.35 + rnd() * rnd() * 1.5) * (0.5 + z),
				ph: rnd() * Math.PI * 2,
				sp: 0.4 + rnd() * 1.8,
			});
		}
		const m = Math.round(clamp(view.w / 14, 26, 110));
		trails = [];
		for (let i = 0; i < m; i++) {
			trails.push({
				x: rnd(),
				y: rnd() * 0.9,
				len: 0.04 + rnd() * 0.16,
				sp: 0.035 + rnd() * 0.09,
				a: 0.1 + rnd() * 0.4,
			});
		}
		pushX = new Float32Array(stars.length);
		pushY = new Float32Array(stars.length);
		seeded = stars.length;
	}

	/** 指针是 CSS 像素，星是归一化的 —— 这里换算，别让调用方记这件事。 */
	function avoid(x: number, y: number, radius: number) {
		if (x < 0) return;
		const nx = x / W;
		const ny = y / RIVER;
		const nr = radius / W;
		for (let i = 0; i < seeded; i++) {
			const s = stars[i];
			const dx = s.x - nx;
			const dy = (s.y - ny) * (RIVER / W);
			const dd = Math.hypot(dx, dy);
			if (dd > nr || dd < 1e-5) continue;
			const k = (1 - dd / nr) * (1 - dd / nr) * 0.0016;
			pushX[i] += (dx / dd) * k;
			pushY[i] += ((dy / dd) * k * W) / RIVER;
		}
	}

	function draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number) {
		const { w, h } = view;
		const river = view.river;
		const t = d.now / 1000;
		const [tr, tg, tb] = starTint(d);
		const spread = 0.34 * clamp(d.focus, 0, 1);
		const calm = d.calm ? 0.35 : 1;

		// ① 底：黑里透一点蓝紫，下面靠近地平处再压一层暖
		const bg = g.createLinearGradient(0, 0, 0, river);
		bg.addColorStop(0, "#05060c");
		bg.addColorStop(0.55, "#080a16");
		bg.addColorStop(0.86, "#120e1a");
		bg.addColorStop(1, "#1d1420");
		g.fillStyle = bg;
		g.fillRect(0, 0, w, river);

		// 暗云：几团很大的径向渐变，横着铺在地平线上面
		const clouds = d.lite ? 4 : 7;
		for (let i = 0; i < clouds; i++) {
			const cx =
				((i + 0.5) / clouds) * w + Math.sin(t * 0.02 + i * 2.3) * w * 0.04;
			const cy = river - h * (0.1 + (0.13 * ((i * 37) % 7)) / 7);
			const R = h * (0.16 + 0.1 * (((i * 53) % 5) / 5));
			const cg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
			cg.addColorStop(0, "rgb(26 26 44 / 0.5)");
			cg.addColorStop(0.6, "rgb(16 16 30 / 0.26)");
			cg.addColorStop(1, "rgb(10 10 20 / 0)");
			g.fillStyle = cg;
			g.fillRect(cx - R, cy - R, R * 2, R * 2);
		}

		// ③ 极光：两条低频飘的带，只有一点颜色，多了就俗
		g.globalCompositeOperation = "lighter";
		for (let i = 0; i < 2; i++) {
			const y0 = river * (0.2 + i * 0.16);
			g.beginPath();
			g.moveTo(0, y0);
			for (let x = 0; x <= w; x += Math.max(12, w / 42)) {
				g.lineTo(
					x,
					y0 + Math.sin(x * 0.0035 + t * 0.09 * calm + i) * river * 0.052,
				);
			}
			g.lineTo(w, 0);
			g.lineTo(0, 0);
			g.closePath();
			g.fillStyle =
				i === 0 ? "rgb(58 74 150 / 0.075)" : "rgb(96 62 130 / 0.06)";
			g.fill();
		}

		// ② 星尘
		const parX = d.px >= 0 ? (d.px / w - 0.5) * w : 0;
		const parY = d.py >= 0 ? (d.py / h - 0.5) * h : 0;
		for (let i = 0; i < seeded; i++) {
			const s = stars[i];
			pushX[i] *= 1 - Math.min(1, dt * 2.4);
			pushY[i] *= 1 - Math.min(1, dt * 2.4);
			const off = (s.x - 0.5) * spread;
			const sx = (s.x + off + pushX[i]) * w - parX * s.z * 0.035;
			const sy = (s.y + pushY[i]) * (river * 0.97) - parY * s.z * 0.035;
			if (sx < -4 || sx > w + 4) continue;
			const tw = 0.62 + 0.38 * Math.sin(t * s.sp * calm + s.ph);
			const a = clamp(tw * (0.25 + s.z * 0.75), 0, 1) * (0.5 + 0.5 * s.z);
			const r = s.r;
			if (r < 1.15) {
				g.fillStyle = `rgb(${Math.round(214 * tr)} ${Math.round(226 * tg)} ${Math.round(255 * tb)} / ${a * 0.8})`;
				g.fillRect(sx, sy, r * 1.6, r * 1.6);
			} else {
				g.beginPath();
				g.arc(sx, sy, r, 0, Math.PI * 2);
				g.fillStyle = `rgb(${Math.round(226 * tr)} ${Math.round(236 * tg)} ${Math.round(255 * tb)} / ${a})`;
				g.fill();
			}
		}

		// ④ 垂落的星轨：图三那种"星尘往下沉"的细线
		g.lineCap = "round";
		for (const s of trails) {
			s.y += s.sp * dt * calm;
			if (s.y > 1.04) s.y = -s.len;
			const x = s.x * w + (s.x - 0.5) * spread * w;
			const y0 = s.y * river;
			const y1 = (s.y + s.len) * river;
			const lg = g.createLinearGradient(x, y0, x, y1);
			lg.addColorStop(
				0,
				`rgb(${Math.round(214 * tr)} ${Math.round(180 * tg)} ${Math.round(120 * tb)} / 0)`,
			);
			lg.addColorStop(
				0.72,
				`rgb(${Math.round(240 * tr)} ${Math.round(214 * tg)} ${Math.round(160 * tb)} / ${s.a})`,
			);
			lg.addColorStop(1, "rgb(255 240 210 / 0)");
			g.strokeStyle = lg;
			g.lineWidth = 1.1;
			g.beginPath();
			g.moveTo(x, y0);
			g.lineTo(x, y1);
			g.stroke();
		}
		g.globalCompositeOperation = "source-over";

		// ⑤ 金色地平环：与时间之河同一条线。中心最亮，往两边收。
		const glow = 1 - 0.45 * d.age;
		const core = g.createRadialGradient(
			w / 2,
			river,
			0,
			w / 2,
			river,
			w * 0.42,
		);
		core.addColorStop(0, `rgb(255 246 224 / ${0.5 * glow})`);
		core.addColorStop(0.22, `rgb(255 214 150 / ${0.26 * glow})`);
		core.addColorStop(0.6, `rgb(214 150 80 / ${0.08 * glow})`);
		core.addColorStop(1, "rgb(180 120 60 / 0)");
		g.globalCompositeOperation = "lighter";
		g.fillStyle = core;
		g.fillRect(0, river - w * 0.42, w, w * 0.42 * 2);

		// 地平环上方那道弧（图三里很显眼的一条大圆）
		g.beginPath();
		g.ellipse(w / 2, river, w * 0.46, river * 0.9, 0, Math.PI, Math.PI * 2);
		g.strokeStyle = `rgb(${Math.round(lerp(230, 170, d.age))} ${Math.round(
			lerp(206, 140, d.age),
		)} ${Math.round(lerp(150, 92, d.age))} / 0.5)`;
		g.lineWidth = 1.2;
		g.stroke();
		g.globalCompositeOperation = "source-over";
	}

	return { resize, draw, avoid };
}
