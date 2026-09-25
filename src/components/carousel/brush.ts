// 水墨楷书：把「笔顺骨架」数据写成毛笔字。
//
// 写字不是「把字淡入」——每一笔都按真实笔顺落下去，一笔写完才起下一笔；
// 笔宽用的是 bake 时量出来的真半宽，所以撇有撇尾、捺有捺脚，不是一根等宽的绳子。
//
// 渲染分两处：
//   ① 写完之后烘进一张离屏「纸」（page）。之后每帧只是把这张纸 drawImage 上来，
//      于是哪怕纸上已经有几十个字，一帧也只花一次贴图 —— 指针在纸上游走的
//      墨影、长风扫墨才不会因为字多而掉帧。
//   ② 正在写的那一行当场画，画完再烘进纸。
//
// 交互：点空白写一句（语录池）、双击风干（冻住不再变）、右键淡去、Backspace 撤销。

import { BRUSH_STROKES, type BrushGlyph } from "./brush-strokes";
import {
	type Couplings,
	clamp,
	dprCap,
	inkRgba,
	lerp,
	smoothstep,
} from "./couplings";

/** 语录池。点空处随机取一句 —— 固定的池子才配得上「旧话」这个说法。 */
export const LINES = [
	"流年不语，灯影自明",
	"旧梦无声，光阴有痕",
	"少年一瞬，人间经年",
	"时光轮转，初心未熄",
	"存档未逝，旧梦长明",
	"墨落定年，灯转忆昔",
];

/** 一个字渲染成「若干条带半宽的中线」。坐标已归一化（em 框半宽 = 1）。 */
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
			const w =
				ws.length === n
					? ws[i] + (ws[Math.min(i + 1, n - 1)] - ws[i]) * t
					: (ws[i] ?? 0.02);
			out.push(w);
		}
	}
	pts.push(src[(n - 1) * 2], src[(n - 1) * 2 + 1]);
	out.push(ws[n - 1] ?? 0.02);
	return { pts, ws: out };
}

/** 取一个字的笔顺数据（加密后的），带缓存。 */
function glyph(ch: string): Dense[] {
	const hit = denseCache.get(ch);
	if (hit) return hit;
	const raw: BrushGlyph | undefined = BRUSH_STROKES[ch];
	if (!raw) return [];
	const list: Dense[] = [];
	let off = 0;
	for (const count of raw.n) {
		const pts = raw.p.slice(off * 2, (off + count) * 2);
		const ws = raw.w.slice(off, off + count);
		list.push(densify(pts, ws));
		off += count;
	}
	denseCache.set(ch, list);
	return list;
}

/** 一条笔画已经跑了多少长度（归一化单位），用来算写字的总时长。 */
function strokeLength(d: Dense): number {
	let sum = 0;
	for (let i = 2; i < d.pts.length; i += 2) {
		sum += Math.hypot(d.pts[i] - d.pts[i - 2], d.pts[i + 1] - d.pts[i - 1]);
	}
	return sum;
}

/**
 * 把一条笔画画成笔迹。lengthRatio 是「这一笔写到哪里」（0..1）。
 *
 * 画法是**分段描边**：沿中线切十几段，每段用自己的宽度画一条圆头线。
 * 为什么不用「左右两条边界中间填充」：那样在拐弯急的地方（曲率半径小于半宽）
 * 偏移出来的两条边会交叉，填充面上翻出一个尖刺 —— 离线对比过，楷书的折笔上很明显。
 * 分段描边不会翻边，圆头相接也不会断。
 *
 * 收笔：最后一段的宽度砍掉大半，于是写到一半停住时看到的是一个正在行走的笔尖，
 * 而不是被刀切断的带子。
 */
function inkStroke(
	g: CanvasRenderingContext2D,
	d: Dense,
	cx: number,
	cy: number,
	scale: number,
	lengthRatio: number,
) {
	const count = d.ws.length;
	if (count < 2) return;
	const ratio = clamp(lengthRatio, 0, 1);
	const upto = Math.max(2, Math.round((count - 1) * ratio) + 1);
	const step = Math.max(1, Math.ceil((upto - 1) / 14));
	g.lineCap = "round";
	g.lineJoin = "round";
	for (let i = 0; i < upto - 1; i += step) {
		const j = Math.min(i + step, upto - 1);
		const mid = (i + j) >> 1;
		const px = cx + d.pts[i * 2] * scale;
		const py = cy - d.pts[i * 2 + 1] * scale;
		const qx = cx + d.pts[j * 2] * scale;
		const qy = cy - d.pts[j * 2 + 1] * scale;
		// 笔尖：还没写完时最后一段收细，收笔才有锋
		const tip = j >= upto - 1 && ratio < 1 ? 0.42 : 1;
		g.lineWidth = Math.max(0.7, d.ws[mid] * scale * 2 * tip);
		g.beginPath();
		g.moveTo(px, py);
		g.lineTo(qx, qy);
		g.stroke();
	}
}

/** 一个字的总笔画长度，用来让「字与字之间」的节奏跟着笔画的多少走。 */
function glyphLength(ch: string): number {
	let sum = 0;
	for (const d of glyph(ch)) sum += strokeLength(d);
	// 笔画极少的字（一、十）也要占一点时间，否则一闪而过
	return Math.max(0.55, sum);
}

export type WriterOptions = {
	/** 每个字的像素高度 */
	size: number;
	/** "v" 竖排（灯片题名，从右往左）、"h" 横排（语录） */
	mode?: "v" | "h";
	/** 竖排没写空格时按列数平均切 */
	columns?: number;
	/** 墨的浓淡 */
	alpha?: number;
};

/** 竖排时列与列的间距相对字号（`layout` 与 `fitSize` 必须用同一个）。
 *  导出是给自测用的：断言「字号 × 占位进得去框」时要用同一个间距，
 *  在测试里另抄一个数就白测了。 */
export const COL_GAP = 1.12;

/** 洇：笔迹底下还铺着一层更宽更淡的底（见 paintRun）。它比字本身大这么多倍 ——
 *  排版要让「字 + 洇」一起进框，就不能只看字号，得把这个倍数除掉。 */
export const HALO_SCALE = 1.32;

/** 竖排 / 横排的落点。
 *  竖排按**空格分列**（灯片题名自己带空格，于是「葫芦娃 黑猫警长」正好两列），
 *  没写空格就按列数平均切；列序从右往左，是国风里老规矩的顺序。 */
export function layout(text: string, x: number, y: number, opt: WriterOptions) {
	const gap = opt.size * COL_GAP;
	const out: { ch: string; x: number; y: number }[] = [];
	if (opt.mode !== "v") {
		const chars = [...text];
		for (const [i, ch] of chars.entries()) {
			if (/\s/.test(ch)) continue;
			out.push({ ch, x: x + (i - (chars.length - 1) / 2) * gap * 0.96, y });
		}
		return out;
	}
	const groups: string[][] = [];
	if (/\s/.test(text)) {
		for (const seg of text.split(/\s+/)) {
			if (seg) groups.push([...seg]);
		}
	} else {
		const chars = [...text];
		const cols = Math.max(1, opt.columns ?? 2);
		const per = Math.ceil(chars.length / cols);
		for (let i = 0; i < chars.length; i += per)
			groups.push(chars.slice(i, i + per));
	}
	for (const [col, chars] of groups.entries()) {
		const colX = x + ((groups.length - 1) / 2 - col) * gap;
		for (const [row, ch] of chars.entries()) {
			out.push({ ch, x: colX, y: y + (row - (chars.length - 1) / 2) * gap });
		}
	}
	return out;
}

/**
 * 竖排题名要塞进 w×h 的框里时，每个字该多大。
 *
 * 为什么不是「字号 = 面板高 × 某个比」：题名有 2 列 2 字（掌机 卡带）也有
 * 2 列 4 字（秦时明月 虹猫蓝兔），同一个比值必然要么小一半、要么撑出框。
 * 字形是**线性缩放**的（`layout` 里位置与间距都正比于 size），所以这里能直接解出来：
 * n 个字占高 (n-1)·size·COL_GAP + size，m 列占宽 (m-1)·size·COL_GAP + size。
 * 两个方向各解一个上限，取小的那个 —— 于是每张灯片的题名都恰好吃满自己的框。
 */
export function fitSize(text: string, w: number, h: number): number {
	const groups = /\s/.test(text) ? text.split(/\s+/).filter(Boolean) : [text];
	const cols = Math.max(1, groups.length);
	const rows = Math.max(1, ...groups.map((g) => [...g].length));
	const byHeight = h / ((rows - 1) * COL_GAP + 1);
	const byWidth = w / ((cols - 1) * COL_GAP + 1);
	return Math.min(byHeight, byWidth);
}

/**
 * 把一行字画到任意上下文里。budget 是「已经写了多少长度」——
 * 传 Infinity 就是整行写完（灯片上那六张题名走这条路，一次画好烘起来复用）。
 */
export function paintRun(
	g: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	opt: WriterOptions,
	budget: number,
	halo = HALO_SCALE,
) {
	let left = budget;
	for (const { ch, x: gx, y: gy } of layout(text, x, y, opt)) {
		// ⚠️ 这一行必须在字上判：写在笔画循环里只能跳出内层，后面的字会
		// 拿着负的预算继续画，于是每个字头上都多一个点。
		if (left <= 0) break;
		for (const d of glyph(ch)) {
			if (left <= 0) break;
			const len = strokeLength(d);
			const ratio = left >= len ? 1 : left / len;
			// 洇：同一笔先铺一层更宽更淡的底，边缘就不再是刀切的。
			// `halo` 由调用方给：刚落的墨还在往纸里走，那层底是渐渐铺开的。
			g.save();
			g.globalAlpha *= 0.3;
			inkStroke(g, d, gx, gy, (opt.size / 2) * halo, ratio);
			g.restore();
			inkStroke(g, d, gx, gy, opt.size / 2, ratio);
			left -= len;
		}
	}
}

/** 整行一次画完（灯片题名用）。 */
export function paintText(
	g: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	opt: WriterOptions,
	fill: string,
) {
	g.save();
	// 笔迹走 stroke（见 inkStroke 的注释），但 fillStyle 也一并给上：
	// 调用方不该需要知道笔迹内部是描边还是填充。
	g.strokeStyle = fill;
	g.fillStyle = fill;
	paintRun(g, text, x, y, opt, Number.POSITIVE_INFINITY);
	g.restore();
}

/** 一行字占多大（像素），灯片排版要用。 */
export function textBox(text: string, opt: WriterOptions) {
	const pts = layout(text, 0, 0, opt);
	let minX = 0;
	let maxX = 0;
	let minY = 0;
	let maxY = 0;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	const pad = opt.size * 0.72;
	return { w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

type Item = {
	text: string;
	x: number;
	y: number;
	opt: WriterOptions;
	/** 已经写了多少长度 */
	done: number;
	/** 总共要写多少长度 */
	total: number;
	/** 写完之后的状态 */
	state: "writing" | "dry" | "fading";
	fade: number;
	born: number;
};

export type Brush = {
	resize: () => void;
	frame: (dt: number) => void;
	/** 写一句。同一时刻只保留「正在写」的那一行，之前的先烘进纸里。 */
	write: (text: string, x: number, y: number, opt: WriterOptions) => void;
	/** 风干：冻住，不再有沉淀变化 */
	dry: () => boolean;
	/** 淡去最后一行 */
	fade: () => boolean;
	/** 撤销最后一行 */
	undo: () => boolean;
	clear: () => void;
	/** 指针游走：慢则留墨影，快则长风扫墨 */
	trail: (x: number, y: number, speed: number, dt: number) => void;
	/** 页面上有没有字（自测用） */
	count: () => number;
	/** 正在淡去的行数（自测用）。⚠️ 它们还算在 `count()` 里（还没消失），
	 *  所以要断言「墨迹上限真的生效了」必须两个一起看：总数封顶 + 确有在淡的。 */
	fading: () => number;
	/** 还有一笔正在写吗。⚠️ 别用 count() 判「写完了」—— 刚开始写它就已经 ≥1。 */
	writing: () => boolean;
};

export function createBrush(canvas: HTMLCanvasElement, c: Couplings): Brush {
	const ctxRaw = canvas.getContext("2d");
	if (!ctxRaw) throw new Error("brush: 拿不到 2d 上下文");
	// 同 clock.ts：收窄进不了被提升的函数声明（ts 18047），另绑一个非空常量。
	const ctx: CanvasRenderingContext2D = ctxRaw;

	let w = 0;
	let h = 0;
	let dpr = 1;
	/** 已经写完的字烘在这张纸上，之后每帧只贴它一次。 */
	let page: HTMLCanvasElement | null = null;
	let pageCtx: CanvasRenderingContext2D | null = null;
	const items: Item[] = [];
	let active: Item | null = null;
	/** 墨影 / 长风：一串很快就没的短痕 */
	const wisps: {
		pts: number[];
		life: number;
		max: number;
		kind: "shadow" | "gust";
	}[] = [];
	let wispAcc = 0;
	let dirty = true;
	/** 纸上最多留几行。再多也没人看，但每一行都要占一次烘焙与一次贴图 ——
	 *  到顶就把最早的那行推去淡掉（不是删掉：淡是看得见的，删是凭空少一行）。 */
	const MAX_ITEMS = 12;

	function resetPage() {
		page = document.createElement("canvas");
		page.width = canvas.width;
		page.height = canvas.height;
		pageCtx = page.getContext("2d");
		if (pageCtx) pageCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = dprCap();
		w = Math.max(1, Math.round(rect.width));
		h = Math.max(1, Math.round(rect.height));
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		resetPage();
		// 尺寸变了，纸上的字重画一遍（旧纸的像素已经对不上了）
		bakeAll();
		dirty = true;
	}

	function paintItem(g: CanvasRenderingContext2D, item: Item, live: boolean) {
		const alpha =
			(item.opt.alpha ?? 0.92) * (item.state === "fading" ? 1 - item.fade : 1);
		if (alpha <= 0.01) return;
		// 风干之后墨色会微微沉下去一点；没风干时字还是「湿」的，更深
		const tone = item.state === "dry" ? 1.06 : 0.98;
		// 洇：刚落下的墨还在往纸里走 —— 那层淡边在 0.3 秒里从贴边铺到最宽。
		// 烘进纸里的字永远是铺满的（烘干即定型），所以只有正在写的那行在变。
		const halo = live
			? lerp(
					1.03,
					HALO_SCALE,
					smoothstep((performance.now() / 1000 - item.born) / 0.3),
				)
			: HALO_SCALE;
		g.save();
		const ink = inkRgba(c, alpha, tone);
		g.strokeStyle = ink;
		g.fillStyle = ink;
		paintRun(
			g,
			item.text,
			item.x,
			item.y,
			item.opt,
			live ? item.done : Number.POSITIVE_INFINITY,
			halo,
		);
		g.restore();
	}

	/** 把已经写完的都烘到纸上。擦掉重来也只在这一刻发生，平时不碰。 */
	function bakeAll() {
		if (!pageCtx) return;
		pageCtx.clearRect(0, 0, w, h);
		for (const it of items) {
			if (it === active) continue;
			paintItem(pageCtx, it, false);
		}
		if (active) paintItem(pageCtx, active, false);
	}

	function drawWisps(g: CanvasRenderingContext2D) {
		for (const ws of wisps) {
			const p = 1 - ws.life / ws.max;
			if (p <= 0) continue;
			const alpha = (ws.kind === "gust" ? 0.16 : 0.1) * smoothstep(p);
			const width = (ws.kind === "gust" ? 2.6 : 1.5) * (0.4 + p);
			g.strokeStyle = inkRgba(c, alpha, 0.9);
			g.lineWidth = width;
			g.lineCap = "round";
			g.lineJoin = "round";
			g.beginPath();
			for (let i = 0; i < ws.pts.length; i += 2) {
				if (i === 0) g.moveTo(ws.pts[0], ws.pts[1]);
				else g.lineTo(ws.pts[i], ws.pts[i + 1]);
			}
			g.stroke();
		}
	}

	function frame(dt: number) {
		let moving = false;
		if (active && active.state === "writing") {
			// 写得快慢跟着整体流速走：时间被拨慢了，字也该写得慢
			active.done += dt * active.total * 0.42 * clamp(c.speed, 0.4, 3);
			if (active.done >= active.total) {
				active.done = active.total;
				active.state = "dry";
				// 写完这一刻才烘进纸 —— 之前每帧都得重画正在写的那一行
				items.push(active);
				active = null;
				bakeAll();
			}
			moving = true;
		}
		for (let i = wisps.length - 1; i >= 0; i--) {
			wisps[i].life -= dt;
			if (wisps[i].life <= 0) wisps.splice(i, 1);
			else moving = true;
		}
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it.state !== "fading") continue;
			it.fade += dt * 0.5;
			if (it.fade >= 1) {
				// 淡完了就得**真的出队**：留着的话它每帧仍要参与烘焙，
				// 而 alpha 已经归零，纯是白画。
				items.splice(i, 1);
				bakeAll();
				dirty = true;
			} else moving = true;
		}
		if (dirty || moving) {
			dirty = false;
			ctx.clearRect(0, 0, w, h);
			if (page) ctx.drawImage(page, 0, 0, w, h);
			if (active) paintItem(ctx, active, true);
			drawWisps(ctx);
		}
	}

	return {
		resize,
		frame,
		write(text, x, y, opt) {
			if (active) {
				items.push(active);
				active = null;
				bakeAll();
			}
			let total = 0;
			for (const ch of text) total += glyphLength(ch);
			active = {
				text,
				x,
				y,
				opt,
				done: 0,
				total,
				state: "writing",
				fade: 0,
				born: performance.now() / 1000,
			};
			// 到顶了：把最早那几行推去淡掉。要按「还没开始淡的」算，
			// 否则连着写十几句时，一次只推一行，纸上会越堆越多。
			let over = items.filter((it) => it.state !== "fading").length - MAX_ITEMS;
			for (const it of items) {
				if (over <= 0) break;
				if (it.state === "fading") continue;
				it.state = "fading";
				over--;
			}
			dirty = true;
		},
		dry() {
			const last = items[items.length - 1];
			if (!last || last.state === "dry") return false;
			last.state = "dry";
			last.fade = 0;
			bakeAll();
			dirty = true;
			return true;
		},
		fade() {
			const last = items[items.length - 1] ?? active;
			if (!last) return false;
			if (last === active) {
				active = null;
			} else {
				last.state = "fading";
			}
			bakeAll();
			dirty = true;
			return true;
		},
		undo() {
			if (active) {
				active = null;
				bakeAll();
				dirty = true;
				return true;
			}
			if (!items.length) return false;
			items.pop();
			bakeAll();
			dirty = true;
			return true;
		},
		clear() {
			items.length = 0;
			active = null;
			wisps.length = 0;
			bakeAll();
			dirty = true;
		},
		trail(x, y, speed, dt) {
			// 慢：留一道几乎看不见的墨影；快：长风扫墨，一笔带过去就散
			const kind = speed > 1400 ? "gust" : speed < 260 ? "shadow" : null;
			if (!kind) {
				if (wisps.length) dirty = true;
				return;
			}
			const max = kind === "gust" ? 0.5 : 1.5;
			if (c.calm && kind === "gust") return;
			wispAcc += dt;
			const cur = wisps[wisps.length - 1];
			if (!cur || cur.kind !== kind || wispAcc > 0.06) {
				wisps.push({ pts: [x, y], life: max, max, kind });
				wispAcc = 0;
			} else {
				cur.pts.push(x, y);
				// 太长的尾巴会变成一条盘住的蛇，砍掉最早的点
				if (cur.pts.length > 40) cur.pts.splice(0, 2);
			}
			dirty = true;
		},
		count: () => items.length + (active ? 1 : 0),
		fading: () => items.filter((it) => it.state === "fading").length,
		writing: () => active !== null,
	};
}
