// 深空背景 + 黑洞本体。两张画布，一支模块。
//
//   背景层（低频）：星野 + 暗雾 + 星云**烘进一张离屏位图**，每帧只贴一次图（带一点点视差）。
//     星野每帧重抽样毫无意义 —— 它又不动，动的是视差。走马灯那一页的教训：把"不变的东西"
//     每帧重算，是白扔的预算。
//   黑洞层（持续但低负载）：绕洞的活丝（每帧、差速自转）→ 暖尘 → 暖晕 → 吸积盘三趟 →
//     盘上亮点 → 上下细弧 → 核心 → 爱因斯坦环 → 横穿那道线 → 引力波。
//
// 模块**只读**共享态：吸积盘自转相位、吞噬脉冲、指针靠近程度都在接线层推进。
//
// 🔴 **"看起来杂" = 无序，不是 "东西多"**（做完和参考图的同构图 A/B 才想明白的）：
//    参考图上洞口那一涡其实有**几十道丝**，比"乱"的那版还密；它不乱，是因为每根丝
//    **朝同一个方向卷**，整片读成一个漩涡。所以碰到"太杂"要砍的是**没有方向的东西**
//    （同心圆环、各歪各的短划），不是密度。密度不够，"空间被搅动"这件事根本立不起来。
//
// 🔴 **"烘"和"活"的分界线，是这一页最贵的一条经验**：
//    烘（`rebake`）只放**真的不动**的东西 —— 星野、星云、底色、几根当"直尺"用的尘埃纤维。
//    凡是要看出"在动"的（绕洞的丝、暖尘、雾、盘、弧），一律每帧画。
//    上一版把 300 条漩涡丝 + 18 道扫帚烘进了位图 —— 数量、配色、剖面对得上参考图，
//    但那一层**一条都不会动**，整页于是像一张壁纸。神：「没有动感，太死了」。
//    ⚠️ 烘死的还有第二个代价：烘一次要几百毫秒，想让它动就得每帧重烘 —— 更贵。
//    所以"想动"从设计上就要求它是活层，不是把烘的东西挪出来。
//
// 观感基准（神给的参考图，暖金路数）：白炽 → 米金 → 琥珀的一条**极薄**亮盘带，
// 视界正上方一圈亮环 + 几根细弧，四周是暖褐尘埃。曾经是青蓝紫 —— 那是另一套东西了。

import {
	BURST_DUR,
	clamp,
	collapseDark,
	collapseR,
	type Hole,
	rngOf,
	type Shared,
	smoothstep,
	type View,
} from "./state";

const TAU = Math.PI * 2;

/** 暗金（洞口符文那个色）。和吸积盘的暖金**不是**同一档：符文要偏绿偏沉，才不会跟盘糊在一起。 */
const RUNE = "216 174 100";

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

	/**
	 * 绕洞的**活丝**（每帧画，不是烘进背景）。
	 *
	 * 🔴 这是这一页"有没有动感"的全部来源，三个设计点缺一不可：
	 *   ① **半径存的是"真实"半径 `b`（单位 R），不是画到屏幕上的半径**。每帧用透镜方程
	 *      正解把它映射成视半径 `θ = (β + √(β² + 4θE²)) / 2` —— 于是 `b < 1R` 的丝
	 *      **一定**落在视界外（1R ~ 1.6R），物理上就是"洞口背后那片天被掰了出来"。
	 *      烘死那版做不到这件事：它只能靠位图重映射，而重映射的结果不会动。
	 *   ② **角位置按 `s.spin` 推，但每条的速率不同**（`rate ∝ 1/(1 + b)`，内快外慢）。
	 *      差速 = 剪切 = 整片丝read成**在流**，而不是一圈一起转的硬盘子。
	 *      ⚠️ 只跟 `s.spin` 走是**故意的**：`s.spin` 只增不减，所以相位永远不抖，
	 *      也不需要额外状态。旋转方向上吸积盘、暖尘、这些丝是一套。
	 *   ③ 数量降到几十条。第一版烘了 300 条 + 18 道扫帚，神的评价是「线条太杂了」——
	 *      动起来之后**每条都看得见**，所以条数只能比烘死那版更少。
	 */
	type Filament = {
		/** 真实半径（单位 R，未透镜） */
		b: number;
		/** 纵向压扁比 `ry / rx` */
		flat: number;
		/** 起始角（弧度） */
		a0: number;
		/** 弧长（弧度） */
		sweep: number;
		/** 轨道面倾角（弧度，逐道递增 → 不读成同心圆） */
		rot0: number;
		/** 线宽（单位 R） */
		w: number;
		/** 基础亮度 */
		alpha: number;
		warm: boolean;
		/** 角速度系数（差速） */
		rate: number;
	};
	let filament: Filament[] = [];

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
			grd.addColorStop(0, `rgb(${rgb.join(" ")} / 0.13)`);
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
		haze.addColorStop(0, "rgb(188 166 142 / 0.18)");
		haze.addColorStop(0.7, "rgb(188 166 142 / 0.155)");
		haze.addColorStop(1, "rgb(188 166 142 / 0)");
		g.fillStyle = haze;
		g.fillRect(-hz.r * 3.2, -hz.r * 3.2, hz.r * 6.4, hz.r * 6.4);
		g.restore();

		// 尘埃**纤维丝** —— 这是"空间被扭曲"能不能被**看出来**的关键。
		// 🔴 为什么非要它：星野是一堆互不相关的点，做径向重映射之后只是"点变密了"，
		//    看不出**空间**被掰过。只有**有方向、穿过整个画面的长条**才会：一条直线在
		//    接近洞口时被推着往外弯，整片背景于是绕着黑洞卷起来 —— 参考图那一圈缠上去
		//    的丝就是这件事。少了它，透镜只是个"更亮的环"，读不出引力。
		// ⚠️ 方向要**统一给一个轻微倾角**（像一条斜穿画面的星系尘埃带），不能全随机：
		//    方向各异的丝被掰弯了也读不出来，因为没有"原本是直的"这个参照。
		// ⚠️ 一条丝 = **一次 stroke 配一个线性渐变**。别拆成一段段画 —— 加色混合下
		//    相邻描边的圆头端点会互相叠加，整条丝变成一串珠子（这一版实测踩过）。
		// 🔴 **这一层是"参照网"，必须少**。它烘死在背景里（不动），负责提供"原本是直的"
		//    这话；真正动的是下面那个**活层**（`drawFilaments`）。第一版铺了 150 条、
		//    每条最长 450px，整屏都是斜线 —— 神的原话是「线条太杂了」。真实感来自
		//    "尘埃聚在洞口附近、外围是空的"，所以数量砍到 38，长度砍半，外围直接归零。
		const tilt = -0.22;
		const wisps = view.w < 760 ? 8 : 16;
		const span = Math.max(view.w, view.h);
		for (let i = 0; i < wisps; i++) {
			// 沿"带"铺：离带轴越远越稀（t² 分布），于是中间厚、两边散
			const t = (rand() - 0.5) * 2;
			const off = Math.sign(t) * t * t * span * 0.45;
			const along = rand() * (view.w + view.h) - view.w * 0.35;
			const bx = view.w * 0.5 + Math.cos(tilt) * along - Math.sin(tilt) * off;
			const by = view.h * 0.5 + Math.sin(tilt) * along + Math.cos(tilt) * off;
			const len = 60 + rand() * 200;
			const dir = tilt + (rand() - 0.5) * 0.55;
			const hx = (Math.cos(dir) * len) / 2;
			const hy = (Math.sin(dir) * len) / 2;
			// 一点点弧度：太直的丝看着像划痕，不像尘埃
			const bow = (rand() - 0.5) * len * 0.35;
			// ⚠️ **越靠画边越弱**。铺成一整片均匀的丝，整帧读起来像"拉丝金属"
			//    （这张图实测就是这样）—— 而且"杂"就是这么来的。1.05 起步意味着
			//    到 1.05×span 之外权重直接归零，画边是干净的。
			const far = Math.hypot(bx - hz.x, by - hz.y) / (span * 0.55);
			const near = clamp(1.05 - far, 0, 1);
			if (near <= 0) continue;
			const a = (0.05 + rand() * 0.1) * near;
			const warm = rand() > 0.28;
			const col = warm ? "180 142 102" : "132 144 172";
			const grd = g.createLinearGradient(bx - hx, by - hy, bx + hx, by + hy);
			grd.addColorStop(0, `rgb(${col} / 0)`);
			grd.addColorStop(0.5, `rgb(${col} / ${a})`);
			grd.addColorStop(1, `rgb(${col} / 0)`);
			g.lineCap = "round";
			g.strokeStyle = grd;
			g.lineWidth = 0.8 + rand() * 2.2;
			g.beginPath();
			g.moveTo(bx - hx, by - hy);
			g.quadraticCurveTo(
				bx + Math.cos(dir + Math.PI / 2) * bow,
				by + Math.sin(dir + Math.PI / 2) * bow,
				bx + hx,
				by + hy,
			);
			g.stroke();
		}

		// ⚠️ **绕洞的漩涡丝不在这里**（第一版有 300 条烘在这儿，加上 18 道大扫帚）。
		//    它们被搬去了 `drawFilaments()`，改成**每帧画**——因为烘死的丝**不会动**，
		//    而"会不会动"恰恰是这一页最缺的东西（神：「没有动感，太死了」）。
		//    搬走之后这里反而干净：烘的只剩"不动的参照"，动的一律每帧来。

		// ③ 弥散的尘埃斑块：给整片天一点大尺度的疏密。少了它，外围就是"贴了张黑纸"——
		//    参考图里离洞口 4~5R 的地方仍然有可读的暗尘纹理。
		//    ⚠️ alpha 只能给到 0.04~0.09：这是**底噪**，一擦亮就变成"土黄滤镜"，
		//       而且会被下面的透镜一起放大成一片糊。
		//    ⚠️ **撒在 2R 外的环带里**，别撒满全屏：撒满的结果是洞口周围糊了一圈脏，
		//       而它本来要解决的只是"外围太空"。判定用"到洞口的距离"而不是 `rand()*w`。
		const puffs = view.w < 760 ? 8 : 18;
		for (let i = 0; i < puffs; i++) {
			const pa = rand() * TAU;
			const pr = hz.r * (1.9 + 2.8 * rand());
			const px = hz.x + Math.cos(pa) * pr;
			const py = hz.y + Math.sin(pa) * pr * 0.75;
			const rad = 40 + rand() * 150;
			const warm = rand() > 0.3;
			const col = warm ? "152 118 86" : "98 110 140";
			const pg = g.createRadialGradient(px, py, 0, px, py, rad);
			pg.addColorStop(0, `rgb(${col} / ${0.035 + rand() * 0.045})`);
			pg.addColorStop(1, `rgb(${col} / 0)`);
			g.fillStyle = pg;
			g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
		}

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
		const thetaE = R * 1.0;
		// 影响半径之外原样不动：θE/θ 在 8R 处只剩 0.125R，再往外做纯浪费。
		// ⚠️ 边界上会留一道"位移跳变"（里侧被推出去、外侧没动）—— 所以窗口要开得比
		//    肉眼能分辨的位移更大。8R 时跳变 0.125R，配上下面的拖影，读不出来。
		const far = R * 8;
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
				// 切向拖影：切向放大率是 θ/β，越贴近爱因斯坦环越趋于无穷 ——
				// 一个点光源在那里会被拉成**一段弧**。nearest 采样本身就会把同一片
				// 源像素铺到一圈上，但窗外的源采不到、亮斑会断；这里沿切向多取两个样本
				// 取**最大值**，把那段弧接起来（取平均会把星点拉暗，反而不像）。
				// ⚠️ **幅度别贪**。第一版给到 0.09 rad，结果是整片星野被拉成**一地白色
				//    小划痕** —— 那不是"被掰弯的光"，那就是脏（神：「线条太杂了」）。
				//    0.035 只在贴着环的那一圈起作用，外面仍是"小而锐的点"。
				const mag = Math.min(3, d / Math.max(b, 1e-3)) - 1;
				const da = mag > 0.12 ? Math.min(0.035, mag * 0.02) : 0;
				const ox = cx - x0;
				const oy = cy - y0;
				const rx = x + dx * (k - 1) - ox;
				const ry = y + dy * (k - 1) - oy;
				// 小角近似代替 cos/sin：每帧上百万个像素，两次三角函数太贵
				const c1 = 1 - (da * da) / 2;
				let br = 0;
				let bg = 0;
				let bb = 0;
				let ba = 0;
				for (let s = -1; s <= 1; s++) {
					let tx = ox + rx;
					let ty = oy + ry;
					if (s !== 0 && da > 0) {
						const c = s * da;
						tx = ox + rx * c1 - ry * c;
						ty = oy + rx * c + ry * c1;
					}
					tx = Math.round(tx);
					ty = Math.round(ty);
					if (tx < 0 || ty < 0 || tx >= sw || ty >= sh) continue;
					const si = (ty * sw + tx) * 4;
					if (sp[si + 3] > ba) ba = sp[si + 3];
					if (sp[si] > br) br = sp[si];
					if (sp[si + 1] > bg) bg = sp[si + 1];
					if (sp[si + 2] > bb) bb = sp[si + 2];
				}
				if (ba === 0) continue;
				const di = (y * sw + x) * 4;
				op[di] = br;
				op[di + 1] = bg;
				op[di + 2] = bb;
				op[di + 3] = ba;
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

	/**
	 * 绕洞活丝层。**每帧画** —— 这是"动感"的唯一来源（见 `Filament` 的注释）。
	 *
	 * 每条丝 = **一次 `ellipse` 一笔画完**（`lineCap: "round"` 给两端收圆）。
	 * ⚠️ 别拆成小段配渐变 —— 加色混合下相邻段的端点会叠成一串珠子（尘埃纤维那层踩过）。
	 *    一个 path 只有两个端点，所以圆头在这里是安全的。
	 *
	 * 成本：桌面 260 条 × 1 次 `ellipse`。上一版是 96 条（还几乎看不见），背景里另有
	 * 300 条烘死的 —— 一起算，这一版比"烘死那版"少一个量级，而且**全都会动**。
	 */
	function drawFilaments(
		g: CanvasRenderingContext2D,
		s: Shared,
		hole: Hole,
		boost: number,
	) {
		if (filament.length === 0) return;
		const R = hole.r;
		// 透镜：θE = 1.0R，和烘制那趟的 `lensWarp` 取同一个值（两处必须一致，
		// 否则活丝会落在"被掰出来的那片天"之外，读成两套几何）
		const thetaE = R * 1.0;
		g.save();
		g.globalCompositeOperation = "lighter";
		for (const f of filament) {
			// ① 解析透镜：真实半径 → 视半径。β=0 时 θ=θE（刚好贴着视界外），
			//    β 大时 θ ≈ β + θE²/β，会轻微外推。
			const bR = f.b * R;
			const th = 0.5 * (bR + Math.sqrt(bR * bR + 4 * thetaE * thetaE));
			// ② 差速自转：内圈快、外圈慢。`s.spin` 只增不减，所以这条没有累积误差，
			//    也不需要给每条丝存相位。
			const ang = f.a0 + s.spin * f.rate;
			// ③ 越靠涡心越亮（那里的丝被压得最密），往外收
			const fade = clamp(1.5 - f.b / 2.6, 0.15, 0.92);
			// 上限 0.42 → 0.5：260 条叠起来才够"卷云"的厚度。单条仍压得很低，
			//    "亮"是**很多条加出来的**，不是单条给的 —— 单条给亮就成了划痕。
			g.globalAlpha = clamp(f.alpha * fade * boost, 0, 0.5);
			if (g.globalAlpha < 0.012) continue;
			// 暖金为主。冷蓝只当少数点缀 —— 冷暖各半时整圈会读成"灰白划痕"。
			g.strokeStyle = f.warm ? "rgb(212 158 96)" : "rgb(128 148 196)";
			// ⚠️ 一条丝 = **一次 `ellipse`**，而且 `lineCap` 用 `round`：
			//    同一个 path 只有**两个**端点，圆头不会在自己身上叠出珠子。
			//    （"珠子"只在把同一条弧拆成很多次 `stroke` 时才会出现。）
			//    圆头还顺手把丝的两端收圆 —— 硬头硬尾看着就是"划痕"。
			g.lineCap = "round";
			g.lineWidth = Math.max(0.6, R * f.w);
			g.beginPath();
			g.ellipse(hole.x, hole.y, th, th * f.flat, f.rot0, ang, ang + f.sweep);
			g.stroke();
		}
		g.restore();
	}

	/**
	 * 洞口的**暗金古符文**：一圈小折线，跟着盘慢慢转。
	 * 两处用：① 8 阶的**永久**符文环；② 坍缩脉冲峰值那一闪。
	 *
	 * 🔴 **`flat` 不能像盘那样压到 0.3**。视界是个**正圆**，而压扁的环在竖直方向的
	 *    半径只有 `rr·flat` —— 想让这圈符文**落在球外**，必须 `rr·flat > 1`。
	 *    按盘那种 0.32 压扁，`rr` 要 3.1R 以上才出得来，那已经不是"贴在洞口边缘"了。
	 *    所以这里给 0.72~0.78（略扁、基本是个圆），既兜得住整个视界，又不读成"行星环"
	 *    —— `rr·flat ≈ 1.1~1.2R`，正好压在爱因斯坦环外沿上：符文是"刻在那圈光上的"。
	 *
	 * 🔴 **所有符文塞进同一个 path，最后只 `stroke()` 一次**。逐颗 `stroke()` 会在
	 *    加色混合下把相接处叠成一串珠子（这一页在细弧上踩过一模一样的坑）；
	 *    代价是 `lineWidth` 只能整圈一个值 —— 在这层不需要粗细变化，正好。
	 */
	function drawRunes(
		g: CanvasRenderingContext2D,
		s: Shared,
		hole: Hole,
		alpha: number,
		rr: number,
		flat: number,
		count: number,
		dir: number,
	) {
		if (alpha < 0.02) return;
		const R = hole.r;
		g.save();
		g.globalCompositeOperation = "lighter";
		g.globalAlpha = clamp(alpha, 0, 0.7);
		g.strokeStyle = `rgb(${RUNE})`;
		g.lineCap = "round";
		g.lineWidth = Math.max(1, R * 0.017);
		g.beginPath();
		const rot = s.spin * dir;
		for (let i = 0; i < count; i++) {
			const a = rot + (i / count) * TAU;
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			// 局部 (u 沿径向, v 沿切向)，单位 R
			const at = (u: number, v: number) => {
				const lx = (rr + u) * ca - v * sa;
				const ly = (rr + u) * sa + v * ca;
				return [hole.x + lx * R, hole.y + ly * R * flat] as const;
			};
			// 每颗是一道径向 + 一道斜的小折线。斜的角度按 i 变 —— 整圈读成"一段铭文"，
			// 不是一圈规规矩矩的刻度（规整的刻度看着就是齿轮）。
			const sk = 0.04 + 0.05 * ((i * 7) % 5) * 0.25;
			const [ax, ay] = at(-0.09, 0);
			const [bx, by] = at(0.09, 0);
			const [cx2, cy2] = at(-0.05, -sk);
			const [dx2, dy2] = at(0.05, sk);
			g.moveTo(ax, ay);
			g.lineTo(bx, by);
			g.moveTo(cx2, cy2);
			g.lineTo(dx2, dy2);
		}
		g.stroke();
		g.restore();
	}

	/**
	 * 阶数带来的**盘结构**（spec §2.3）。**每加一样都要先问"它会不会读成环"** ——
	 * 这一页翻过的车全是"又加了一圈同心圆"。所以这里两条规矩：
	 *   ① 新加的东西一律**躺在盘面里**（`scale(1, k)` 压到 0.3 上下），或者干脆是**会动的亮点**；
	 *   ② 一律**一笔画完**（一个 path 一次 stroke/fill），不加逐段描边。
	 *
	 *   2 阶 · 荧动：外围一道细金属光环 + 4 颗绕盘光点
	 *   4 阶 · 曜变：**反向**绕行的冷色光点（"双层反向旋转"里反的那一层）+ 光点增至 8 颗
	 *   8 阶 · 归墟：再多一层更外的暖金光点（多层多色）+ 永久暗金符文环
	 */
	function drawStage(
		g: CanvasRenderingContext2D,
		s: Shared,
		hole: Hole,
		boost: number,
	) {
		const stage = s.stage;
		if (stage < 2) return;
		const R = hole.r;
		g.save();
		g.globalCompositeOperation = "lighter";

		// ① 细金属光环不在这里 —— 它属于**盘面**，必须在核心之前画（见 `drawDiskRim`）：
		//    压扁 0.32 的环在竖直方向只有 0.53R，那两段本来就该被视界吃掉。
		// ② 绕盘的光点。**数量就是吞噬计数**（spec §2.4：不许出现阿拉伯数字，
		//    用光点个数暗示）。⚠️ 压扁比给 **0.46**，不是盘的那种 0.3：
		//    竖直半轴 = `rad·flat`，要 ≥ 1R 才兜在球外；0.3 的话上下两颗跑到黑球里面，
		//    而那正是"数了几颗"的读数 —— 少两颗就把计数读错。一圈只 `fill()` 一次。
		const layers: readonly (readonly [number, number, number, string])[] = [
			// [颗数, 半径(R), 角速度系数(正负=方向), 颜色]
			// 🔴 颗数是 spec 点名的**读数**（§2.3）：2 阶 4 颗、4 阶 **8 颗**。
			//    不是 8+4=12 —— 多出来的那 4 颗会把"数光点"这件事读错（§2.4 全靠它）。
			//    "吸积盘双层反向旋转"于是由**同数的两层各转各的**表达：4 暖金顺行 +
			//    4 冷色逆行 = 8 颗、两个方向 —— 数得清，也看得出反向。
			[4, 2.36, 1.7, "255 236 196"],
			...(stage >= 4 ? ([[4, 2.24, -1.25, "150 214 255"]] as const) : []),
			...(stage >= 8 ? ([[6, 3.1, 0.9, "255 208 150"]] as const) : []),
		];
		g.save();
		g.translate(hole.x, hole.y);
		g.scale(1, 0.46);
		for (const [n, rad, spd, rgb] of layers) {
			g.fillStyle = `rgb(${rgb} / ${clamp(0.92 * boost, 0, 1)})`;
			g.beginPath();
			for (let i = 0; i < n; i++) {
				const a = s.spin * spd + (i / n) * TAU;
				g.moveTo(Math.cos(a) * R * rad + R * 0.031, Math.sin(a) * R * rad);
				g.arc(Math.cos(a) * R * rad, Math.sin(a) * R * rad, R * 0.031, 0, TAU);
			}
			g.fill();
		}
		g.restore();

		// ③ 8 阶：**永久**暗金符文环（spec §2.3 归墟）。4 阶不给 —— 那是"终极形态"的记号。
		//    `rr·flat ≈ 1.16R` → 刚好压在爱因斯坦环外沿，符文读成"刻在洞口那圈光上"。
		if (stage >= 8) drawRunes(g, s, hole, 0.26 * boost, 1.52, 0.76, 26, 0.18);
		g.restore();
	}

	/**
	 * 2 阶的**细金属光环**。⚠️ 必须与**远半盘**同一趟调用（核心**之前**）：
	 * 盘面里的东西绕到视界背后就该被挡掉，画在核心之后就变成"贴着黑球描的一条线"。
	 * 压扁 0.32 → 竖直半轴只有 0.53R，于是上下两段自然被球吃掉，左右两肩留在外面。
	 */
	function drawDiskRim(
		g: CanvasRenderingContext2D,
		s: Shared,
		hole: Hole,
		boost: number,
	) {
		if (s.stage < 2) return;
		const R = hole.r;
		g.save();
		g.globalCompositeOperation = "lighter";
		g.translate(hole.x, hole.y);
		g.scale(1, 0.32);
		g.strokeStyle = `rgb(198 208 228 / ${clamp(0.16 * boost, 0, 0.28)})`;
		g.lineWidth = Math.max(1, R * 0.016);
		g.beginPath();
		g.arc(0, 0, R * 1.66, 0, TAU);
		g.stroke();
		g.restore();
	}

	/**
	 * 8 阶专属「过载喷发」（spec §2.3 专属机制）：层数烧掉之前**反向**甩出去的一波金光与光纹。
	 * 🔴 整页只有这一处是"从洞里往外射" —— 别的全都在往里吸，所以它读起来是"过载"而不是
	 *    "换了个特效"。线宽/长度沿时间收细、变长，方向铺满一圈但**压在盘面里**。
	 */
	function drawBurst(g: CanvasRenderingContext2D, s: Shared, hole: Hole) {
		if (s.burst < 0) return;
		const u = clamp(s.burst / BURST_DUR, 0, 1);
		const R = hole.r;
		const reach = R * (1.3 + 3.4 * u);
		g.save();
		g.globalCompositeOperation = "lighter";
		g.globalAlpha = clamp((1 - u) ** 1.4 * 0.95, 0, 0.95);
		g.strokeStyle = `rgb(${GOLD[1].join(" ")})`;
		g.lineCap = "round";
		g.lineWidth = Math.max(1.4, R * 0.03 * (1 - u * 0.6));
		g.beginPath();
		const n = 18;
		for (let i = 0; i < n; i++) {
			const a = (i / n) * TAU + 0.35;
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			// 🔴 起点走**正圆**（1.08R，一定在视界外），远端才压扁 0.45。
			//    反过来写（两端都压扁 0.3）的话，竖直方向那些光纹的起点会落进黑球里 ——
			//    等于在纯黑的球面上划了几道金线，读起来是"划痕"不是"喷发"。
			g.moveTo(hole.x + ca * R * 1.08, hole.y + sa * R * 1.08);
			g.lineTo(hole.x + ca * reach, hole.y + sa * reach * 0.45);
		}
		g.stroke();
		g.restore();
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

		// 这三条前面好几个层都要用（活丝层、盘、环、弧），所以提到最前面。
		// 🔴 觉醒阶数就乘在**这两个 boost** 上，不另开一条"阶数分支"去各画各的：
		//    盘、环、弧、活丝本来就都读它们，于是"提升亮度 / 增强引力透镜"这两条
		//    spec 要求会自动落到每一个该亮的地方（改一处，六层一起变）。
		const diskBoost = (1 + 0.35 * s.pulse) * (s.stage >= 2 ? 1.3 : 1);
		// 透镜那一套（爱因斯坦环 + 细弧 + 活丝）整体提一档：吞噬时"光被掰得更狠"。
		// ⚠️ 坍缩脉冲的亮度包络只乘在这里 —— 盘那一路要留着（见 `collapseDark`）。
		const lensBoost =
			(1 + 0.5 * s.pulse) *
			collapseDark(s.collapse) *
			(s.stage >= 4 ? 1.25 : 1);
		/** 弧线的颜色。暖金第二档（米金），和盘体同一根色轴。 */
		const ARC = `rgb(${GOLD[1].join(" ")})`;

		// 暖尘池：**按 8 阶（最满）那一档一次抽满**，每帧只画前 `dustN` 条。
		//    ⚠️ 别按阶数改数组长度 —— 那会每进一阶重抽一次，而重抽的瞬间整片尘埃
		//    会原地换位置（一眼就看出是"重新生成"）。画前面一段就没有这个问题。
		if (dust.length === 0) {
			const rand = rngOf(4242);
			for (let i = 0; i < (view.w < 760 ? 64 : 124); i++) {
				dust.push({
					a: rand() * TAU,
					r: R * (1.6 + rand() * 2.8),
					sp: (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.1),
					fall: R * (0.05 + rand() * 0.16),
					size: 0.6 + rand() * 1.5,
				});
			}
		}
		/** 这一阶真正画几条：1 阶 45% → 2 阶 60% → 4 阶 75% → 8 阶全满。 */
		const dustN = Math.round(
			dust.length *
				(s.stage >= 8 ? 1 : s.stage >= 4 ? 0.75 : s.stage >= 2 ? 0.6 : 0.45),
		);

		// 活丝：只在第一次（以及窗口尺寸变了之后）展开一次，之后**每帧重画同一份**。
		// ⚠️ 半径一律存"真实半径 b"（单位 R），所以重展开只跟数量有关、跟分辨率无关。
		if (filament.length === 0) {
			const rand = rngOf(20261004 ^ 0x5eed);
			// 🔴 **"杂"是"无序"，不是"多"** —— 这是做完 A/B 才想明白的一条。
			//    参考图上洞口周围那一圈其实是**密密麻麻几十道丝**，比第一版还密；
			//    它之所以不乱，是因为**所有丝朝同一个方向卷**，整片读成"一个漩涡"。
			//    反过来，稀疏的孤立短弧（我中途那版）才是真的乱：没有方向，看着像划痕。
			//    所以这里的密度给回来，靠下面那条**同号的扭转**去保证"有序"。
			// ⚠️ 密度是**最后一档才给够**的：170 条时 A/B 里我这版明显比参考图"薄"，
			//    参考图洞口上下那两片是被梳过去的**厚卷云**，不是几缕丝。260 条才立得住"体积"。
			const n = view.w < 760 ? 110 : 260;
			for (let i = 0; i < n; i++) {
				const u = rand();
				// `u^1.6`：越靠洞口越密（涡心那一圈最亮最挤），往外逐渐稀疏。
				const b = 0.14 + 3.0 * u ** 1.6;
				const big = rand() > 0.9;
				filament.push({
					b,
					// 🔴 **扁，但别太扁**。参考图上那一涡是"宽 > 高"的 —— 顺着盘面被梳过去，
					//    不是个圆环。但给到 0.24 那种极扁值时，丝全挤在盘面上下一条带里，
					//    洞口上下是空的、读成"赤道上的沙尘暴"；参考图那圈是**兜住整个洞口**的。
					//    0.32~0.58 才既保持"宽 > 高"，又能把视界上下一起裹住。
					//    ⚠️ 而一旦逼近 0.8 就转圆，整片立刻读成"行星环"（试过，翻车）。
					flat: 0.32 + rand() * 0.26,
					a0: rand() * TAU,
					// 弧要**长**：涡是"一条条扫过半圈的痕"连起来的，短弧看着是碎屑。
					// ⚠️ 但长弧必须**很多根叠着**才成涡；一根长的就是一圈环（试过，翻车）。
					sweep: 0.5 + rand() * 1.5,
					// 🔴 **同号、随半径单调增加的扭转** —— "整片读成一个涡"靠这一条。
					//    ⚠️ 系数别大：试过 `b*0.42`，所有长轴被扭进同一个 ~70° 扇区，
					//    结果涡只出现在左上-右下一条斜带上，另外两个象限是空的（渲染图看得很清楚）。
					//    0.16 够给出"越往外越扭"的方向感，抖动则把方向铺满整圈。
					rot0: b * 0.16 + (rand() - 0.5) * 0.42,
					// 绝大多数是细丝，少数几道当骨架
					// ⚠️ 骨架别太粗：0.062R 那种会读成一根**笔触/绸带**（加色下还糊成一块平色），
					//    参考图那一涡是"**一片细密平行痕里夹几道亮些的**"，不是几十根粗带子。
					w: big ? 0.02 + rand() * 0.024 : 0.006 + rand() * 0.012,
					alpha: big ? 0.13 + rand() * 0.09 : 0.05 + rand() * 0.1,
					warm: rand() > 0.2,
					// 差速：内圈 ~2.1×、外圈 ~0.6×（相对吸积盘的名义转速）
					rate: 2.6 / (1 + b * 1.1),
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

		// ①b 绕洞活丝。**放在暖尘之前**：它是"被掰弯的天"，比落进去的尘埃更远。
		drawFilaments(g, s, hole, lensBoost);

		// ② 暖尘：**持续往视界里掉**。这是"光/物质被吸进去"最直白的读数 ——
		//    指针一靠近，掉得更快（spec §二 黑洞基础交互）；落到 `R*1.02` 就回收重放到外圈。
		//    ⚠️ 别改成"绕圈打转"：原地转读不出引力，只有确确实实在往里掉才算数。
		g.save();
		g.globalCompositeOperation = "lighter";
		// 8 阶：背景星尘"持续向中心汇聚"（spec §2.3）—— 直接把它读成**掉得更快**，
		// 而不是另铺一层星野。密度的差已经由 `dustN` 给了，这里只给速度。
		const conv = s.stage >= 8 ? 1.55 : 1;
		for (let di = 0; di < dustN; di++) {
			const d = dust[di];
			if (!d) continue;
			const pull = (1 + s.hover * 2.2) * conv;
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
			// 🔴 **画成一条短线，不是一个点**。一颗粒子每帧只走 1~2px，画成圆点看不出
			//    它在动；拉成它**自己运动方向**上的一小段，就成了运动模糊 —— 静止的
			//    一帧里也读得出"它在往洞里掉"。拖影长度按**固定时间 τ** 算（不是按 dt），
			//    否则 24fps 的静止档会只剩半截尾巴，动一下就变长，像在闪。
			const tau = 0.13;
			const backA =
				d.a -
				(d.sp * (1 + s.hover * 1.5) + (d.fall / Math.max(d.r, 1)) * 0.4) *
					calm *
					tau;
			const backR = d.r + d.fall * pull * calm * tau;
			const bx = hole.x + Math.cos(backA) * backR;
			const by = hole.y + Math.sin(backA) * backR * KD;
			g.globalAlpha =
				(0.15 + 0.16 * Math.sin(t * 1.4 + d.a)) * (1 + s.hover * 0.35);
			g.strokeStyle = "#ffd9a0";
			g.lineCap = "round";
			g.lineWidth = d.size * 1.5;
			g.beginPath();
			g.moveTo(bx, by);
			g.lineTo(x, y);
			g.stroke();
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

		// ③ 吸积盘远半（压在核心**下面**）：它绕到视界背后，被黑球吃掉大半，
		//    只剩外侧两肩露出来 —— 参考图上赤道左右那两片最亮的地方就是它。
		g.save();
		g.globalCompositeOperation = "lighter";
		// 两趟：**宽而暗的一层先铺（焦距附近的 flare）**，**细而亮的那根后画（光束）**。
		// 参考图就是"一根细亮线泡在一片宽光里"；顺序反了针会被晕糊掉一层。
		drawDisk(g, hole, KD * 3.2, false, diskBoost * 0.34, "all", 3);
		drawDisk(g, hole, KD, false, diskBoost);
		drawDiskRim(g, s, hole, diskBoost);
		g.restore();

		// ④ 引力透镜（一）：**上下两组细弧** —— 盘的后半被引力抬到视界上方/下方的二次像。
		//    参考图上视界正上方那几根平行的细弧就是它，也是整页"引力"味道最重的一笔。
		//    ⚠️ 每段强度按 `sin(φ)^P` 收到 0 —— 直接画半圆会在两端留下一道硬切口，
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
		// 🔴 **从 5+5 砍到 2+2，再砍到 1+1**。上一版十道同心的椭圆叠在洞口外，量出来的
		//    数是对上了，但读出来是**靶子** —— 神的原话是「黑洞周围的线条太杂了」。
		//    砍到 2+2 之后还剩最后一道"行星环"：最外那道（2.2R / 2.5R）几乎是个**正圆**，
		//    孤零零画在空旷的天上，一整圈绕过去 —— 和"盘被抬起来的二次像"没关系了，
		//    就是一枚环。参考图在那个位置本来就极淡（85~110，全图最暗的一档），
		//    所以直接删掉，那片交给**会动的活丝**去给（见 `drawFilaments`）。
		//    现在每侧只剩**贴洞口那一根**：它压在爱因斯坦环的外沿上，读成"盘的内缘
		//    绕过来"，这才是"二次像"该在的位置。
		//  · **两个半轴分开给**（纵向更小）让它们读成"趴下来的弓"，不是一圈圈同心圆。
		const BANDS: readonly (readonly [
			number,
			number,
			number,
			number,
			number,
		])[][] = [
			// 下方（屏幕 y 向下就是它）
			[[1.32, 1.15, 0.05, 0.6, 0]],
			// 上方
			[[1.28, 1.12, 0.06, 0.58, 0]],
		];
		// 整组弧**随盘子慢慢转**：它们是"盘的后半被抬起来的二次像"，盘的相位变了，
		// 这个像自然也得跟着挪 —— 静止的几道椭圆是这一页看起来"死"的另一个原因。
		// 系数 0.12 远小于盘本身的 1.0：二次像在远处，视觉位移本来就该小。
		const bandSpin = s.spin * 0.12;
		for (const dir of [-1, 1]) {
			// ⚠️ 强弱的配比是量出来的，别凭手感：第一版给成 0.5/0.3/0.17，量出来是
			//    77/39/26 —— 四道几乎一样亮，读起来像**同心圆测试卡**，不像被掰弯的光。
			//    后来收敛成"一把粗细各异、越往外越弱的细丝"，参考图那些弧线更像**毛笔
			//    扫过去的痕**，所以还让线宽跟着 `fade` 走（两端收细、中段最粗）。
			for (const [rx, ry, wd, a, rot] of BANDS[dir > 0 ? 0 : 1]) {
				const steps = 96;
				// 🔴 指数不能小。线宽**只**随 `fade` 收（alpha 恒定），所以 `fade` 一摊平，
				//    整条弧就一路铺到水平线，一"扇"叠起来又变成靶子（放大看过）。6.5 让
				//    可见段落在 apex 两侧 ±45° 内，读成"一道扫过去的痕"。
				const P = 6.5;
				// 🔴 **alpha 整条恒定，粗细交给 `fade`**。逐段改 alpha 在这里是错的：
				//    画布是 `lighter`，相邻两段在接缝处重叠 —— alpha 一累加，整条弧就变成
				//    一串**珠子**（这一版实测就是这样，放大看得清清楚楚）。
				//    视觉上的"淡"要由**面积**给（两端收细到 0），不由 alpha 给。
				// ⚠️ 端点必须 `butt`。圆头会往两端各伸半个线宽，重叠区被加两遍 → 还是珠子。
				g.globalAlpha = clamp(a * lensBoost, 0, 0.8);
				g.lineCap = "butt";
				for (let i = 0; i < steps; i++) {
					const ph0 = (i / steps) * Math.PI;
					const ph1 = ((i + 1) / steps) * Math.PI;
					const fade = Math.sin((ph0 + ph1) / 2) ** P;
					const lw = R * wd * 1.7 * fade;
					if (lw < 0.6) continue; // 细到看不见就不画，省得留一道毛边
					g.lineWidth = lw;
					g.beginPath();
					// dir>0 画下半圈（屏幕 y 向下，0→π 正好扫过下方）
					g.ellipse(
						hole.x,
						hole.y,
						R * rx,
						R * ry,
						rot + bandSpin,
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
		// 🔴 **这一层必须浅、必须窄**。三张图叠在一起（halo + ring + ring2）在 `lighter`
		//    下是加法：第一版 halo 给到 0.26、ring 峰 0.8、ring2 0.34，加起来渲染出来是
		//    **一圈实心奶油甜甜圈** —— 洞口被糊成一坨，四周那些丝全成了"糊在奶油上的划痕"。
		//    现在三张各自减半，亮的那条留给 ring 一个人。
		// ⚠️ 必须挖掉中心 —— createRadialGradient 在 r < r0 的区域照样用 0 号色标涂满，
		//    不挖就会给纯黑的核心糊上一层暖光，黑球变褐色。
		const halo = g.createRadialGradient(
			hole.x,
			hole.y,
			R,
			hole.x,
			hole.y,
			R * 1.2,
		);
		halo.addColorStop(
			0,
			`rgb(${GOLD[1].join(" ")} / ${clamp(0.15 * lensBoost, 0, 0.2)})`,
		);
		halo.addColorStop(
			0.5,
			`rgb(${GOLD[2].join(" ")} / ${clamp(0.06 * lensBoost, 0, 0.1)})`,
		);
		halo.addColorStop(1, `rgb(${GOLD[2].join(" ")} / 0)`);
		g.fillStyle = halo;
		g.beginPath();
		g.arc(hole.x, hole.y, R * 1.2, 0, TAU);
		g.arc(hole.x, hole.y, R * 0.985, 0, TAU, true);
		g.fill();
		// 环本体。🔴 **用径向渐变填充的一个圆环，不是"粗描边的一圈线"**。
		//    描边那条路实测有两个后果：① 圆头端点在加色混合下互相叠加 → 环上一串珠子；
		//    ② 环厚给到 0.13R 时几何重叠把 alpha 堆到饱和 → 一圈**硬边白箍**，一眼假。
		//    径向渐变是连续的，厚薄亮暗全由色标说了算。
		// 色标对着参考图量出来的形状：内缘 ~0.98R 起，峰在 1.08~1.10R（亮度 230~240），
		// **1.25R 之后必须收干净** —— 参考图 1.35R 处只有 45~100，是一道**暗缝**。
		// ⚠️ 上一版把外沿铺到 1.44R，于是 1.3R 附近还挂着 0.14 的亮 —— 那道"暗缝"
		//    被填平了，环就从"一道亮边"变成"一圈厚箍"。现在外沿收到 1.30R。
		// `r0 = 0.94R` 顺带把视界里面留空 —— r < r0 的区域用 0 号色标（alpha 0）。
		const ring = g.createRadialGradient(
			hole.x,
			hole.y,
			R * 0.94,
			hole.x,
			hole.y,
			R * 1.3,
		);
		ring.addColorStop(0, `rgb(${GOLD[2].join(" ")} / 0)`);
		ring.addColorStop(
			0.17,
			`rgb(${GOLD[1].join(" ")} / ${clamp(0.22 * lensBoost, 0, 0.3)})`,
		);
		ring.addColorStop(
			0.44,
			`rgb(${GOLD[0].join(" ")} / ${clamp(0.62 * lensBoost, 0, 0.75)})`,
		);
		ring.addColorStop(
			0.72,
			`rgb(${GOLD[1].join(" ")} / ${clamp(0.26 * lensBoost, 0, 0.34)})`,
		);
		ring.addColorStop(1, `rgb(${GOLD[2].join(" ")} / 0)`);
		g.fillStyle = ring;
		g.beginPath();
		g.arc(hole.x, hole.y, R * 1.3, 0, TAU);
		g.fill();
		// 下缘更厚更亮（盘在下面那一侧绕过来的光更多）：再叠一层**偏下**的柔环。
		// 参考图的下方 0.95~1.25R 都是亮的（150~230），上方只有 1.05~1.18R 一段。
		g.save();
		g.translate(hole.x, hole.y + R * 0.1);
		const ring2 = g.createRadialGradient(0, 0, R * 0.95, 0, 0, R * 1.22);
		ring2.addColorStop(0, `rgb(${GOLD[2].join(" ")} / 0)`);
		ring2.addColorStop(
			0.45,
			`rgb(${GOLD[1].join(" ")} / ${clamp(0.22 * lensBoost, 0, 0.3)})`,
		);
		ring2.addColorStop(1, `rgb(${GOLD[3].join(" ")} / 0)`);
		g.fillStyle = ring2;
		g.beginPath();
		g.arc(0, 0, R * 1.22, 0, TAU);
		g.fill();
		g.restore();
		g.restore();

		// ⑦ 吸积盘近半（压在核心**上面**）：盘从黑洞前面横过去 —— 这一趟不能省，
		//    省了就只剩"左右两片翅膀"（盘是压扁的椭圆、视界是正圆，上半圈本来就在球后面）。
		//    ⚠️ **只画球外那两段**（`zone: "out"`）。一开始让它整张铺过去，结果球内那一段
		//      铺成一块 `0.09R~0.3R` 厚、带硬边的亮板 —— 黑球下半截直接变成"一块盘子"，
		//      而且板子的上下边都是硬的（赤道一条、渐变尾部一条），非常假。
		//      参考图里穿过视界的只有**一根头发丝**，所以那根单独画（见 ⑧）。
		g.save();
		g.globalCompositeOperation = "lighter";
		drawDisk(g, hole, KD * 3.2, true, diskBoost * 0.34, "out", 3);
		drawDisk(g, hole, KD, true, diskBoost, "out");
		g.restore();

		// ⑦b 盘上的**几团亮点**：它们绕着盘跑，是"盘在转"的读数。
		//     🔴 这里**不能再画环**（上一版在盘上铺了两圈 72 段的弧，读成行星环，
		//     是"线条太杂"的头号来源，而且每帧 576 笔）。斑块的笔画数是 4，还能真的动。
		//     ⚠️ 画在近半之后、且**不挖球内**：它们都在 1.4R 外，本来就挨不到视界。
		g.save();
		g.globalCompositeOperation = "lighter";
		g.translate(hole.x, hole.y);
		g.scale(1, KD);
		for (let i = 0; i < 4; i++) {
			// 速率略大于盘本身（1.15×）：盘面物质的角速度本来就不是刚体
			const ph = s.spin * 1.15 + (i * TAU) / 4 + 0.35;
			const rad = R * (1.45 + 0.4 * (0.5 + 0.5 * Math.sin(i * 2.3)));
			const sx = Math.cos(ph) * rad;
			const sy = Math.sin(ph) * rad;
			const br = R * (0.2 + 0.06 * (i % 2));
			const blob = g.createRadialGradient(sx, sy, 0, sx, sy, br);
			blob.addColorStop(
				0,
				`rgb(255 244 214 / ${clamp(0.22 * diskBoost, 0, 0.3)})`,
			);
			blob.addColorStop(
				0.5,
				`rgb(255 226 176 / ${clamp(0.1 * diskBoost, 0, 0.14)})`,
			);
			blob.addColorStop(1, "rgb(214 152 72 / 0)");
			g.fillStyle = blob;
			g.beginPath();
			g.arc(sx, sy, br, 0, TAU);
			g.fill();
		}
		g.restore();

		// ⑧ 横穿视界的那道细线：盘的内缘在视界前面掠过去。
		//    单独画一条直线，**不要**拿近半那趟去铺 —— 盘的厚度由 `KD` 定，铺出来必然是一块板，
		//    而这里要的是"一根线"。
		//    量出来的：它**只有 2~4px**，但很亮（中心 190，越往右越亮到 255）—— 盘朝着我们
		//    这一侧（右边）多普勒增亮。所以是**沿 x 的线性渐变**，不是一根均匀的线。
		g.save();
		g.globalCompositeOperation = "lighter";
		const lineG = g.createLinearGradient(
			hole.x - R * 1.06,
			hole.y,
			hole.x + R * 1.06,
			hole.y,
		);
		lineG.addColorStop(
			0,
			`rgb(255 190 140 / ${clamp(0.3 * diskBoost, 0, 0.4)})`,
		);
		lineG.addColorStop(
			0.5,
			`rgb(255 214 170 / ${clamp(0.62 * diskBoost, 0, 0.75)})`,
		);
		lineG.addColorStop(
			1,
			`rgb(255 246 226 / ${clamp(0.96 * diskBoost, 0, 1)})`,
		);
		g.strokeStyle = lineG;
		g.lineWidth = Math.max(1.4, R * 0.034);
		g.beginPath();
		g.moveTo(hole.x - R * 1.07, hole.y);
		g.lineTo(hole.x + R * 1.07, hole.y);
		g.stroke();
		g.restore();

		// ⑦c 觉醒形态带来的盘结构（金属环 / 绕盘光点 / 永久符文环）。见 `drawStage`。
		drawStage(g, s, hole, diskBoost);

		// ⑦d 坍缩脉冲的暗金符文：**只在中段闪一下**（收缩期还没有它，回弹时才浮现）。
		if (s.collapse >= 0) {
			const c = s.collapse;
			const ra =
				smoothstep((c - 0.16) / 0.16) * (1 - smoothstep((c - 0.55) / 0.6));
			drawRunes(g, s, hole, ra * 0.6, 1.34, 0.8, 20, -0.9);
		}

		// ⑦e 8 阶过载喷发：唯一一处"往外射"的东西。
		drawBurst(g, s, hole);

		// ⑧ 吞噬反馈的引力波：一圈暖金往外扩。
		//    视界脉冲触发时它更强也更粗 —— 那是"强力引力波"，和吞噬一座法阵不是一回事。
		if (s.wave >= 0) {
			const u = clamp(s.wave / 1.5, 0, 1);
			const strong = s.collapse >= 0;
			// 阶数越高，吞噬那一圈扩得越远、越亮（spec §2.3 荧动"吞噬脉冲范围更大"）。
			const wide = s.stage >= 4 ? 1.25 : s.stage >= 2 ? 1.12 : 1;
			const rr =
				R * 1.1 + u * Math.min(view.w, view.h) * (strong ? 0.62 : 0.42) * wide;
			g.save();
			g.globalCompositeOperation = "lighter";
			g.globalAlpha = (1 - u) * (strong ? 0.34 : 0.17);
			g.strokeStyle = ARC;
			g.lineWidth = 1 + (1 - u) * (strong ? 5 : 2);
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
	 *   ⑤ **盘体自己不带任何"环"**。"盘在转"这件事由 `draw()` 的 ⑦b（几团绕着盘跑的
	 *      亮点）负责 —— 在盘上补一圈圈亮度结，画出来一定是两条细椭圆，读成行星环。
	 */
	function drawDisk(
		g: CanvasRenderingContext2D,
		hole: Hole,
		k: number,
		near: boolean,
		boost: number,
		/** 只要球外那两段（`out`）、只要穿过球的那一段（`in`）、还是整张（`all`） */
		zone: "all" | "in" | "out" = "all",
		/** 盘体铺到几个 R（宽的那趟是焦距附近的 flare，短；细的那趟要伸出画外） */
		reach = 8.5,
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
		// ⚠️ 填充必须**挖掉中心**：canvas 的 createRadialGradient 在 r < r0 的区域照样用
		//    0 号色标涂满 —— 不挖的话，近半那趟会在黑球下半部糊上一块平的亮板
		//    （实测就是这个症状：黑球下半截变成一块不透明的盘子）。
		// ⚠️ 外缘按**视口**给（`reach`），不按 R。黑洞现在小了（R≈94），4.6R 只有 435px，
		//    光束还没走到画边就收成一个尖 —— 一眼看得出是"画出来的东西"。参考图那条光束
		//    是从画面一边穿到另一边的。所以细的那趟铺到 8.5R，宽的那趟（=焦距附近的flare）
		//    留在 3R。
		const H1 = "255 252 240";
		const H2 = "253 246 224";
		const H3 = "232 206 172";
		const H4 = "199 165 131";
		const H5 = "120 96 78";
		const body = g.createRadialGradient(0, 0, R * 1.02, 0, 0, R * reach);
		body.addColorStop(0, `rgb(${H1} / ${clamp(0.75 * boost, 0, 0.85)})`);
		body.addColorStop(0.01, `rgb(${H2} / ${clamp(0.96 * boost, 0, 1)})`);
		body.addColorStop(0.055, `rgb(${H1} / ${clamp(1 * boost, 0, 1)})`);
		body.addColorStop(0.11, `rgb(${H2} / ${clamp(0.98 * boost, 0, 1)})`);
		body.addColorStop(0.17, `rgb(${H3} / ${clamp(0.9 * boost, 0, 1)})`);
		body.addColorStop(0.265, `rgb(${H3} / ${clamp(0.82 * boost, 0, 0.95)})`);
		body.addColorStop(0.4, `rgb(${H3} / ${clamp(0.62 * boost, 0, 0.75)})`);
		body.addColorStop(0.55, `rgb(${H4} / ${clamp(0.44 * boost, 0, 0.55)})`);
		body.addColorStop(0.72, `rgb(${H4} / ${clamp(0.28 * boost, 0, 0.36)})`);
		body.addColorStop(0.88, `rgb(${H4} / ${clamp(0.14 * boost, 0, 0.2)})`);
		body.addColorStop(1, `rgb(${H5} / 0)`);
		g.fillStyle = body;
		g.beginPath();
		g.arc(0, 0, R * reach, 0, TAU);
		g.arc(0, 0, R * 1.02, 0, TAU, true); // 反向 → 中间挖空
		g.fill();

		// 🔴 这里原来有"两圈亮度的结"：在 1.72R 与 2.62R 上各画一圈 **72 段的弧**，
		//    亮度沿角度起伏。量出来没问题，但**画出来是两条完整的细椭圆** ——
		//    绕在洞口外像行星环 / 靶环，正是神说的「黑洞周围的线条太杂了」的头号来源。
		//    而且它是每帧最大的一笔开销：2 圈 × 72 段 × 4 趟 = **576 次 stroke**。
		//    现在整块删掉，"盘在转"这件事改由 `draw()` 里几团**绕着盘跑的亮点**来给
		//    （不是线，是斑：更少的笔画 + 真的在动）。见 ⑦b。
		g.restore();
	}

	return {
		resize(view: View, s: Shared) {
			rebake(view, s);
			dust = [];
			filament = [];
		},
		rebake,
		drawBg,
		draw,
	};
}

/** 事件视界半径：跟着视口走，但**永远留给法阵**（不许因此挡住整页）。 */
export function holeOf(s: Shared, view: View): Hole {
	// 参考图上视界半径占画面宽度的 0.147 —— 但那是**竖幅壁纸**（球在画面正中、占了
	// 整张图的宽度）。搬到 16:10 的网页上按短边取 0.15 就太大了：1440×900 上 R=135、
	// 直径 270px，黑洞把整页的视觉重心全吃掉，法阵没处放。
	// 按短边 0.105（1440×900 → R=94.5、直径 189px）：仍然是视觉中心，
	// 但四周留得下法阵、星野和尘埃，读起来才是"太空里的一个天体"。
	//
	// 🔴 这个 94.5 现在是 **8 阶（归墟）**的尺寸。神的要求是「黑洞初始时小一点，
	//    最大也就目前大小」—— 所以 1 阶乘 0.76（≈72px），一路长到 8 阶才回到 94.5。
	//    用的是 `s.rScale`（阶数系数的**平滑跟随值**，见 state.ts）而**不是** `STAGE_R[s.stage]`：
	//    spec §2.4 要求换阶有过渡，直接读表会让半径在吞下第 4 座的那一帧跳 6%。
	//    ⚠️ 半径调制（阶数 + 坍缩）都只在这里做一次：命中判定、法阵生成、四层绘制
	//    全部走 `holeOf`，于是"缩进去的时候点不到洞口""碎片穿进了球里"这类错位
	//    从设计上就不存在。
	const base = clamp(
		Math.min(view.w, view.h) * (view.w < 760 ? 0.115 : 0.105),
		26,
		150,
	);
	const r = base * s.rScale * collapseR(s.collapse);
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
