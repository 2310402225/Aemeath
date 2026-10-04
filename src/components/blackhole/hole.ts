// 深空背景 + 黑洞本体。两张画布，一支模块。
//
//   背景层（低频）：星野 + 暗雾 + 星云**烘进一张离屏位图**，每帧只贴一次图（带一点点视差）。
//     星野每帧重抽样毫无意义 —— 它又不动，动的是视差。走马灯那一页的教训：把"不变的东西"
//     每帧重算，是白扔的预算。
//   黑洞层（持续但低负载）：吸积盘按"远半 → 核心 → 近半"三趟画；再叠爱因斯坦环、
//     上下两道"盘的后半被抬到视界上方"的二次像、引力波。
//
// 模块**只读**共享态：吸积盘自转相位、吞噬脉冲、指针靠近程度都在接线层推进。
//
// 观感基准（神给的参考图，暖金路数）：白炽 → 米金 → 琥珀的一条**极薄**亮盘带，
// 视界正上方一圈亮环 + 几根细弧，四周是暖褐尘埃。曾经是青蓝紫 —— 那是另一套东西了。

import {
	clamp,
	type Hole,
	rngOf,
	type Shared,
	smoothstep,
	type View,
} from "./state";

const TAU = Math.PI * 2;

/**
 * 暖金四档（内 → 外）。整套观感只认这一条色轴：白炽 → 米金 → 琥珀 → 焦褐。
 * 数值是从参考图上**量**出来的（`rgb(255,255,250)` / `rgb(251,244,222)` / `rgb(216,188,155)` /
 * `rgb(154,125,99)`）—— 别凭手感挑色，暖金很容易一挑就橙。
 * 🔴 这里踩过一次大的：**加色混合（lighter）下 alpha 会累加**。三条厚带 + 一块"0.34 白铺满
 *    2.8R"的透镜大方框叠在一起直接顶到 255，整颗黑洞渲染成**纯白甜甜圈**。
 *    现在的大面积层一律 ≤0.46，亮只留给环、盘的内缘和那几根细弧。
 */
const GOLD: readonly (readonly [number, number, number])[] = [
	[255, 252, 240],
	[255, 232, 186],
	[214, 152, 72],
	[132, 72, 26],
] as const;

/**
 * 吸积盘的俯视压缩（在**压扁空间**里画，见 `drawDisk`）。
 * 参考图是**近乎侧视**的一条细光束 —— 从放大图上看：穿过视界那道线就是一根头发丝，
 * 球外的光束本身也就二十来像素厚。
 * ⚠️ 关键一条：**盘的 y 向厚度正比于 KD**（近半那趟铺在赤道下方 `r·KD`）。所以
 *     "一根细亮的针" + "一片宽而暗的晕"这两件事，**一个 KD 画不出来** —— 必须在
 *     `draw()` 里用两个 KD 各画一趟（见 ③ 与 ⑦ 的头两行）。
 */
const KD = 0.045;

export type HoleLayer = {
	resize(view: View, s: Shared): void;
	drawBg(g: CanvasRenderingContext2D, s: Shared, view: View): void;
	draw(
		g: CanvasRenderingContext2D,
		s: Shared,
		view: View,
		hole: Hole,
		dt: number,
	): void;
	/** 星野重烘（窗口尺寸变了才需要） */
	rebake(view: View, s: Shared): void;
};

export function createHoleLayer(): HoleLayer {
	let field: HTMLCanvasElement | null = null;
	/**
	 * 绕着黑洞往里掉的暖尘（不是背景星 —— 这些是活的，而且**持续被吸进去**）。
	 * `r` 一路减到视界半径就回收重放到外圈 —— 这是"光/物质被吞进去"最直白的读数。
	 */
	let dust: { a: number; r: number; sp: number; fall: number; size: number }[] =
		[];

	function rebake(view: View, s: Shared) {
		const w = Math.max(1, Math.round(view.w * view.dpr));
		const h = Math.max(1, Math.round(view.h * view.dpr));
		// 视界的位置/半径要先算：下面那层暖雾要用，末尾的引力透镜也要用
		const hz = holeOf(s, view);
		if (!field) field = document.createElement("canvas");
		field.width = w;
		field.height = h;
		const g = field.getContext("2d");
		if (!g) return;
		g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		g.clearRect(0, 0, view.w, view.h);

		// 底色：深到近乎黑，只留一丝冷蓝（参考图左上角就是 rgb(1,2,7)），四角再压一点
		const base = g.createRadialGradient(
			view.w * 0.5,
			view.h * 0.46,
			0,
			view.w * 0.5,
			view.h * 0.5,
			Math.hypot(view.w, view.h) * 0.62,
		);
		base.addColorStop(0, "#080609");
		base.addColorStop(0.55, "#050508");
		base.addColorStop(1, "#010205");
		g.fillStyle = base;
		g.fillRect(0, 0, view.w, view.h);

		// 星云：三团**暖褐**尘埃（参考图上量出来是 rgb(31,29,26) 那一档，很暗、不饱和）
		// + 一小团冷蓝找深度。暖褐别调亮 —— 一擦亮就变成"土黄滤镜"。
		const rand = rngOf(20261004);
		for (const [nx, ny, nr, rgb] of [
			[0.24, 0.2, 0.5, [124, 88, 56]],
			[0.62, 0.3, 0.36, [138, 102, 66]],
			[0.2, 0.8, 0.42, [110, 82, 58]],
			[0.86, 0.68, 0.4, [38, 48, 78]],
		] as const) {
			const grd = g.createRadialGradient(
				view.w * nx,
				view.h * ny,
				0,
				view.w * nx,
				view.h * ny,
				Math.max(view.w, view.h) * nr,
			);
			grd.addColorStop(
				0,
				`rgb(${rgb.join(" ")} / ${rgb[0] > 100 ? 0.16 : 0.13})`,
			);
			grd.addColorStop(1, `rgb(${rgb.join(" ")} / 0)`);
			g.fillStyle = grd;
			g.fillRect(0, 0, view.w, view.h);
		}

		// 顺着光束铺开的一层**贴着盘面**的暖光晕。它是"光束的散射光"，不是绕着黑洞的
		// 一圈雾 —— 所以纵向压得很扁（`scale(1, 0.5)`）、半径也只到 3.2R。
		// ⚠️ 踩过两次，别再把这两件事做反：
		//    ① 做成**正圆**的大暖雾（半径 5R、alpha 0.46）→ 一圈平滑的径向渐变把星空
		//       糊平，整页变成一颗"奶球"，参考图那种高对比 + 暗底 + 一条条细丝全没了。
		//    ② alpha 稍高（0.3）就已经能看出那道**椭圆边界**，像贴了张渐变贴纸。
		//    所以它只能"低 + 扁 + 小"，远处的亮度交给 ④ 那"扇"细丝。
		g.save();
		g.translate(hz.x, hz.y);
		g.scale(1, 0.5);
		const haze = g.createRadialGradient(0, 0, 0, 0, 0, hz.r * 3.2);
		haze.addColorStop(0, "rgb(200 170 132 / 0.22)");
		haze.addColorStop(0.7, "rgb(200 170 132 / 0.19)");
		haze.addColorStop(1, "rgb(200 170 132 / 0)");
		g.fillStyle = haze;
		g.fillRect(-hz.r * 3.2, -hz.r * 3.2, hz.r * 6.4, hz.r * 6.4);
		g.restore();

		// 星野。⚠️ 这里**不再掏空中心**：透镜要靠 θ ≈ 1R 处那一圈像素去采 β < 1R 的星，
		//    中心留空的话，视界外那圈环采回来的是空白，"光堆在环上"当场落空。
		//    中间那片本来就会被不透明的视界圆盖掉，不必提前省。
		// ⚠️ 星数/亮度/点径是一起看的：只加星数会让画面"脏"，只加亮度会让星变"糊点"。
		// ⚠️ 星数按**面积**给，别按宽度给死：1440×900 上 1320 颗密得像撒了一把沙子，
		//    参考图那片天是疏的（大约每 1500 平方像素一颗）。
		const count = view.w < 760 ? 340 : Math.round((view.w * view.h) / 1500);
		for (let i = 0; i < count; i++) {
			const x = rand() * view.w;
			const y = rand() * view.h;
			const bright = rand();
			// ⚠️ 点径别贪大：0.35 + b²·1.55 那版每颗星最大 1.9px，加上柔光就是一个 7px 的
			//    毛球，1320 颗铺下来整片天是"脏"的。参考图的星是**小而锐**的点。
			const r = 0.3 + bright * bright * 1.25;
			// 暖白为主（参考图的星是暖的），少数冷蓝白拉开层次
			const cool = rand() < 0.26;
			g.globalAlpha = 0.2 + bright * 0.7;
			g.fillStyle = cool ? "#d6e2ff" : "#fff4de";
			g.beginPath();
			g.arc(x, y, r, 0, TAU);
			g.fill();
			// 最亮的那一小撮给一层柔光，星野才有"深"的感觉（不加色，只提亮一圈）
			if (bright > 0.9) {
				g.globalAlpha = 0.07;
				g.beginPath();
				g.arc(x, y, r * 2.8, 0, TAU);
				g.fill();
			}
		}
		g.globalAlpha = 1;

		// 最后一步：把引力透镜算进去（它就是"光被扭曲"的全部来源）。
		// ⚠️ 降级路线（窄屏 / 粗指针 / 弱机）跳过 —— 它是一次 O(像素数) 的重映射，
		//    在手机上不值得花这个预算，静默跳过也不会少任何"能读出来的东西"。
		if (!s.lite) lensWarp(g, view, hz);
	}

	/**
	 * 引力透镜：把烘好的星野按"光线经过黑洞附近被弯折"重映射一遍。
	 *
	 * 用透镜方程的反解：视位置 θ 处的光子来自真位置 `β = θ − θE²/θ`。
	 *   · θ → θE 时 β → 0：紧贴视界外的那一圈，采回来的是**中心附近**的天区，
	 *     整片天被压进极窄的一环 —— 这就是爱因斯坦环。
	 *   · θ 很大时 β ≈ θ − θE²/θ → 远处星光被轻轻往黑洞方向拉（4R 处还有 0.06R 的位移）。
	 *   · 因为 dβ/dθ = 1 + θE²/θ² > 1，越靠近环，同样多的星被塞进越短的一段半径 →
	 *     **环上更密更亮**，正是"光堆在视界外"的读数。
	 *
	 * ⚠️ 这是**纯算法**：没有任何贴图，只有一条公式 + 一张自己烘的星野。
	 * ⚠️ 只在烘的时候做一次。每帧做等于每帧读 5M 像素 —— 见过这个坑，不再踩。
	 * ⚠️ 透镜中心固定在**页面中心**（也就是黑洞的静止位）。拖动黑洞时画面中心会留一点
	 *    "被掰弯的星"—— 位移只有零点几个 R，且拖动是瞬态，松手就弹回来，不值得为它
	 *    改成每帧重映射（那是两个数量级的代价）。但**贴着视界的那圈环和细弧是每帧画的**，
	 *    跟着黑洞走 —— 读数最重的那部分永远对得上。
	 */
	function lensWarp(g: CanvasRenderingContext2D, view: View, hole: Hole) {
		const W = g.canvas.width;
		const H = g.canvas.height;
		const sc = view.dpr;
		// 只在 dpr 像素空间里搬像素；中心与半径都要乘 sc
		const cx = hole.x * sc;
		const cy = hole.y * sc;
		const R = hole.r * sc;
		const thetaE = R * 0.86;
		// 影响半径之外原样不动：θE/θ 在 6R 处只剩 0.02R，再往外做纯浪费
		const far = R * 6;
		const x0 = Math.max(0, Math.floor(cx - far));
		const x1 = Math.min(W, Math.ceil(cx + far) + 1);
		const y0 = Math.max(0, Math.floor(cy - far));
		const y1 = Math.min(H, Math.ceil(cy + far) + 1);
		if (x1 <= x0 || y1 <= y0) return;

		let src: ImageData;
		try {
			src = g.getImageData(x0, y0, x1 - x0, y1 - y0);
		} catch {
			return; // 图源被污染时宁可不要透镜，也不能整页炸掉
		}
		const sw = x1 - x0;
		const sh = y1 - y0;
		const sp = src.data;
		const out = g.createImageData(sw, sh);
		const op = out.data;
		// 先原样拷一份：以外（及所有采不到样本的位置）保持不动
		op.set(sp);

		for (let y = 0; y < sh; y++) {
			const dy = y0 + y - cy;
			for (let x = 0; x < sw; x++) {
				const dx = x0 + x - cx;
				const d2 = dx * dx + dy * dy;
				if (d2 >= far * far || d2 < 1) continue;
				const d = Math.sqrt(d2);
				// β = θ − θE²/θ；钳到 0（视界内什么都没有，采哪都一样黑）
				const b = Math.max(0, d - (thetaE * thetaE) / d);
				const k = b / d;
				const sx = Math.round(x + dx * (k - 1));
				const sy = Math.round(y + dy * (k - 1));
				if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
				const si = (sy * sw + sx) * 4;
				const di = (y * sw + x) * 4;
				op[di] = sp[si];
				op[di + 1] = sp[si + 1];
				op[di + 2] = sp[si + 2];
				op[di + 3] = sp[si + 3];
			}
		}
		g.putImageData(out, x0, y0);
	}

	function drawBg(g: CanvasRenderingContext2D, s: Shared, view: View) {
		if (!field) return;
		// 视差：指针动一点，星野反着挪一点（克制 —— 别晕；"减少动态效果"下干脆不动）。
		// ⚠️ 幅度压到 ±7px：整张星野是**烘的时候就按页面中心掰过（引力透镜）**的，
		//    视差一大，那圈被掰弯的星就会跟黑洞错开，看着像画歪了。
		const px = s.px < 0 ? 0.5 : s.px / view.w;
		const py = s.py < 0 ? 0.5 : s.py / view.h;
		const calm = s.calm ? 0 : 1;
		const ox = (px - 0.5) * -7 * calm;
		const oy = (py - 0.5) * -5 * calm;
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
		const R = hole.r;

		if (dust.length === 0) {
			const rand = rngOf(4242);
			for (let i = 0; i < (view.w < 760 ? 48 : 104); i++) {
				dust.push({
					a: rand() * TAU,
					r: R * (1.6 + rand() * 2.8),
					sp: (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.1),
					fall: R * (0.05 + rand() * 0.16),
					size: 0.6 + rand() * 1.5,
				});
			}
		}

		// ① 暗雾：暖褐，从视界边缘缓慢往外扩（吞噬感）。
		//    这是"氛围层"，不是主体 —— 亮了会把盘和星野一起糊掉。
		g.save();
		g.globalCompositeOperation = "lighter";
		for (let i = 0; i < 6; i++) {
			const a = t * 0.05 * calm + (i * TAU) / 6;
			const rr = R * (1.4 + 0.45 * Math.sin(t * 0.2 + i));
			const x = hole.x + Math.cos(a) * rr;
			const y = hole.y + Math.sin(a) * rr * KD;
			const rad = R * (1.9 + 0.5 * Math.sin(t * 0.17 + i * 2));
			const grd = g.createRadialGradient(x, y, 0, x, y, rad);
			grd.addColorStop(0, "rgb(150 92 40 / 0.1)");
			grd.addColorStop(1, "rgb(150 92 40 / 0)");
			g.fillStyle = grd;
			g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
		}
		g.restore();

		// ② 暖尘：**持续往视界里掉**。这是"光/物质被吸进去"最直白的读数 ——
		//    指针一靠近，掉得更快（spec §二 黑洞基础交互）；落到 `R*1.02` 就回收重放到外圈。
		//    ⚠️ 别改成"绕圈打转"：原地转读不出引力，只有确确实实在往里掉才算数。
		g.save();
		g.globalCompositeOperation = "lighter";
		for (const d of dust) {
			const pull = 1 + s.hover * 2.2;
			// 角速度随半径变小而变大 —— 螺旋收进去，不是直挺挺地往下栽
			d.a +=
				(d.sp * (1 + s.hover * 1.5) + (d.fall / Math.max(d.r, 1)) * 0.4) *
				calm *
				dt;
			d.r -= d.fall * pull * calm * dt;
			if (d.r < R * 1.02) {
				d.r = R * (2.6 + Math.random() * 2.4);
				d.a = Math.random() * TAU;
			}
			const x = hole.x + Math.cos(d.a) * d.r;
			const y = hole.y + Math.sin(d.a) * d.r * KD;
			g.globalAlpha =
				(0.28 + 0.3 * Math.sin(t * 1.4 + d.a)) * (1 + s.hover * 0.4);
			g.fillStyle = "#ffd9a0";
			g.beginPath();
			g.arc(x, y, d.size, 0, TAU);
			g.fill();
		}
		g.restore();

		// ②b 环绕视界的暖色大晕："光被掰弯之后糊在四周"的那一层。
		//    它现在只负责**贴身的**那一圈暖光 —— 更外那一大圈（1.5R~3R）已经烘进背景星野
		//    的暖雾里了（见 `rebake`）。这里再铺一遍就是重复计光，加色混合下必糊。
		//    ⚠️ 画在核心**之前**：球内那部分会被不透明的视界盖掉，正好不用挖。
		g.save();
		g.globalCompositeOperation = "lighter";
		// ⚠️ 这几团必须**压扁**（`scale(1, 0.5)`）。原来画成正圆，结果球周围浮着一团
		//    圆形的褐色雾 —— 参考图那圈光是**顺着盘铺开的扁平形状**，不是个气球。
		for (const [oy, rad, rgb, a] of [
			[0.7, 1.5, [214, 152, 72], 0.24],
			[-0.25, 1.5, [214, 152, 72], 0.17],
		] as const) {
			g.save();
			g.translate(hole.x, hole.y + oy * R);
			g.scale(1, 0.5);
			const gr = R * rad;
			const grd = g.createRadialGradient(0, 0, 0, 0, 0, gr);
			grd.addColorStop(0, `rgb(${rgb.join(" ")} / ${a})`);
			grd.addColorStop(0.45, `rgb(${rgb.join(" ")} / ${a * 0.6})`);
			grd.addColorStop(1, `rgb(${rgb.join(" ")} / 0)`);
			g.fillStyle = grd;
			g.fillRect(-gr, -gr, gr * 2, gr * 2);
			g.restore();
		}
		g.restore();

		const diskBoost = 1 + 0.35 * s.pulse;
		// 透镜那一套（爱因斯坦环 + 细弧）整体提一档：吞噬时"光被掰得更狠"
		const lensBoost = 1 + 0.5 * s.pulse;
		/** 弧线的颜色。暖金第二档（米金），和盘体同一根色轴。 */
		const ARC = `rgb(${GOLD[1].join(" ")})`;

		// ③ 吸积盘远半（压在核心**下面**）：它绕到视界背后，被黑球吃掉大半，
		//    只剩外侧两肩露出来 —— 参考图上赤道左右那两片最亮的地方就是它。
		g.save();
		g.globalCompositeOperation = "lighter";
		// 两趟：**宽而暗的一层先铺（晕）**，**细而亮的那根后画（针）**。
		// 参考图就是"一根细亮线泡在一片宽光里"；顺序反了针会被晕糊掉一层。
		drawDisk(g, hole, KD * 3.2, s, t, false, diskBoost * 0.34);
		drawDisk(g, hole, KD, s, t, false, diskBoost);
		g.restore();

		// ④ 引力透镜（一）：**上下两组细弧** —— 盘的后半被引力抬到视界上方/下方的二次像。
		//    参考图上视界正上方那几根平行的细弧就是它，也是整页"引力"味道最重的一笔。
		//    ⚠️ 每段强度按 `sin(φ)^1.6` 收到 0 —— 直接画半圆会在两端留下一道硬切口，
		//    那看着像"没画完"，不像被弯折的光。
		g.save();
		g.globalCompositeOperation = "lighter";
		g.lineCap = "round";
		g.strokeStyle = ARC;
		// ⚠️ 上下两套**分开列**，不是同一份。参考图量出来：上方 1.17R→219 / 1.31R→152 /
		//    1.44R→67（一道暗缝）/ 1.58R→89 / 1.80R→91 / 2.20R→85；下方 1.15R→255 /
		//    1.33R→159 / 1.47R→216 / 1.61R→188 / 1.75R→88 —— 下方**又宽又亮、还多一层**
		//    （盘在下面那一侧绕过来的光更多）。用同一份表的后果是上方糊成一片、
		//    下方又撑不起那个 216 的肩。
		// 元组 = `[横向半轴, 纵向半轴, 线宽, 亮度, 旋转]`（半轴单位 R、旋转单位弧度）。
		//  · **两个半轴分开给**（纵向更小）让它们读成"趴下来的弓"，不是一圈圈同心圆。
		//  · **旋转**（越往外扭得越多）是最后一块拼图：全部轴对齐的话，一"扇"弧叠起来
		//    还是靶子；同方向逐渐扭过去，才读成一团**漩涡**（参考图视界上方那团就是）。
		const BANDS: readonly (readonly [
			number,
			number,
			number,
			number,
			number,
		])[][] = [
			// 下方（屏幕 y 向下就是它）
			[
				[1.32, 1.15, 0.05, 0.54, 0],
				[1.52, 1.33, 0.04, 0.32, 0.03],
				[1.68, 1.47, 0.075, 0.5, 0.05],
				[1.86, 1.63, 0.055, 0.32, 0.08],
				[2.12, 1.87, 0.03, 0.18, 0.1],
				[2.44, 2.15, 0.025, 0.14, 0.13],
				[2.85, 2.54, 0.02, 0.1, 0.16],
			],
			// 上方。⚠️ 外面那几道（1.5R~2.6R）不能省：参考图正上方 1.58R→89 / 1.80R→91 /
			//    2.20R→85，是几根**一直缠到 2.6R 外的细丝**，不是一处近处的亮弧。
			//    少了它们黑洞上方就是一片空；曾经靠一层正圆大暖雾去补，补成了一颗"奶球"。
			[
				[1.28, 1.12, 0.06, 0.54, 0],
				[1.46, 1.29, 0.045, 0.34, 0.03],
				[1.72, 1.53, 0.03, 0.12, 0.05],
				[2.02, 1.8, 0.032, 0.15, 0.08],
				[2.48, 2.22, 0.028, 0.11, 0.11],
				[2.95, 2.63, 0.026, 0.08, 0.14],
			],
		];
		for (const dir of [-1, 1]) {
			// ⚠️ 强弱的配比是量出来的，别凭手感：第一版给成 0.5/0.3/0.17，量出来是
			//    77/39/26 —— 四道几乎一样亮，读起来像**同心圆测试卡**，不像被掰弯的光。
			//    后来收敛成"一把粗细各异、越往外越弱的细丝"，参考图那些弧线更像**毛笔
			//    扫过去的痕**，所以还让线宽跟着 `fade` 走（两端收细、中段最粗）。
			for (const [rx, ry, wd, a, rot] of BANDS[dir > 0 ? 0 : 1]) {
				const steps = 72;
				// 越宽的带子收得越紧：它们本来就淡，横向铺太远就变成一圈完整椭圆的"箍"
				const P = wd > 0.06 ? 5.5 : 3.6;
				for (let i = 0; i < steps; i++) {
					const ph0 = (i / steps) * Math.PI;
					const ph1 = ((i + 1) / steps) * Math.PI;
					const fade = Math.sin((ph0 + ph1) / 2) ** P;
					g.globalAlpha = clamp(a * lensBoost * fade, 0, 0.75);
					if (g.globalAlpha < 0.012) continue;
					// 两端收细、中段最粗 —— 一根粗细均匀的圆环是"箍"，不是"痕"
					g.lineWidth = Math.max(1.2, R * wd * (0.45 + 0.85 * fade));
					g.beginPath();
					// dir>0 画下半圈（屏幕 y 向下，0→π 正好扫过下方）
					g.ellipse(
						hole.x,
						hole.y,
						R * rx,
						R * ry,
						rot,
						dir > 0 ? ph0 : -ph1,
						dir > 0 ? ph1 : -ph0,
					);
					g.stroke();
				}
			}
		}
		g.globalAlpha = 1;
		g.restore();

		// ⑤ 核心：近乎纯黑的圆（事件视界之内什么都没有）。
		//    参考图上它真的是一块纯黑，别往里加"星尘透过来" —— 一透就成了灰球。
		const core = g.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, R);
		core.addColorStop(0, "#000000");
		core.addColorStop(0.8, "#010104");
		core.addColorStop(1, "#040407");
		g.fillStyle = core;
		g.beginPath();
		g.arc(hole.x, hole.y, R, 0, TAU);
		g.fill();

		// ⑥ 引力透镜（二）：**爱因斯坦环**。视界外那一圈是光堆出来的 —— 整片天被压进
		//    极窄的一环（见 `lensWarp` 的 β = θ − θE²/θ），所以它是全页最亮的一条线。
		//    ⚠️ 上一版这里只有一条"0.15 冷白"的渐变，读成一圈白泡泡，所以当时不敢画亮。
		//       这一版敢，靠三样一起：① 环是**暖金**的，跟盘同一根色轴；② 盘的两肩就落在
		//       同一个半径上，环读起来是"盘的内缘绕过来"，不是凭空一个箍；③ 强度沿角度连续
		//       起伏（赤道两侧最亮），不是死圆。
		g.save();
		g.globalCompositeOperation = "lighter";
		// 外侧柔光：把"亮"铺开一点，别只有一条线。
		// ⚠️ 必须挖掉中心 —— createRadialGradient 在 r < r0 的区域照样用 0 号色标涂满，
		//    不挖就会给纯黑的核心糊上一层 0.2 的暖光，黑球变褐色。
		const halo = g.createRadialGradient(
			hole.x,
			hole.y,
			R,
			hole.x,
			hole.y,
			R * 1.3,
		);
		halo.addColorStop(
			0,
			`rgb(${GOLD[1].join(" ")} / ${clamp(0.26 * lensBoost, 0, 0.36)})`,
		);
		halo.addColorStop(
			0.45,
			`rgb(${GOLD[2].join(" ")} / ${clamp(0.1 * lensBoost, 0, 0.16)})`,
		);
		halo.addColorStop(1, `rgb(${GOLD[2].join(" ")} / 0)`);
		g.fillStyle = halo;
		g.beginPath();
		g.arc(hole.x, hole.y, R * 1.3, 0, TAU);
		g.arc(hole.x, hole.y, R * 0.985, 0, TAU, true);
		g.fill();
		// 环本体：逐段画。**厚度和亮度都随角度变** —— 参考图里视界下缘是一条宽带、
		// 上缘只是一根细线（盘在下面那一侧的光更多绕过来），死圆是画不像的。
		// ⚠️ 强度系数必须是**同一个连续函数**，见 `drawDisk` 的第 ④ 条注。
		const segs = 96;
		g.lineCap = "round";
		g.strokeStyle = `rgb(${GOLD[0].join(" ")})`;
		for (let i = 0; i < segs; i++) {
			const ph0 = (TAU * i) / segs;
			const ph1 = (TAU * (i + 1)) / segs;
			const mid = (ph0 + ph1) / 2;
			const down = Math.max(0, Math.sin(mid)); // 屏幕 y 向下，sin>0 就是下缘
			const lobe = 0.55 + 0.3 * Math.abs(Math.cos(mid)) + 0.42 * down;
			g.lineWidth = Math.max(1.6, R * (0.055 + 0.075 * down));
			g.globalAlpha = clamp(0.62 * lensBoost * lobe, 0, 1);
			g.beginPath();
			g.arc(hole.x, hole.y, R * 1.035, ph0, ph1);
			g.stroke();
		}
		g.globalAlpha = 1;
		g.restore();

		// ⑦ 吸积盘近半（压在核心**上面**）：盘从黑洞前面横过去 —— 这一趟不能省，
		//    省了就只剩"左右两片翅膀"（盘是压扁的椭圆、视界是正圆，上半圈本来就在球后面）。
		//    ⚠️ **只画球外那两段**（`zone: "out"`）。一开始让它整张铺过去，结果球内那一段
		//      铺成一块 `0.09R~0.3R` 厚、带硬边的亮板 —— 黑球下半截直接变成"一块盘子"，
		//      而且板子的上下边都是硬的（赤道一条、渐变尾部一条），非常假。
		//      参考图里穿过视界的只有**一根头发丝**，所以那根单独画（见 ⑧）。
		g.save();
		g.globalCompositeOperation = "lighter";
		drawDisk(g, hole, KD * 3.2, s, t, true, diskBoost * 0.34, "out");
		drawDisk(g, hole, KD, s, t, true, diskBoost, "out");
		g.restore();

		// ⑧ 横穿视界的那道细线：盘的内缘在视界前面掠过去。
		//    单独画一条直线，**不要**拿近半那趟去铺 —— 盘的厚度由 `KD` 定，铺出来必然是一块板，
		//    而这里要的是"一根线"。参考图上它峰值只有 `rgb(52,30,19)`（暗橙），因为它是画在
		//    本该全黑的核心上的，一点点漏光就够了 —— 顺手量过：alpha 0.34 出来是 rgb(86,64,41)，
		//    正好亮了一档、黑球看着像"被线扎穿"，所以压到 0.21。
		g.save();
		g.globalCompositeOperation = "lighter";
		g.globalAlpha = clamp(0.21 * diskBoost, 0, 0.3);
		g.strokeStyle = "rgb(250 150 95)";
		g.lineWidth = Math.max(1, R * 0.022);
		g.beginPath();
		g.moveTo(hole.x - R * 1.07, hole.y);
		g.lineTo(hole.x + R * 1.07, hole.y);
		g.stroke();
		g.restore();

		// ⑧ 吞噬反馈的引力波：一圈暖金往外扩
		if (s.wave >= 0) {
			const u = clamp(s.wave / 1.5, 0, 1);
			const rr = R * 1.1 + u * Math.min(view.w, view.h) * 0.42;
			g.save();
			g.globalCompositeOperation = "lighter";
			g.globalAlpha = (1 - u) * 0.17;
			g.strokeStyle = ARC;
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
	 * 🔴 这里来回翻过四次车，四条规矩都别动：
	 *   ① 盘体靠的是**一圈从内缘往外衰减的椭圆辉光**（一次 radialGradient 填充），不是
	 *      "几条细光带"。细光带铺到屏幕上就是几根荧光线 —— 那是霓虹圈，不是吸积盘。
	 *   ② **必须分前后两趟**，近半画在核心**之后**。盘是压扁的椭圆（`KD = 0.2` 时纵半径只有
	 *      0.46R），视界是正圆：上半圈整个压在黑球后面，只有外侧两肩露得出来。近半若也画在
	 *      核心之前，整条盘就只剩"左右两片翅膀"（实测就是这个症状）。
	 *   ③ 分半用 **clip 半平面**，不是"逐段跳过"。逐段跳会在切点留下一道笔直的接缝，
	 *      而 clip 出来的是完整的半张盘，切口落在水平线上，本来就看不见。
	 *   ④ 盘上的明暗沿角度用 cos **连续**变化 —— 既给出"盘在转"的信息，也不会出现硬边。
	 *      ⚠️ 别写成 `0.3 + 0.7·side` 那种"按前后给系数"：两趟会各自把**整圈**点一遍，
	 *      alpha 与亮度双双翻倍、前后梯度被互相填平（实测画出过三条荧光白圈）。
	 */
	function drawDisk(
		g: CanvasRenderingContext2D,
		hole: Hole,
		k: number,
		s: Shared,
		t: number,
		near: boolean,
		boost: number,
		/** 只要球外那两段（`out`）、只要穿过球的那一段（`in`）、还是整张（`all`） */
		zone: "all" | "in" | "out" = "all",
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
		// 球内 / 球外。⚠️ 已经在 `scale(1,k)` 里了，屏幕上的**正圆**在这里是个
		// 横半轴 R、纵半轴 R/k 的椭圆 —— 直接 `arc(0,0,R)` 会剪出一个压扁的圈。
		if (zone !== "all") {
			g.beginPath();
			if (zone === "in") {
				g.ellipse(0, 0, R, R / k, 0, 0, TAU);
			} else {
				g.rect(-1e5, -1e5, 2e5, 2e5);
				g.ellipse(0, 0, R, R / k, 0, 0, TAU, true); // 反向 → 挖掉球内
			}
			g.clip();
		}

		// 盘体：**这条曲线是从参考图上量出来的**，不是调出来的。
		//   参考图贴球外侧的横向剖面（以球半径 R 为单位）：
		//     1.06R→254 / 1.39R→253 / 1.76R→253 / 2.18R→232 / 2.59R→199 / 3.06R→142
		//   也就是——**近白的一条平台**一直铺到 1.8R，之后慢速衰减，而且这条带子伸出画外。
		//   ⚠️ 所以 r1 从 2.3R 拉到了 3.4R：2.3R 那版的盘是一颗短粗的"眼睛"，
		//      读起来是"远处一颗发光点"，不是参考图那种横贯画面的光束。
		// ⚠️ 填充必须**挖掉中心**：canvas 的 createRadialGradient 在 r < r0 的区域照样用
		//    0 号色标涂满 —— 不挖的话，近半那趟会在黑球下半部糊上一块平的亮板
		//    （实测就是这个症状：黑球下半截变成一块不透明的盘子）。
		const H1 = "255 252 240";
		const H2 = "253 246 224";
		const H3 = "232 206 172";
		const H4 = "199 165 131";
		const H5 = "120 96 78";
		// ⚠️ 外缘给到 **4.6R**：参考图那条光束是**伸出画外**的，没有收口。
		//    原来 3.4R 收尾，末端必然收成一个尖 —— 一眼就看得出是"画出来的东西"。
		const body = g.createRadialGradient(0, 0, R * 1.02, 0, 0, R * 4.6);
		body.addColorStop(0, `rgb(${H1} / ${clamp(0.72 * boost, 0, 0.82)})`);
		body.addColorStop(0.06, `rgb(${H2} / ${clamp(0.86 * boost, 0, 0.94)})`);
		body.addColorStop(0.15, `rgb(${H2} / ${clamp(0.9 * boost, 0, 0.96)})`);
		body.addColorStop(0.26, `rgb(${H1} / ${clamp(0.84 * boost, 0, 0.9)})`);
		body.addColorStop(0.4, `rgb(${H3} / ${clamp(0.68 * boost, 0, 0.78)})`);
		body.addColorStop(0.55, `rgb(${H4} / ${clamp(0.5 * boost, 0, 0.6)})`);
		body.addColorStop(0.72, `rgb(${H4} / ${clamp(0.4 * boost, 0, 0.48)})`);
		body.addColorStop(0.87, `rgb(${H4} / ${clamp(0.24 * boost, 0, 0.3)})`);
		body.addColorStop(0.96, `rgb(${H4} / ${clamp(0.1 * boost, 0, 0.14)})`);
		body.addColorStop(1, `rgb(${H5} / 0)`);
		g.fillStyle = body;
		g.beginPath();
		g.arc(0, 0, R * 4.6, 0, TAU);
		g.arc(0, 0, R * 1.02, 0, TAU, true); // 反向 → 中间挖空
		g.fill();

		// 两圈亮度的"结"：给盘一点结构，否则只剩一团糊。亮度沿角度连续起伏 —— 转才看得见。
		g.lineCap = "round";
		const segs = 72;
		for (const [rr, wd, a] of [
			[1.72, 0.022, 0.32],
			[2.62, 0.014, 0.16],
		] as const) {
			const spin = s.spin * (1 - rr * 0.1) + t * 0.05;
			g.lineWidth = R * wd;
			g.strokeStyle = `rgb(${H1})`;
			for (let i = 0; i < segs; i++) {
				const a0 = (TAU * i) / segs;
				const a1 = (TAU * (i + 1)) / segs;
				const shade = 0.5 + 0.5 * Math.cos((a0 + a1) / 2 - spin);
				g.globalAlpha = clamp(a * boost * (0.4 + 0.6 * shade), 0, 0.6);
				g.beginPath();
				g.arc(0, 0, R * rr, a0, a1);
				g.stroke();
			}
		}
		g.restore();
	}

	return {
		resize(view: View, s: Shared) {
			rebake(view, s);
			dust = [];
		},
		rebake,
		drawBg,
		draw,
	};
}

/** 事件视界半径：跟着视口走，但**永远留给法阵**（不许因此挡住整页）。 */
export function holeOf(s: Shared, view: View): Hole {
	// ⚠️ 0.062 在 1258×566 的视口上只有 35px —— "黑洞是视觉中心"当场落空，整页看起来是
	//    一颗远处的白点；后来提到 0.098（1440×900 上 R=88px），还是偏小。
	//    参考图上视界半径占画面宽度的 **0.147** —— 按短边换算是 0.13，1440×900 上 R≈117、
	//    直径 234px，这才是"视觉中心"。上限抬到 150，免得超宽屏上又缩回去。
	const r = clamp(
		Math.min(view.w, view.h) * (view.w < 760 ? 0.16 : 0.15),
		34,
		200,
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
