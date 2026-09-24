// 「丝缕」的共用核心 —— A / B / C 三面 + 枢纽首页那层流动底纹，走的都是这一份。
//
// 职责只有三件：
//   1. 取色（HSL：高饱和高明度，丝缕才有发光感）
//   2. 对称变换（三种模式，坐标先转成「以画布中心为原点」的局部坐标再变）
//   3. 把一串采样点画成一条丝缕 —— **几何只有一份，风格分三档挂上去**
//
// B（像素）和 C（赛博）按 spec 是「完全复用对称算法、只改渲染层」，
// 所以这里刻意把「几何」和「上色/描边」分开：换风格不会碰到对称逻辑。
//
// ⚠️ 混合模式用 "lighter"，但**画布本身必须是透明的、白底来自 CSS**：
//   在不透明白底上画 "lighter"，颜色会被一路加到白 —— 等于什么都画不出来。
//   原站就是这么做的（透明 canvas 累积 + 页面白底）。
// ⚠️ 不用 shadowBlur 做发光：几千条线段上开阴影会直接掉帧，原站也不这么做。

export type SymmetryMode = "none" | "mirror" | "spiral";

/** 渲染风格：丝缕 / 像素 / 赛博。对称与历史逻辑三者完全共用 */
export type PaintKind = "silk" | "pixel" | "cyber";

/** 下拉菜单用；顺序就是菜单顺序 */
export const SYMMETRY_ORDER: SymmetryMode[] = ["none", "mirror", "spiral"];

export const SYMMETRY_LABEL: Record<SymmetryMode, string> = {
	none: "无旋转对称",
	mirror: "中心镜像",
	spiral: "向心螺旋",
};

export const DEFAULT_SYMMETRY_COUNT = 6; // 原站默认 6 份
export const MIN_SYMMETRY_COUNT = 2;
export const MAX_SYMMETRY_COUNT = 12;

/** 螺旋模式每复制一份就往里收一点。0.94 是「看得出来、又不打结」的值 */
const SPIRAL_FALLOFF = 0.94;

/** 单根丝缕的基准透明度；原站在 0.15~0.25 之间，取中 */
export const STROKE_ALPHA = 0.2;

/** 丝缕的饱和度/亮度：高饱和高明度才有霓虹感 */
const SAT = 88;
const LIGHT = 62;

export function hsla(h: number, s: number, l: number, a: number): string {
	return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function norm360(h: number): number {
	return ((h % 360) + 360) % 360;
}

/** 一份拷贝的变换参数：绕中心旋转 a 弧度、半径乘 k、水平镜像 m（-1 为镜像） */
export type Copy = { a: number; k: number; m: number };

/** 当前设置下总共有几条线（none=1 / mirror=2N / spiral=N） */
export function copyCount(mode: SymmetryMode, count: number): number {
	if (mode === "none") return 1;
	if (mode === "mirror") return count * 2;
	return count;
}

/**
 * 第 i 份拷贝的变换。
 *
 * - none   ：只有一份，原样
 * - mirror ：每份都成对出现 —— 一份原样、一份水平镜像（m=-1），再整体按份数均分旋转
 * - spiral ：每份均分旋转，同时半径按 k^i 往中心收，于是线条向内收敛成螺旋
 */
export function copyTransform(
	mode: SymmetryMode,
	count: number,
	i: number,
): Copy {
	if (mode === "none") return { a: 0, k: 1, m: 1 };
	if (mode === "mirror") {
		// i 是「第几条线」：偶数取原样、奇数取镜像，两者共用同一个旋转角
		return {
			a: (Math.floor(i / 2) * Math.PI * 2) / count,
			k: 1,
			m: i % 2 === 0 ? 1 : -1,
		};
	}
	return {
		a: (i * Math.PI * 2) / count,
		k: SPIRAL_FALLOFF ** i,
		m: 1,
	};
}

/** 把局部坐标 (dx,dy) 按一份拷贝变换后写进 out */
export function applyCopy(
	dx: number,
	dy: number,
	t: Copy,
	out: number[],
): void {
	const x = dx * t.m;
	const c = Math.cos(t.a);
	const s = Math.sin(t.a);
	out[0] = (x * c - dy * s) * t.k;
	out[1] = (x * s + dy * c) * t.k;
}

/** 一笔：采样点、逐点线宽、这笔的基色相、当时的对称设置。历史栈里存的就是它 */
export type Stroke = {
	/** 画布坐标，扁平 [x0,y0, x1,y1, ...] */
	pts: number[];
	/** 与 pts 一一对应的线宽（笔快则细） */
	widths: number[];
	hue: number;
	alpha: number;
	mode: SymmetryMode;
	count: number;
	/** 逐份拷贝的色相步进 —— 各份颜色层层推进，同一个图形才有彩虹般的层次 */
	hueStep: number;
	/**
	 * 橡皮：这一笔是**擦**不是画。
	 *
	 * 擦除做成「一种笔画」而不是「一条单独的擦除图层的理由」：历史栈里
	 * 画与擦按发生顺序混在一起，全量重绘（撤销走的就是它）逐条回放，
	 * 于是「擦掉的区域」天然正确、撤销一步也天然正确 —— 不用为擦除
	 * 另写一套状态，也就没有「撤销之后擦痕复活」这类 bug。
	 */
	erase?: boolean;
};

const _p0: number[] = [0, 0];
const _p1: number[] = [0, 0];
const _p2: number[] = [0, 0];

/**
 * 平滑用的几何：过中点法。
 *
 * 第 i 个点对应一段：控制点 = P[i]，两端 = 相邻两点的中点
 * （首点从 P[0] 起、末点画到 P[n-1]，整条线不缺口）。
 * 折线被抹圆，且曲线不会甩出采样点之外。
 *
 * ⚠️ 增量绘制（作画时只画最新一段）与全量重绘（撤销）**必须走同一套几何**，
 * 否则撤销之后画面跟画的时候长得不一样。两处都调这个函数，不各写一份。
 */
function segmentsOf(pts: number[], n: number) {
	return {
		/** 返回第 i 段的 [起点x, 起点y, 控制x, 控制y, 终点x, 终点y] */
		at(i: number): number[] {
			const cx = pts[i * 2];
			const cy = pts[i * 2 + 1];
			const px = pts[(i - 1) * 2];
			const py = pts[(i - 1) * 2 + 1];
			const nx = i + 1 <= n - 1 ? pts[(i + 1) * 2] : null;
			const ny = i + 1 <= n - 1 ? pts[(i + 1) * 2 + 1] : null;
			const x0 = i === 1 ? px : (px + cx) / 2;
			const y0 = i === 1 ? py : (py + cy) / 2;
			const x1 = nx === null ? cx : (cx + nx) / 2;
			const y1 = ny === null ? cy : (cy + ny) / 2;
			return [x0, y0, cx, cy, x1, y1];
		},
	};
}

/**
 * 把一笔画到 ctx 上。
 *
 * @param only `false` = 整笔重画（撤销）；`true` = 只画最新一段；
 *             传**数字** = 只画第 i 段（作画中补画刚完整的那一段，见下）
 * @param glitch   C 面的「故障偏移」力度 0~1，其余风格忽略
 *
 * `stroke.erase` 为真时这一笔是橡皮（destination-out），见 Stroke.erase 的说明。
 *
 * ⚠️ 作画中的增量渲染**必须只画「已经完整」的段**。第 i 段的两端是
 * 中点(P[i-1],P[i]) 和 中点(P[i],P[i+1])，也就是说它要等 P[i+1] 到位才算定形；
 * 新点一到就画它，只能拿 P[i] 当终点凑合 —— 那样每一段都少画后半截，
 * 采样稀疏（手快）时线是断的，一切面或一撤销又「补全」回来。
 * 所以约定：新点 P[k] 到达时补画第 k-1 段，最后一段在抬手时画。
 */
export function paintStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	cx: number,
	cy: number,
	only: boolean | number = false,
	kind: PaintKind = "silk",
	glitch = 0,
): void {
	const n = stroke.pts.length / 2;
	if (n < 2) return;

	// 擦除一律按丝缕那档来画：像素风的硬方块、赛博的虚线/故障抖动留在画布上
	// 都会变成一粒一粒擦不干净的花斑。擦痕要连续、要能一次到位。
	const k: PaintKind = stroke.erase ? "silk" : kind;

	const total = copyCount(stroke.mode, stroke.count);
	const seg = segmentsOf(stroke.pts, n);
	const single = typeof only === "number" ? only : -1;
	// 指定单段时必须落在 [1, n-1]：0 号段没有「上一个点」，越界会把 NaN 端点送进曲线
	if (single !== -1 && (single < 1 || single >= n)) return;
	const from = single !== -1 ? single : only === true ? n - 1 : 1;
	const to = single !== -1 ? single + 1 : n;

	ctx.save();
	// 相加混合：单根很淡，重叠处自己堆出辉光。
	// 橡皮反过来走 destination-out：按源的 alpha 把画布上已有的 alpha 减掉。
	// 对称、平滑几何、逐份拷贝全部复用同一条路径 —— 擦出来的形状必然和画出来的
	// 形状是同一套，不会出现「这边擦掉了、镜像那份还在」。
	ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "lighter";
	ctx.lineCap = k === "pixel" ? "butt" : "round";
	ctx.lineJoin = "round";
	// 赛博风带扫描线纹理：把线画成细密的虚线，本身就是一层「扫描条纹」
	if (k === "cyber") ctx.setLineDash([2, 3]);

	for (let c = 0; c < total; c++) {
		const t = copyTransform(stroke.mode, stroke.count, c);
		// 各份拷贝的色相依次推进，图形才有层次。
		// 擦除不看颜色（destination-out 只用 alpha），所有拷贝都用同一个值。
		ctx.strokeStyle = stroke.erase
			? `rgba(0, 0, 0, ${stroke.alpha})`
			: hsla(
					norm360(stroke.hue + c * stroke.hueStep),
					SAT,
					LIGHT,
					stroke.alpha,
				);
		ctx.fillStyle = ctx.strokeStyle;

		for (let i = from; i < to; i++) {
			const w = stroke.widths[i] ?? stroke.widths[n - 1] ?? 2;

			if (k === "pixel") {
				// 像素风：沿**曲线**按 g 的间隔撒硬方块，并吸附到 g 的网格上，才有 8bit 颗粒感。
				//
				// ⚠️ 不能「一个采样点一个方块」：采样点之间隔着几十像素（手快时更远），
				// 那样画出来是一串断点，不是一条像素线 —— 实测整幅画面只剩稀稀拉拉几颗豆子。
				// 网格吸附在**局部坐标**里做，各份拷贝因此共用同一套网格，只是被旋转开。
				const g = Math.max(2, Math.round(w * 1.9));
				const sg = seg.at(i);
				const ax = sg[0] - cx;
				const ay = sg[1] - cy;
				const bx = sg[2] - cx;
				const by = sg[3] - cy;
				const ex = sg[4] - cx;
				const ey = sg[5] - cy;
				// 用控制多边形的长度估弧长，够定步数了；上限兜住极端的手速
				const len = Math.hypot(bx - ax, by - ay) + Math.hypot(ex - bx, ey - by);
				const steps = Math.max(1, Math.min(24, Math.ceil(len / g)));
				for (let k = 0; k <= steps; k++) {
					const tt = k / steps;
					const u = 1 - tt;
					const qx = u * u * ax + 2 * u * tt * bx + tt * tt * ex;
					const qy = u * u * ay + 2 * u * tt * by + tt * tt * ey;
					applyCopy(Math.round(qx / g) * g, Math.round(qy / g) * g, t, _p0);
					// ⚠️ 落位后再对齐一次屏幕像素：镜像/螺旋会把方块转到小数坐标上，
					// 那样每条边都被抗锯齿抹一道，就不是「硬边方块」了
					// （自测的 soft 一栏能看出来：对齐前 0.42，对齐后接近 0）。
					ctx.fillRect(
						Math.round(_p0[0] + cx - g / 2),
						Math.round(_p0[1] + cy - g / 2),
						g,
						g,
					);
				}
				continue;
			}

			if (k === "cyber") {
				ctx.lineWidth = w * 1.15;
				ctx.globalAlpha = 1;
			} else {
				ctx.lineWidth = w;
				ctx.globalAlpha = 1;
			}

			if (k === "cyber" && glitch > 0) {
				// 故障偏移：每个点随机撕开一点，力度由滑块给
				ctx.setLineDash([2, 3 + glitch * 6]);
			}

			// —— 几何：三个点各自变换。旋转+等比缩放是线性变换，
			//    所以「变换后再画曲线」和「画完再变换」结果完全一致
			const s = seg.at(i);
			applyCopy(s[0] - cx, s[1] - cy, t, _p0);
			applyCopy(s[2] - cx, s[3] - cy, t, _p1);
			applyCopy(s[4] - cx, s[5] - cy, t, _p2);

			let jx = 0;
			let jy = 0;
			if (k === "cyber" && glitch > 0) {
				jx = (Math.random() - 0.5) * glitch * 26;
				jy = (Math.random() - 0.5) * glitch * 26;
			}

			ctx.beginPath();
			ctx.moveTo(_p0[0] + cx + jx, _p0[1] + cy + jy);
			ctx.quadraticCurveTo(
				_p1[0] + cx + jx,
				_p1[1] + cy + jy,
				_p2[0] + cx + jx,
				_p2[1] + cy + jy,
			);
			ctx.stroke();
		}
	}
	ctx.restore();
}

/** 笔速 → 线宽：动得越快线越细，动得越慢线越粗（模拟丝绸的自然粗细） */
export function widthForSpeed(speed: number, base = 6): number {
	const t = Math.min(1, speed / 26); // 26 px/帧 就算"很快"了
	return base * (1.18 - 0.72 * t);
}

/** 从调色盘的色块里取一个随机基色（高饱和高明度区间的色相） */
export function randomHue(): number {
	return Math.random() * 360;
}
