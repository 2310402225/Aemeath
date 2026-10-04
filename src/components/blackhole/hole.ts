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
/**
 * 吸积盘的三条光带（内 → 外）：暗紫、幽青、钴蓝。
 * 🔴 这里踩过一次大的：**加色混合（lighter）下 alpha 会累加**。原来每条带 `0.1+0.26*hot`、
 *    带又厚（0.42R），再把透镜做成"0.34 白 + 2.8R 大方块" —— 三样叠在一起直接顶到 255，
 *    整颗黑洞渲染成一个**纯白甜甜圈**，离"暗宇宙里一点冷光"差了十万八千里。
 *    现在的配方：盘是**暗的**（单段峰值 ≤0.2），亮只留给视界外那一圈细的光子环。
 */
const BANDS: [number, number, number][] = [
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

		// 两团极淡的星云（暗紫 / 钴蓝）+ 一小团冷青，只给背景一点呼吸
		const rand = rngOf(20261004);
		for (const [nx, ny, nr, rgb] of [
			[0.2, 0.24, 0.5, [92, 46, 160]],
			[0.84, 0.72, 0.44, [40, 62, 150]],
			[0.52, 0.86, 0.3, [30, 96, 112]],
		] as const) {
			const grd = g.createRadialGradient(
				view.w * nx,
				view.h * ny,
				0,
				view.w * nx,
				view.h * ny,
				Math.max(view.w, view.h) * nr,
			);
			grd.addColorStop(0, `rgb(${rgb.join(" ")} / 0.17)`);
			grd.addColorStop(1, `rgb(${rgb.join(" ")} / 0)`);
			g.fillStyle = grd;
			g.fillRect(0, 0, view.w, view.h);
		}

		// 星野：越靠中心越稀（黑洞附近会被"吸走"观感），外圈密。
		// ⚠️ 星数/亮度/点径是一起看的：只加星数会让画面"脏"，只加亮度会让星变"糊点"。
		const count = view.w < 760 ? 420 : 1200;
		for (let i = 0; i < count; i++) {
			const x = rand() * view.w;
			const y = rand() * view.h;
			const cx = Math.abs(x - view.w * 0.5) / (view.w * 0.5);
			const cy = Math.abs(y - view.h * 0.5) / (view.h * 0.5);
			const near = 1 - clamp(Math.hypot(cx, cy), 0, 1);
			if (rand() < near * 0.72) continue; // 中心留空给黑洞
			const bright = rand();
			const r = 0.35 + bright * bright * 1.55;
			const warm = rand() < 0.12;
			const cool = !warm && rand() < 0.34;
			g.globalAlpha = 0.2 + bright * 0.7;
			g.fillStyle = warm ? "#ffe6c0" : cool ? "#cfe0ff" : "#ffffff";
			g.beginPath();
			g.arc(x, y, r, 0, TAU);
			g.fill();
			// 最亮的那一小撮给一层柔光，星野才有"深"的感觉（不加色，只提亮一圈）
			if (bright > 0.86) {
				g.globalAlpha = 0.1;
				g.beginPath();
				g.arc(x, y, r * 3.6, 0, TAU);
				g.fill();
			}
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
			for (let i = 0; i < (view.w < 760 ? 44 : 96); i++) {
				dust.push({
					a: rand() * TAU,
					r: R * (1.7 + rand() * 2.6),
					sp: (rand() < 0.5 ? -1 : 1) * (0.06 + rand() * 0.12),
					size: 0.6 + rand() * 1.5,
				});
			}
		}

		// ① 暗雾：低透明暗紫，从视界边缘缓慢往外扩（吞噬感）。
		//    这是"氛围层"，不是主体 —— 亮了会把盘和星野一起糊掉。
		g.save();
		g.globalCompositeOperation = "lighter";
		for (let i = 0; i < 6; i++) {
			const a = t * 0.05 * calm + (i * TAU) / 6;
			const rr = R * (1.4 + 0.45 * Math.sin(t * 0.2 + i));
			const x = hole.x + Math.cos(a) * rr;
			const y = hole.y + Math.sin(a) * rr * k;
			const rad = R * (1.9 + 0.5 * Math.sin(t * 0.17 + i * 2));
			const grd = g.createRadialGradient(x, y, 0, x, y, rad);
			grd.addColorStop(0, "rgb(126 66 196 / 0.09)");
			grd.addColorStop(1, "rgb(126 66 196 / 0)");
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
			g.globalAlpha = 0.42 + 0.34 * Math.sin(t * 1.4 + d.a);
			g.fillStyle = "#dfe8ff";
			g.beginPath();
			g.arc(x, y, d.size, 0, TAU);
			g.fill();
		}
		g.restore();

		const diskBoost = 1 + 0.35 * s.pulse;
		const rimBoost = 1 + 0.9 * s.pulse;

		// ③ 吸积盘远半（压在核心**下面**）：它绕到视界背后，被黑球吃掉大半
		g.save();
		g.globalCompositeOperation = "lighter";
		drawDisk(g, hole, k, s, t, false, diskBoost);
		g.restore();

		// ④ 引力透镜：上下两道被弯折的细弧。引力的味道就在这两道弧上。
		//    （原来这里还有一块"0.34 白铺满 2.8R"的透镜方框 —— 那是把整个中心区提亮，
		//      等于给黑洞糊了一手电筒，已经删掉；贴视界的那圈光现在归 ⑤ 的渐变环。）
		g.save();
		g.globalCompositeOperation = "lighter";
		for (const dir of [-1, 1]) {
			g.globalAlpha = 0.16 + 0.3 * s.pulse;
			g.strokeStyle = "#dce9ff";
			g.lineWidth = 1.1;
			g.beginPath();
			g.ellipse(
				hole.x,
				hole.y - dir * R * 0.06,
				R * 1.12,
				R * 1.12 * 0.4,
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
		core.addColorStop(0.74, "#020206");
		core.addColorStop(1, "#06060c");
		g.fillStyle = core;
		g.beginPath();
		g.arc(hole.x, hole.y, R, 0, TAU);
		g.fill();
		// 视界边光（光子环）：这一页真正"亮"的东西只有它。
		// ⚠️ 但它必须**极克制**。试过两种画法都会翻车：细圆线（1.2px/2.6px）会读成"白泡泡"，
		//    加宽的柔边渐变环更糟 —— 整个环都亮起来，直接是一圈发光圆箍套在黑球外面。
		//    根因：盘是压扁的椭圆、这个环在屏幕平面里是正圆，两者读不到同一个空间里去。
		//    所以只留一条**很淡**的窄渐变，够把视界的边勾勒出来就行，剩下的交给吸积盘内缘。
		g.save();
		g.globalCompositeOperation = "lighter";
		const rim = g.createRadialGradient(
			hole.x,
			hole.y,
			R * 0.975,
			hole.x,
			hole.y,
			R * 1.055,
		);
		rim.addColorStop(0, "rgb(236 246 255 / 0)");
		rim.addColorStop(
			0.5,
			`rgb(236 246 255 / ${clamp(0.15 * rimBoost, 0, 0.3)})`,
		);
		rim.addColorStop(1, "rgb(170 205 255 / 0)");
		g.fillStyle = rim;
		g.beginPath();
		g.arc(hole.x, hole.y, R * 1.055, 0, TAU);
		g.fill();
		g.restore();

		// ⑥ 吸积盘近半（压在核心**上面**）：盘从黑洞前面横过去 —— 这一趟不能省，
		//    省了就只剩"左右两片翅膀"（盘是压扁的椭圆、视界是正圆，上半圈本来就在球后面）
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

	/**
	 * 吸积盘。**在压扁的空间里画**（`translate` + `scale(1, k)`）：于是"圆"就是椭圆，
	 * 渐变、clip、圆弧全都按圆的写法来，一次 arc 就够了，不必逐段拼椭圆。
	 *
	 * 🔴 这里来回翻过三次车，四条规矩都别动：
	 *   ① 盘的主体会发光，靠的是**一圈从内缘往外衰减的椭圆辉光**（一次 radialGradient 填充），
	 *      不是"几条细光带"。细光带铺到屏幕上就是几根荧光线 —— 那是霓虹圈，不是吸积盘。
	 *   ② **必须分前后两趟**，近半画在核心**之后**。盘是压扁的椭圆（纵向半径只有 ~0.4R），
	 *      视界是正圆：上半圈整个压在黑球后面，只有外侧两肩露得出来。近半若也画在核心之前，
	 *      整条盘就只剩"左右两片翅膀"（实测就是这个症状）。分开画才有那张经典照片的意思：
	 *      **盘从黑洞前面横过去**。
	 *   ③ 分半用 **clip 半平面**，不是"逐段跳过"。逐段跳会在切点留下一道笔直的接缝，
	 *      而 clip 出来的是完整的半张盘，切口落在水平线上，本来就看不见。
	 *   ④ 环上的明暗沿角度用 cos **连续**变化 —— 既给出"盘在转"的信息，也不会出现硬边。
	 */
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
		g.save();
		g.translate(hole.x, hole.y);
		g.scale(1, k);
		// 只画自己那一半：局部坐标 y>0 是近半（屏幕下方），y<0 是远半
		g.beginPath();
		if (near) g.rect(-1e5, 0, 2e5, 1e5);
		else g.rect(-1e5, -1e5, 2e5, 1e5);
		g.clip();

		// 盘体：内缘最热（冷白），往外经过幽青、钴蓝，在暗紫里淡掉。
		// ⚠️ 填充必须**挖掉中心**：canvas 的 createRadialGradient 在 r < r0 的区域照样用
		//    0 号色标涂满 —— 不挖的话，近半那趟会在黑球下半部糊上一块平的暖灰板子
		//    （实测就是这个症状：黑球下半截变成一块不透明的盘子）。
		const [pur, cyan, blue] = [BANDS[0], BANDS[1], BANDS[2]] as const;
		const body = g.createRadialGradient(0, 0, R * 1.06, 0, 0, R * 2.6);
		body.addColorStop(0, `rgb(238 243 255 / ${clamp(0.32 * boost, 0, 0.48)})`);
		body.addColorStop(
			0.1,
			`rgb(${cyan.join(" ")} / ${clamp(0.2 * boost, 0, 0.32)})`,
		);
		body.addColorStop(
			0.3,
			`rgb(${blue.join(" ")} / ${clamp(0.11 * boost, 0, 0.18)})`,
		);
		body.addColorStop(
			0.64,
			`rgb(${pur.join(" ")} / ${clamp(0.04 * boost, 0, 0.08)})`,
		);
		body.addColorStop(1, `rgb(${pur.join(" ")} / 0)`);
		g.fillStyle = body;
		g.beginPath();
		g.arc(0, 0, R * 2.6, 0, TAU);
		g.arc(0, 0, R * 1.06, 0, TAU, true); // 反向 → 中间挖空
		g.fill();

		// 两条细环：给盘一点结构，否则只剩一团糊。亮度沿角度连续起伏 —— 旋转才看得见。
		g.lineCap = "round";
		const segs = 72;
		for (const [rr, wd, a] of [
			[1.22, 0.03, 0.34],
			[1.7, 0.018, 0.15],
		] as const) {
			const spin = s.spin * (1 - rr * 0.1) + t * 0.05;
			g.lineWidth = R * wd;
			g.strokeStyle = "rgb(232 242 255)";
			for (let i = 0; i < segs; i++) {
				const a0 = (TAU * i) / segs;
				const a1 = (TAU * (i + 1)) / segs;
				const shade = 0.5 + 0.5 * Math.cos((a0 + a1) / 2 - spin);
				g.globalAlpha = clamp(a * boost * (0.4 + 0.6 * shade), 0, 0.5);
				g.beginPath();
				g.arc(0, 0, R * rr, a0, a1);
				g.stroke();
			}
		}
		g.restore();
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
	// ⚠️ 0.062 在 1258×566 的视口上只有 35px —— "黑洞是视觉中心"当场落空，
	//    整页看起来是一颗远处的白点。0.098 实测才撑得住：视界 56px、吸积盘直径 ~270px。
	const r = clamp(
		Math.min(view.w, view.h) * (view.w < 760 ? 0.115 : 0.098),
		32,
		118,
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
