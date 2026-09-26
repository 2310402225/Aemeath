// 下位面：水墨丹青。
//
// 一块白宣纸，五种交互：
//   ① 滴墨   点一下滴一滴：先在落点聚成一颗浓点，再慢慢往外晕开，边缘长出飞白与渗墨
//   ② 泼墨   长按不放：炸开一团大的
//   ③ 墨线   按住拖：沿路径落下连续的墨点（**不是画笔** —— 线是"滴"出来的，不是描出来的）
//   ④ 写字   按钮：随机一个字，按真实笔顺一笔一笔落下去；写完洇一下、压深一点、冻住
//   ⑤ 浮现   按钮：随机一幅水墨画，从一层很淡的轮廓里醒过来
//
// 两条工程底线：
//   · 已经沉下去的墨、写完的字、浮完的画，**全部烘进一张离屏"纸"**，每帧只贴一次图。
//     不这么做，纸上攒到几十团墨时每帧要重画几十条 72 点路径，必掉帧。
//   · 墨量有上限。超了就把最老的挑出来开始淡出，淡完从纸上抹掉重烘 ——
//     于是"可以一直玩"和"不会越玩越卡"是同一件事。

import { glyphLength, hasGlyph, writeChar } from "./brush-ink";
import { PAINTINGS } from "./data";
import { clamp, type Dual, lerp, type View } from "./state";

/** 「书写汉字」的池子。都在 `glyphs.ts` 里烘过笔顺。 */
const WRITE_POOL = [..."山水云风花雪灯影光墨梦鹤竹茶江剑星河尘归春秋舟"];

const MAX_BLOTS = 40;
const MAX_CHARS = 8;
const MAX_PAINTINGS = 3;
const FADE = 1.7;

type Blot = {
	x: number;
	y: number;
	r: number;
	born: number;
	life: number;
	seed: number;
	/** 飞白强度：0 = 边缘光滑（一滴圆墨），越大越枯 */
	dry: number;
	dark: number;
	/** 已经烘进纸里了 */
	baked: boolean;
	/** 开始淡出的时刻，−1 = 没在淡 */
	fadeAt: number;
};

type Written = {
	ch: string;
	x: number;
	y: number;
	size: number;
	alpha: number;
};
type Surfaced = {
	idx: number;
	x: number;
	y: number;
	w: number;
	h: number;
	born: number;
	/** 亮完并烘进纸了没有 —— 见 `draw()` 的 ④。 */
	baked: boolean;
};

export type InkWorld = {
	resize(view: View): void;
	draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number): void;
	dot(x: number, y: number, power: number): void;
	trail(x: number, y: number): void;
	beginDrag(x: number, y: number): void;
	endDrag(): void;
	/** 写一个字。抢不到（正在写）就返回 null；否则返回这个字，交给罗盘去落记忆点。 */
	write(): string | null;
	surface(): boolean;
	writing(): boolean;
	blotCount(): number;
	clear(): void;
};

export function createInkWorld(): InkWorld {
	let view: View = { w: 1, h: 1, dpr: 1, river: 1 };
	/** 最近一次拿到的共享态。`trim()` / `rebake()` 要用它的 now 与 age。 */
	let ref: Dual | null = null;
	let blots: Blot[] = [];
	let written: Written[] = [];
	let surfaced: Surfaced[] = [];
	let seed = 424242;
	const rnd = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 4294967296;
	};

	/** 离屏「纸」：沉下去的墨 + 写完的字 + 浮完的画都烘在这里 */
	let page: HTMLCanvasElement | null = null;
	let pg: CanvasRenderingContext2D | null = null;
	let fiber: CanvasPattern | null = null;
	let writing: {
		ch: string;
		x: number;
		y: number;
		size: number;
		from: number;
		dur: number;
	} | null = null;
	let dragging = false;
	let lastTrail = { x: 0, y: 0 };
	let trimClock = 0;
	const images = new Map<number, HTMLImageElement>();

	function makeFiber(): HTMLCanvasElement {
		const c = document.createElement("canvas");
		c.width = 180;
		c.height = 180;
		const g = c.getContext("2d");
		if (g) {
			for (let i = 0; i < 240; i++) {
				const x = rnd() * 180;
				const y = rnd() * 180;
				const len = 2 + rnd() * 9;
				const a = rnd() * Math.PI;
				g.strokeStyle = `rgb(120 104 78 / ${0.02 + rnd() * 0.035})`;
				g.lineWidth = 0.6;
				g.beginPath();
				g.moveTo(x, y);
				g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
				g.stroke();
			}
		}
		return c;
	}

	function ensurePage() {
		const w = Math.max(1, Math.round(view.w * view.dpr));
		const h = Math.max(1, Math.round(view.h * view.dpr));
		if (!page) {
			page = document.createElement("canvas");
			pg = page.getContext("2d");
		}
		if (page.width !== w || page.height !== h) {
			page.width = w;
			page.height = h;
			for (const b of blots) b.baked = false;
		}
		if (!fiber && pg) fiber = pg.createPattern(makeFiber(), "repeat");
	}

	/** 一团墨的极坐标轮廓：几层低频正弦叠出"不圆的圆"，再按 dry 咬出飞白的缺口。 */
	function radiusAt(b: Blot, th: number, grow: number): number {
		const s = b.seed;
		let k =
			1 +
			0.15 * Math.sin(3 * th + s) +
			0.1 * Math.sin(5 * th + s * 2.1) +
			0.06 * Math.sin(9 * th + s * 1.7);
		if (b.dry > 0) {
			const spikes = 7;
			const ph = ((th / (Math.PI * 2)) * spikes + s) % 1;
			const near = Math.min(ph, 1 - ph);
			k *= 1 - b.dry * 0.34 * clamp(1 - near * 5, 0, 1);
		}
		return b.r * grow * k;
	}

	function blobPath(
		g: CanvasRenderingContext2D,
		b: Blot,
		grow: number,
		scale: number,
	) {
		g.beginPath();
		for (let i = 0; i <= 72; i++) {
			const th = (i / 72) * Math.PI * 2;
			const rr = radiusAt(b, th, grow * scale);
			const x = b.x + Math.cos(th) * rr;
			const y = b.y + Math.sin(th) * rr * 0.94;
			if (i === 0) g.moveTo(x, y);
			else g.lineTo(x, y);
		}
		g.closePath();
	}

	function inkTriple(d: Dual): [number, number, number] {
		const t = d.age;
		return [
			Math.round(lerp(30, 112, t)),
			Math.round(lerp(28, 84, t)),
			Math.round(lerp(26, 56, t)),
		];
	}

	/** 画一团墨。`t` 传 Infinity 就是"已经长定了"。 */
	function paintBlot(g: CanvasRenderingContext2D, b: Blot, t: number, d: Dual) {
		const u =
			t === Number.POSITIVE_INFINITY ? 1 : clamp((t - b.born) / b.life, 0, 1);
		const grow = 0.14 + 0.86 * (u * u * (3 - 2 * u));
		const fade = b.fadeAt < 0 ? 1 : clamp(1 - (t - b.fadeAt) / FADE, 0, 1);
		const alpha =
			b.dark *
			(t === Number.POSITIVE_INFINITY ? 1 : fade) *
			clamp(0.4 + u * 0.6, 0, 1);
		if (alpha <= 0.004) return;
		const [ir, ig, ib] = inkTriple(d);

		// 渗墨：最外两层很淡的边先铺，边缘才不是一条硬线
		for (let layer = 3; layer >= 1; layer--) {
			blobPath(g, b, grow, 1 + layer * 0.17);
			g.fillStyle = `rgb(${ir} ${ig} ${ib} / ${
				alpha * (layer === 3 ? 0.05 : layer === 2 ? 0.1 : 0.2)
			})`;
			g.fill();
		}
		// 墨心：中间实、往外淡
		blobPath(g, b, grow, 1);
		const rg = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * grow);
		rg.addColorStop(0, `rgb(${ir} ${ig} ${ib} / ${alpha})`);
		rg.addColorStop(0.58, `rgb(${ir} ${ig} ${ib} / ${alpha * 0.86})`);
		rg.addColorStop(1, `rgb(${ir} ${ig} ${ib} / ${alpha * 0.3})`);
		g.fillStyle = rg;
		g.fill();
	}

	function paintSurfaced(
		g: CanvasRenderingContext2D,
		s: Surfaced,
		t: number,
		cap: number,
	) {
		const img = images.get(s.idx);
		if (!img?.complete || !img.naturalWidth) return;
		const u = clamp((t - s.born) / 1.5, 0, 1);
		// 前三分之一只给一层很淡的轮廓（记忆还没成形），之后才真的落下来
		const a =
			(u < 0.34 ? (u / 0.34) * 0.14 : lerp(0.14, 1, (u - 0.34) / 0.66)) * cap;
		const scale = lerp(1.05, 1, u * u * (3 - 2 * u));
		g.globalAlpha = clamp(a, 0, 1);
		g.drawImage(
			img,
			s.x - (s.w * scale) / 2,
			s.y - (s.h * scale) / 2,
			s.w * scale,
			s.h * scale,
		);
		g.globalAlpha = 1;
	}

	/** 重烘整张纸。只在"有东西沉下去 / 开始淡出 / 被抹掉"时调。 */
	function rebake() {
		const d = ref;
		if (!d) return;
		ensurePage();
		if (!pg || !page) return;
		pg.setTransform(1, 0, 0, 1, 0, 0);
		pg.clearRect(0, 0, page.width, page.height);
		pg.scale(view.dpr, view.dpr);
		// ⚠️ 纸不烘在这里（见 `draw()` 的 ⓪）：离屏只放「沉下去的东西」。
		// 纸一旦烘进来就会跟着 `river` 一起错位 —— 而 `river` 每帧都在动。
		const big = Number.POSITIVE_INFINITY;
		for (const b of blots) {
			// born<=0 = 还没在纸上落定（刚 push、第一帧还没跑），这种不能烘，否则会
			// 以"长定了"的样子直接定死
			if (b.fadeAt >= 0 || b.born <= 0) continue;
			paintBlot(pg, b, big, d);
			b.baked = true;
		}
		for (const w of written) {
			writeChar(pg, w.ch, w.x, w.y, {
				size: w.size,
				progress: 1,
				color: `rgb(${inkTriple(d).join(" ")})`,
				alpha: w.alpha,
				halo: 1,
				dry: true,
			});
		}
		for (const s of surfaced) paintSurfaced(pg, s, d.now, 0.92);
	}

	/** 超上限：墨点挑最老的开始淡出（**不是瞬删** —— 瞬删会像画面被挖掉一块）；
	 *  写完的字与浮出的画直接移出，它们本来就有出生顺序。 */
	function trim() {
		const d = ref;
		if (!d) return;
		let changed = false;
		if (blots.length > MAX_BLOTS) {
			const n = blots.length - MAX_BLOTS;
			for (let i = 0; i < n; i++) {
				const b = blots[i];
				if (b.fadeAt < 0) {
					b.fadeAt = d.now;
					changed = true;
				}
			}
		}
		if (written.length > MAX_CHARS) {
			written.splice(0, written.length - MAX_CHARS);
			changed = true;
		}
		if (surfaced.length > MAX_PAINTINGS) {
			surfaced.splice(0, surfaced.length - MAX_PAINTINGS);
			changed = true;
		}
		if (changed) rebake();
	}

	function dot(x: number, y: number, power: number) {
		blots.push({
			x,
			y,
			r: clamp(Math.min(view.w, view.h) * 0.038 * power, 14, view.w * 0.3),
			born: 0,
			life: 1.5 + rnd() * 1.4,
			seed: rnd() * 6.28,
			dry: power > 1.4 ? 0.85 : power > 1 ? 0.5 : 0.22,
			dark: clamp(0.44 + rnd() * 0.3, 0, 0.8),
			baked: false,
			fadeAt: -1,
		});
	}

	function trail(x: number, y: number) {
		if (Math.hypot(x - lastTrail.x, y - lastTrail.y) < 12) return;
		lastTrail = { x, y };
		blots.push({
			x,
			y,
			r: clamp(
				Math.min(view.w, view.h) * 0.024 * (0.7 + rnd() * 0.6),
				7,
				view.w * 0.22,
			),
			born: 0,
			life: 1.1,
			seed: rnd() * 6.28,
			dry: 0.62,
			dark: 0.3 + rnd() * 0.18,
			baked: false,
			fadeAt: -1,
		});
	}

	function write(): string | null {
		if (writing) return null;
		const pool = WRITE_POOL.filter(hasGlyph);
		if (!pool.length) return null;
		const ch = pool[Math.floor(rnd() * pool.length)] ?? "山";
		const size = Math.min(view.w, view.h) * (view.w < 760 ? 0.32 : 0.27);
		writing = {
			ch,
			x: view.w * (0.24 + rnd() * 0.52),
			y: view.river + (view.h - view.river) * (0.3 + rnd() * 0.4),
			size,
			from: 0,
			dur: clamp(glyphLength(ch) * 0.42, 1.1, 3.2),
		};
		return ch;
	}

	function surface(): boolean {
		if (surfaced.length >= MAX_PAINTINGS) return false;
		const used = new Set(surfaced.map((s) => s.idx));
		const free = PAINTINGS.map((_, i) => i).filter((i) => !used.has(i));
		const idx = free[Math.floor(rnd() * free.length)] ?? 0;
		const img = images.get(idx);
		const ar = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.58;
		const box = clamp(
			Math.min(view.w * 0.62, (view.h - view.river) * 0.74),
			150,
			720,
		);
		surfaced.push({
			idx,
			x: view.w * (0.32 + rnd() * 0.36),
			y: view.river + (view.h - view.river) * (0.32 + rnd() * 0.36),
			w: box,
			h: box * ar,
			born: 0,
			baked: false,
		});
		return true;
	}

	function preload(idx: number) {
		if (images.has(idx)) return;
		const img = new Image();
		img.decoding = "async";
		img.src = PAINTINGS[idx].src;
		images.set(idx, img);
	}

	function resize(v: View) {
		const old = view;
		view = v;
		if (images.size === 0)
			for (let i = 0; i < PAINTINGS.length; i++) preload(i);
		if (old.w > 1 && old.river > 1) {
			const sx = v.w / old.w;
			const sy = v.h / old.h;
			for (const b of blots) {
				b.x *= sx;
				b.y *= sy;
			}
			for (const w of written) {
				w.x *= sx;
				w.y *= sy;
			}
			for (const s of surfaced) {
				s.x *= sx;
				s.y *= sy;
			}
		}
		for (const b of blots) b.baked = false;
		rebake();
	}

	function draw(g: CanvasRenderingContext2D, d: Dual, v: View, dt: number) {
		ref = d;
		view = v;
		ensurePage();
		const t = d.now;

		// ⓪ 纸：每帧画，不进离屏。
		// ⚠️ 纸曾经烘在 `page` 里 —— 而 `page` 只在「有东西沉下去」时才重烘，于是
		//   ① 首屏还没落墨，下半位面是空的（看着像黑块，而不是宣纸）；
		//   ② 进了星空之后，烘死的那块纸会整片粘在星空上（`river` 每帧都在动）。
		// 纸的几何只跟 `river` 走，每帧两次 fillRect 远比每帧重烘整张纸便宜。
		g.save();
		const paper = g.createLinearGradient(0, v.river, 0, v.h);
		paper.addColorStop(0, "#f4efe3");
		paper.addColorStop(0.5, "#faf6ec");
		paper.addColorStop(1, "#ece5d5");
		g.fillStyle = paper;
		g.fillRect(0, v.river, v.w, v.h - v.river);
		if (fiber) {
			g.fillStyle = fiber;
			g.fillRect(0, v.river, v.w, v.h - v.river);
		}
		g.restore();

		// ① 沉下去的：贴纸（一次 drawImage，跟纸上攒了多少东西无关）
		if (page) {
			g.save();
			g.setTransform(1, 0, 0, 1, 0, 0);
			g.drawImage(page, 0, 0);
			g.restore();
		}

		g.save();
		g.beginPath();
		g.rect(0, v.river - 2, v.w, v.h - v.river + 2);
		g.clip();

		let settled = false;
		// ② 还在长 / 还在淡的墨：当场画
		for (const b of blots) {
			if (b.born <= 0) b.born = t;
			if (b.baked && b.fadeAt < 0) continue;
			paintBlot(g, b, t, d);
			if (b.fadeAt < 0 && t - b.born > b.life) settled = true;
		}
		// 淡完的抹掉
		for (let i = blots.length - 1; i >= 0; i--) {
			const b = blots[i];
			if (b.fadeAt >= 0 && t - b.fadeAt > FADE) {
				blots.splice(i, 1);
				settled = true;
			}
		}

		// ③ 正在写的字（压在纸上面）
		if (writing) {
			if (writing.from <= 0) writing.from = t;
			const u = clamp((t - writing.from) / writing.dur, 0, 1);
			writeChar(g, writing.ch, writing.x, writing.y, {
				size: writing.size,
				progress: u,
				color: `rgb(${inkTriple(d).join(" ")})`,
				alpha: 0.95,
				halo: 1,
				dry: true,
			});
			if (u >= 1) {
				written.push({
					ch: writing.ch,
					x: writing.x,
					y: writing.y,
					size: writing.size,
					alpha: 0.95,
				});
				writing = null;
				rebake();
			}
		}

		// ④ 浮现中的画
		for (const s of surfaced) {
			if (s.born <= 0) {
				s.born = t;
				continue;
			}
			if (t - s.born < 1.5) {
				paintSurfaced(g, s, t, 0.92);
				continue;
			}
			// ⚠️ 亮完必须烘进纸。只在上面那 1.5 秒里现画的话，画会**自己消失** ——
			// 而 `rebake()` 原本只在"有墨沉下去"时才跑，于是"浮现一幅画"变成了"闪一下"。
			// （写字那条路早有这一步：u>=1 → push written + rebake。）
			if (s.baked) continue;
			const im = images.get(s.idx);
			// 图还没就绪就先不烘、也不标记，下一帧再试 —— 否则会烘出一块空白再定死。
			if (!im?.complete || !im.naturalWidth) continue;
			s.baked = true;
			rebake();
		}
		g.restore();

		// ⑤ 指针在纸上游走的墨影。正在拖墨线时不画 —— 手在滴墨，别再叠一层雾
		if (!dragging && d.px >= 0 && d.py > v.river && d.focus < 0.7 && !d.lite) {
			const r = Math.min(v.w, v.h) * 0.05;
			g.save();
			g.beginPath();
			g.rect(0, v.river, v.w, v.h - v.river);
			g.clip();
			const gg = g.createRadialGradient(d.px, d.py, 0, d.px, d.py, r);
			gg.addColorStop(0, `rgb(${inkTriple(d).join(" ")} / 0.05)`);
			gg.addColorStop(1, `rgb(${inkTriple(d).join(" ")} / 0)`);
			g.fillStyle = gg;
			g.fillRect(d.px - r, d.py - r, r * 2, r * 2);
			g.restore();
		}

		// ⑥ 收尾：把已经长定的烘进纸；超上限的挑老的淡出
		trimClock += dt;
		if (settled) {
			for (const b of blots)
				if (b.fadeAt < 0 && t - b.born > b.life) b.baked = false;
			rebake();
		}
		if (trimClock > 0.5) {
			trimClock = 0;
			trim();
		}
	}

	for (let i = 0; i < PAINTINGS.length; i++) preload(i);

	return {
		resize,
		draw,
		dot,
		trail,
		beginDrag(x: number, y: number) {
			dragging = true;
			lastTrail = { x, y };
		},
		endDrag() {
			dragging = false;
		},
		write,
		surface,
		writing: () => writing !== null,
		blotCount: () => blots.length,
		clear() {
			blots = [];
			written = [];
			surfaced = [];
			rebake();
		},
	};
}
