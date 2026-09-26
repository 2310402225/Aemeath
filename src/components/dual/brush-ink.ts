// 毛笔字：把「笔顺骨架」写成字。
//
// 字不是"淡入"出来的，是**一笔一笔按真实笔顺落下去**的，一笔写完才起下一笔。
// 笔宽用的是烘数据时量出来的真半宽，所以撇有撇尾、捺有捺脚，不是一根等宽的绳子。
//
// 四条脾气（spec 里点名要的）：
//   起笔轻入  —— 每一笔的头两段收细、压淡，落下去像笔尖刚触纸
//   行笔浓淡  —— 沿笔画本身走一层低频浓淡，不是恒定的一个 alpha
//   收笔飞白墨锋 —— 末尾收细，并在笔锋里拉出几道平行的枯笔丝
//   落笔洇墨  —— 底下先铺一层更宽更淡的底，字因此是"长在纸上"而不是贴上去的

import { BRUSH_STROKES, type BrushGlyph } from "./glyphs";
import { clamp } from "./state";

type Dense = { pts: number[]; ws: number[] };

const denseCache = new Map<string, Dense[]>();

/** Catmull-Rom 加密：中线点很稀（一笔常常只有三点），线性直连会写成折线。 */
function densify(src: number[], ws: number[], steps = 8): Dense {
	const n = src.length / 2;
	if (n < 2) return { pts: src.slice(), ws: ws.slice() };
	const at = (i: number) => {
		const k = clamp(i, 0, n - 1);
		return [src[k * 2], src[k * 2 + 1]];
	};
	const pts: number[] = [];
	const out: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const [x0, y0] = at(i - 1);
		const [x1, y1] = at(i);
		const [x2, y2] = at(i + 1);
		const [x3, y3] = at(i + 2);
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			const t2 = t * t;
			const t3 = t2 * t;
			pts.push(
				0.5 *
					(2 * x1 +
						(-x0 + x2) * t +
						(2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 +
						(-x0 + 3 * x1 - 3 * x2 + x3) * t3),
				0.5 *
					(2 * y1 +
						(-y0 + y2) * t +
						(2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
						(-y0 + 3 * y1 - 3 * y2 + y3) * t3),
			);
			out.push(
				ws.length === n
					? ws[i] + (ws[Math.min(i + 1, n - 1)] - ws[i]) * t
					: (ws[i] ?? 0.02),
			);
		}
	}
	pts.push(src[(n - 1) * 2], src[(n - 1) * 2 + 1]);
	out.push(ws[n - 1] ?? 0.02);
	return { pts, ws: out };
}

/** 取一个字的笔顺（加密后），带缓存。没有这个字就返回空数组（调用方要能接住）。 */
export function glyphOf(ch: string): Dense[] {
	const hit = denseCache.get(ch);
	if (hit) return hit;
	const raw: BrushGlyph | undefined = BRUSH_STROKES[ch];
	if (!raw) return [];
	const list: Dense[] = [];
	let off = 0;
	for (const count of raw.n) {
		list.push(
			densify(
				raw.p.slice(off * 2, (off + count) * 2),
				raw.w.slice(off, off + count),
			),
		);
		off += count;
	}
	denseCache.set(ch, list);
	return list;
}

export function hasGlyph(ch: string): boolean {
	return Boolean(BRUSH_STROKES[ch]);
}

/** 一个字的总笔画长度（归一化单位）：字与字之间的节奏按它走，笔画少的字不会一闪而过。 */
export function glyphLength(ch: string): number {
	const g = glyphOf(ch);
	if (!g.length) return 1;
	let sum = 0;
	for (const d of g) {
		for (let i = 2; i < d.pts.length; i += 2) {
			sum += Math.hypot(d.pts[i] - d.pts[i - 2], d.pts[i + 1] - d.pts[i - 1]);
		}
	}
	return Math.max(0.55, sum);
}

/** 每笔的长度，用来把「整字进度」切成「这一笔写到哪」。 */
export function strokeLengths(ch: string): number[] {
	return glyphOf(ch).map((d) => {
		let sum = 0;
		for (let i = 2; i < d.pts.length; i += 2) {
			sum += Math.hypot(d.pts[i] - d.pts[i - 2], d.pts[i + 1] - d.pts[i - 1]);
		}
		return Math.max(1e-4, sum);
	});
}

/** 每笔起点/终点在字里的累计比例，供外部把整字进度映射到单笔。 */
export function strokeSpans(ch: string): { from: number; to: number }[] {
	const ls = strokeLengths(ch);
	const total = ls.reduce((a, b) => a + b, 0);
	let acc = 0;
	return ls.map((l) => {
		const from = acc / total;
		acc += l;
		return { from, to: acc / total };
	});
}

/** 低频浓淡：沿笔画走的墨色起伏。用两个不同周期的正弦凑，比随机数稳（同一帧内可复现）。 */
function tone(i: number, seed: number): number {
	return (
		0.82 + 0.18 * Math.sin(i * 0.31 + seed) * Math.sin(i * 0.07 + seed * 2.1)
	);
}

type StrokeStyle = {
	/** 墨色（已算好旧色的 rgb 字符串，如 "rgb(30 28 26)"） */
	color: string;
	/** 整体浓度 */
	alpha: number;
	/** 洇的倍数（0 = 不铺底） */
	halo: number;
	/** 是否飞白（收笔拉枯笔丝） */
	dry: boolean;
};

/**
 * 把一条笔画画成笔迹。ratio 是「这一笔写到哪里」（0..1）。
 *
 * 画法是**分段描边**：沿中线切十几段，每段用自己的宽度画一条圆头线。
 * 为什么不用"左右两条边界中间填充"：拐弯急的地方（曲率半径小于半宽）偏移出来的
 * 两条边会交叉，填充面上翻出一个尖刺 —— 楷书的折笔上很明显。分段描边不会翻边。
 */
export function inkStroke(
	g: CanvasRenderingContext2D,
	d: Dense,
	cx: number,
	cy: number,
	scale: number,
	ratio: number,
	st: StrokeStyle,
) {
	const count = d.ws.length;
	if (count < 2) return;
	const r = clamp(ratio, 0, 1);
	const upto = Math.max(2, Math.round((count - 1) * r) + 1);
	const step = Math.max(1, Math.ceil((upto - 1) / 14));
	g.lineCap = "round";
	g.lineJoin = "round";

	// 落笔洇墨：先铺一层更宽更淡的底。分三层是为了有柔边（一层就是一个硬边）。
	if (st.halo > 0 && r > 0.02) {
		for (let layer = 3; layer >= 1; layer--) {
			g.globalAlpha = st.alpha * 0.055 * (4 - layer);
			g.strokeStyle = st.color;
			for (let i = 0; i < upto - 1; i += step * 2) {
				const j = Math.min(i + step * 2, upto - 1);
				const mid = (i + j) >> 1;
				const tip = j >= upto - 1 && r < 1 ? 0.42 : 1;
				g.lineWidth = Math.max(
					0.8,
					d.ws[mid] * scale * 2 * tip + scale * 0.045 * layer * st.halo,
				);
				g.beginPath();
				g.moveTo(cx + d.pts[i * 2] * scale, cy - d.pts[i * 2 + 1] * scale);
				g.lineTo(cx + d.pts[j * 2] * scale, cy - d.pts[j * 2 + 1] * scale);
				g.stroke();
			}
		}
	}

	for (let i = 0; i < upto - 1; i += step) {
		const j = Math.min(i + step, upto - 1);
		const mid = (i + j) >> 1;
		const px = cx + d.pts[i * 2] * scale;
		const py = cy - d.pts[i * 2 + 1] * scale;
		const qx = cx + d.pts[j * 2] * scale;
		const qy = cy - d.pts[j * 2 + 1] * scale;
		// 笔尖：还没写完时最后一段收细，停笔时看到的是"正在行走的笔尖"而不是被刀切断的带子
		const tip = j >= upto - 1 && r < 1 ? 0.42 : 1;
		// 起笔轻入：头两段压细压淡
		const start = i === 0 ? 0.62 : 1;
		const w = d.ws[mid] * scale * 2 * tip * start;
		g.globalAlpha = st.alpha * tone(mid, 1.7) * (i === 0 ? 0.78 : 1);
		g.strokeStyle = st.color;
		g.lineWidth = Math.max(0.7, w);
		g.beginPath();
		g.moveTo(px, py);
		g.lineTo(qx, qy);
		g.stroke();

		// 收笔飞白墨锋：末尾几段里拉出平行的枯笔丝
		if (st.dry && i >= upto - 1 - step * 2) {
			const len = Math.hypot(qx - px, qy - py);
			if (len > 1) {
				const nx = -(qy - py) / len;
				const ny = (qx - px) / len;
				for (let k = -1; k <= 1; k++) {
					if (k === 0) continue;
					g.globalAlpha = st.alpha * 0.34;
					g.lineWidth = Math.max(0.5, w * 0.16);
					g.beginPath();
					g.moveTo(px + nx * w * 0.22 * k, py + ny * w * 0.22 * k);
					g.lineTo(qx + nx * w * 0.34 * k, qy + ny * w * 0.34 * k);
					g.stroke();
				}
			}
		}
	}
}

export type WriteOpts = {
	/** 字高（像素） */
	size: number;
	/** 整字进度 0..1；1 = 写完 */
	progress: number;
	/** 墨色 */
	color: string;
	alpha?: number;
	/** 洇的倍数，0 = 关掉 */
	halo?: number;
	dry?: boolean;
};

/**
 * 写一个字。progress 从 0 到 1 走完，笔顺天然正确 —— 因为笔画是按数据里的顺序落的。
 * 返回还有没有没写完的笔（外部据此判"写完了没"，别用别的判据）。
 */
export function writeChar(
	g: CanvasRenderingContext2D,
	ch: string,
	cx: number,
	cy: number,
	opt: WriteOpts,
): boolean {
	const strokes = glyphOf(ch);
	if (!strokes.length) return false;
	const spans = strokeSpans(ch);
	const p = clamp(opt.progress, 0, 1);
	const st: StrokeStyle = {
		color: opt.color,
		alpha: opt.alpha ?? 1,
		halo: opt.halo ?? 1,
		dry: opt.dry ?? true,
	};
	const scale = opt.size / 2; // 数据是 [-1,1] 的 em 框半宽
	let pending = false;
	for (let i = 0; i < strokes.length; i++) {
		const span = spans[i];
		if (p >= span.to) {
			inkStroke(g, strokes[i], cx, cy, scale, 1, st);
		} else if (p > span.from) {
			inkStroke(
				g,
				strokes[i],
				cx,
				cy,
				scale,
				(p - span.from) / (span.to - span.from),
				st,
			);
			pending = true;
		} else {
			pending = true;
		}
	}
	g.globalAlpha = 1;
	return pending;
}

/** 一行字（横排）。`progress` 是整行的进度，逐字右移一格。返回整行宽度，供居中。 */
export function writeRow(
	g: CanvasRenderingContext2D,
	text: string,
	cx: number,
	cy: number,
	opt: WriteOpts & { gap?: number },
): number {
	const chars = [...text];
	const gap = opt.size * (opt.gap ?? 1.16);
	const total = (chars.length - 1) * gap;
	for (const [i, ch] of chars.entries()) {
		// progress 会被 clamp 到 [0,1]：小于 0 的字还没起笔，大于 1 的是写完的字
		writeChar(g, ch, cx + i * gap - total / 2, cy, {
			...opt,
			progress: opt.progress * chars.length - i,
		});
	}
	return total;
}
