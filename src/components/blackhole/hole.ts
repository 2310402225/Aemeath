// 深空背景 + 黑洞本体。两张画布，一支模块。
//
//   背景层（低频）：星野 + 暗雾 + 星云**烘进一张离屏位图**，每帧只贴一次图（带一点点视差）。
//     星野每帧重抽样毫无意义 —— 它又不动，动的是视差。走马灯那一页的教训：把"不变的东西"
//     每帧重算，是白扔的预算。
//   黑洞层（持续但低负载）：吸积盘按"远半 → 核心 → 近半"三趟画，前面的盘自然压过视界，
//     这才是黑洞照片的样子；再叠引力透镜弧、事件视界细环、星尘环、暗雾。
//
// 模块**只读**共享态：吸积盘自转相位、吞噬脉冲、指针靠近程度都在接线层推进。

import {
	clamp,
	type Hole,
	lerp,
	rngOf,
	type Shared,
	smoothstep,
	type View,
} from "./state";

const TAU = Math.PI * 2;
/** 吸积盘三色（spec §二）：暗紫、幽青、钴蓝 */
const DISK: [number, number, number][] = [
	[176, 108, 255],
	[86, 220, 226],
	[88, 132, 255],
];

export type HoleLayer = {
	resize(view: View): void;
	drawBg(g: CanvasRenderingContext2D, s: Shared, view: View): void;
	draw(
		g: CanvasRenderingContext2D,
		s: Shared,
		view: View,
		hole: Hole,
		dt: number,
	): void;
	/** 星野重烘（窗口尺寸变了才需要） */
	rebake(view: View): void;
};

export function createHoleLayer(): HoleLayer {
	let field: HTMLCanvasElement | null = null;
	/** 绕着黑洞漂的星尘（不是背景星 —— 这些是活的） */
	let dust: { a: number; r: number; sp: number; size: number }[] = [];

	function rebake(view: View) {
		const w = Math.max(1, Math.round(view.w * view.dpr));
		const h = Math.max(1, Math.round(view.h * view.dpr));
		if (!field) field = document.createElement("canvas");
		field.width = w;
		field.height = h;
		const g = field.getContext("2d");
		if (!g) return;
		g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		g.clearRect(0, 0, view.w, view.h);

		// 底色：深到近乎黑，四角再压一点（深阴影）
		const base = g.createRadialGradient(
			view.w * 0.5,
			view.h * 0.46,
			0,
			view.w * 0.5,
			view.h * 0.5,
			Math.hypot(view.w, view.h) * 0.62,
		);
		base.addColorStop(0, "#0a0812");
		base.addColorStop(0.55, "#07060d");
		base.addColorStop(1, "#030308");
		g.fillStyle = base;
		g.fillRect(0, 0, view.w, view.h);

		// 两团极淡的星云（暗紫 / 钴蓝），只给背景一点呼吸
		const rand = rngOf(20261004);
		for (const [nx, ny, nr, rgb] of [
			[0.22, 0.28, 0.55, [92, 46, 160]],
			[0.82, 0.72, 0.48, [40, 62, 150]],
		] as const) {
			const grd = g.createRadialGradient(
				view.w * nx,
				view.h * ny,
				0,
				view.w * nx,
				view.h * ny,
				Math.max(view.w, view.h) * nr,
			);
			grd.addColorStop(0, `rgb(${rgb.join(" ")} / 0.11)`);
			grd.addColorStop(1, `rgb(${rgb.join(" ")} / 0)`);
			g.fillStyle = grd;
			g.fillRect(0, 0, view.w, view.h);
		}

		// 星野：越靠中心越稀（黑洞附近会被"吸走"观感），外圈密
		const count = view.w < 760 ? 240 : 620;
		for (let i = 0; i < count; i++) {
			const x = rand() * view.w;
			const y = rand() * view.h;
			const cx = Math.abs(x - view.w * 0.5) / (view.w * 0.5);
			const cy = Math.abs(y - view.h * 0.5) / (view.h * 0.5);
			const near = 1 - clamp(Math.hypot(cx, cy), 0, 1);
			if (rand() < near * 0.72) continue; // 中心留空给黑洞
			const r = 0.3 + rand() * 1.1;
			g.globalAlpha = 0.16 + rand() * 0.62;
			g.fillStyle =
				rand() < 0.12 ? "#ffe6c0" : rand() < 0.4 ? "#cfe0ff" : "#ffffff";
			g.beginPath();
			g.arc(x, y, r, 0, TAU);
			g.fill();
		}
		g.globalAlpha = 1;
	}

	function drawBg(g: CanvasRenderingContext2D, s: Shared, view: View) {
		if (!field) return;
		// 视差：指针动一点，星野反着挪一点（克制 —— 别晕；"减少动态效果"下干脆不动）
		const px = s.px < 0 ? 0.5 : s.px / view.w;
		const py = s.py < 0 ? 0.5 : s.py / view.h;
		const calm = s.calm ? 0 : 1;
		const ox = (px - 0.5) * -18 * calm;
		const oy = (py - 0.5) * -12 * calm;
		g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		g.clearRect(0, 0, view.w, view.h);
		g.drawImage(field, ox, oy, view.w, view.h);
	}

	function draw(
		g: CanvasRenderingContext2D,
		s: Shared,
		view: View,
		hole: Hole,
		dt: number,
	) {
		const t = s.now * 0.001;
		// 「减少动态效果」：雾气与星尘基本停住，吸积盘照转（它是这一页的存在感）
		const calm = s.calm ? 0.25 : 1;
		const k = 0.34; // 吸积盘的俯视压缩（比法阵更"趴"，才有盘感）
		const R = hole.r;

		if (dust.length === 0) {
			const rand = rngOf(4242);
			for (let i = 0; i < (view.w < 760 ? 26 : 54); i++) {
				dust.push({
					a: rand() * TAU,
					r: R * (1.7 + rand() * 2.6),
					sp: (rand() < 0.5 ? -1 : 1) * (0.06 + rand() * 0.12),
					size: 0.5 + rand() * 1.1,
				});
			}
		}

		// ① 暗雾：低透明暗紫，从视界边缘缓慢往外扩（吞噬感）
		g.save();
		g.globalCompositeOperation = "lighter";
		for (let i = 0; i < 5; i++) {
			const a = t * 0.06 * calm + (i * TAU) / 5;
			const rr = R * (1.6 + 0.5 * Math.sin(t * 0.2 + i));
			const x = hole.x + Math.cos(a) * rr;
			const y = hole.y + Math.sin(a) * rr * k;
			const rad = R * (2.4 + 0.4 * Math.sin(t * 0.17 + i * 2));
			const grd = g.createRadialGradient(x, y, 0, x, y, rad);
			grd.addColorStop(0, "rgb(120 62 190 / 0.055)");
			grd.addColorStop(1, "rgb(120 62 190 / 0)");
			g.fillStyle = grd;
			g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
		}
		g.restore();

		// ② 星尘环：指针靠近时向内偏一点（spec §二 黑洞基础交互）
		g.save();
		for (const d of dust) {
			d.a += d.sp * (1 + s.hover * 1.5) * calm * dt;
			const target = R * (1.7 + (d.r / R - 1.7) * (1 - s.hover * 0.22));
			d.r = lerp(d.r, target, 1 - Math.exp(-1.6 * dt));
			const x = hole.x + Math.cos(d.a) * d.r;
			const y = hole.y + Math.sin(d.a) * d.r * k;
			g.globalAlpha = 0.32 + 0.3 * Math.sin(t * 1.4 + d.a);
			g.fillStyle = "#dfe8ff";
			g.beginPath();
			g.arc(x, y, d.size, 0, TAU);
			g.fill();
		}
		g.restore();

		const diskBoost = 1 + 0.4 * s.pulse;
		const rimBoost = 1 + 0.9 * s.pulse;

		// ③ 吸积盘远半（压在核心下面）
		g.save();
		g.globalCompositeOperation = "lighter";
		drawDisk(g, hole, k, s, t, false, diskBoost);
		g.restore();

		// ④ 引力透镜：贴着视界外的一条冷白细环 + 上下两道被弯折的弧
		g.save();
		g.globalCompositeOperation = "lighter";
		const ring = g.createRadialGradient(
			hole.x,
			hole.y,
			R * 0.92,
			hole.x,
			hole.y,
			R * 1.34,
		);
		ring.addColorStop(0, `rgb(240 248 255 / ${0.34 * rimBoost})`);
		ring.addColorStop(0.35, `rgb(190 214 255 / ${0.12 * rimBoost})`);
		ring.addColorStop(1, "rgb(160 190 255 / 0)");
		g.fillStyle = ring;
		g.fillRect(hole.x - R * 1.4, hole.y - R * 1.4, R * 2.8, R * 2.8);
		for (const dir of [-1, 1]) {
			g.globalAlpha = 0.3 + 0.35 * s.pulse;
			g.strokeStyle = "#e8f2ff";
			g.lineWidth = 1.3;
			g.beginPath();
			// 上方被"抬"起来的光弧，下方对称 —— 引力的味道就在这两道弧上
			g.ellipse(
				hole.x,
				hole.y - dir * R * 0.06,
				R * 1.16,
				R * 1.16 * 0.4,
				0,
				dir > 0 ? Math.PI * 1.05 : Math.PI * 0.05,
				dir > 0 ? Math.PI * 1.95 : Math.PI * 0.95,
			);
			g.stroke();
		}
		g.globalAlpha = 1;
		g.restore();

		// ⑤ 核心：近乎纯黑的圆（事件视界之内什么都没有）
		const core = g.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, R);
		core.addColorStop(0, "#000000");
		core.addColorStop(0.72, "#030308");
		core.addColorStop(1, "#07070d");
		g.fillStyle = core;
		g.beginPath();
		g.arc(hole.x, hole.y, R, 0, TAU);
		g.fill();
		// 事件视界细环（极细冷白）
		g.save();
		g.globalCompositeOperation = "lighter";
		g.strokeStyle = `rgb(236 246 255 / ${clamp(0.5 * rimBoost, 0, 1)})`;
		g.lineWidth = 0.9;
		g.beginPath();
		g.arc(hole.x, hole.y, R, 0, TAU);
		g.stroke();
		g.restore();

		// ⑥ 吸积盘近半（压在核心上面）
		g.save();
		g.globalCompositeOperation = "lighter";
		drawDisk(g, hole, k, s, t, true, diskBoost);
		g.restore();

		// ⑦ 吞噬反馈的引力波：一圈极淡的冷白往外扩
		if (s.wave >= 0) {
			const u = clamp(s.wave / 1.5, 0, 1);
			const rr = R * 1.1 + u * Math.min(view.w, view.h) * 0.42;
			g.save();
			g.globalCompositeOperation = "lighter";
			g.globalAlpha = (1 - u) * 0.16;
			g.strokeStyle = "#dfeaff";
			g.lineWidth = 1 + (1 - u) * 2;
			g.beginPath();
			g.arc(hole.x, hole.y, rr, 0, TAU);
			g.stroke();
			g.restore();
		}
	}

	/** 吸积盘：三色光带，各自转速不同；`near` = 只画靠近镜头的半圈。 */
	function drawDisk(
		g: CanvasRenderingContext2D,
		hole: Hole,
		k: number,
		s: Shared,
		t: number,
		near: boolean,
		boost: number,
	) {
		const R = hole.r;
		for (let band = 0; band < DISK.length; band++) {
			const rgb = DISK[band];
			if (!rgb) continue;
			const inner = R * (1.26 + band * 0.34);
			const outer = inner + R * (0.42 + band * 0.2);
			const spin = s.spin * (1 - band * 0.22) + t * 0.05 * (1 - band * 0.3);
			const segs = 40;
			for (let i = 0; i < segs; i++) {
				const a0 = spin + (TAU * i) / segs;
				const a1 = spin + (TAU * (i + 1)) / segs;
				const mid = (a0 + a1) / 2 - spin;
				const front = Math.sin(mid) >= 0;
				if (front !== near) continue;
				// 前面的亮、后面的暗（薄光边缘 + 深阴影）
				const depth = front ? 1 : 0.42;
				// 靠视界那一侧更亮（"光源来自黑洞方向"）
				const hot = 0.5 + 0.5 * Math.cos(mid);
				const alpha = clamp((0.1 + 0.26 * hot) * depth * boost, 0, 1);
				g.strokeStyle = `rgb(${rgb.join(" ")})`;
				g.globalAlpha = alpha;
				g.lineWidth = (outer - inner) * (front ? 1 : 0.85);
				g.beginPath();
				g.ellipse(
					hole.x,
					hole.y,
					(inner + outer) / 2,
					((inner + outer) / 2) * k,
					0,
					a0,
					a1,
				);
				g.stroke();
			}
			// 内缘高光：一条更细更亮的冷白弧
			g.globalAlpha = clamp(0.16 * boost * (near ? 1 : 0.4), 0, 1);
			g.strokeStyle = "#eef5ff";
			g.lineWidth = 1.1;
			g.beginPath();
			g.ellipse(hole.x, hole.y, inner, inner * k, 0, 0, TAU);
			g.stroke();
		}
		g.globalAlpha = 1;
	}

	return {
		resize(view: View) {
			rebake(view);
			dust = [];
		},
		rebake,
		drawBg,
		draw,
	};
}

/** 事件视界半径：跟着视口走，但**永远留给法阵**（不许因此挡住整页）。 */
export function holeOf(s: Shared, view: View): Hole {
	const r = clamp(
		Math.min(view.w, view.h) * (view.w < 760 ? 0.075 : 0.062),
		26,
		92,
	);
	return { x: s.hx, y: s.hy, r };
}

/** 指针靠近程度（0..1）：黑洞基础交互与星尘偏转都读它。 */
export function hoverOf(s: Shared, view: View, hole: Hole): number {
	if (s.px < 0) return 0;
	const d = Math.hypot(s.px - hole.x, s.py - hole.y);
	return smoothstep(
		1 - clamp((d - hole.r) / (Math.min(view.w, view.h) * 0.34), 0, 1),
	);
}
