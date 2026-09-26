// 下位面：水墨丹青。
//
// 一块白宣纸。底部没有任何按钮 —— 只有角落一个二选一的模式开关
// （楷书汉字 / 水墨画面），**一切效果都在画布上点出来**：
//   ① 点一下   按当前模式触发：楷书模式在落点写一个字（真实笔顺，一笔一笔落）；
//              画面模式从落点向外**全屏**晕开一幅水墨（径向 reveal，像记忆从纸底醒来）
//   ② 泼墨     长按不放：炸开一团大的
//   ③ 墨线     按住拖：沿路径落下连续的墨点（**不是画笔** —— 线是"滴"出来的，不是描出来的）
//
// 两条工程底线：
//   · 已经沉下去的墨、写完的字、浮完的画，**全部烘进一张离屏"纸"**，每帧只贴一次图。
//     不这么做，纸上攒到几十团墨时每帧要重画几十条 72 点路径，必掉帧。
//   · 墨迹永久保留：不会自动消失、更没有一键清空。只有总量超上限时，最古老的那批
//     **缓慢**降低透明度，淡完才从纸上抹掉重烘 —— "可以一直玩"和"不会越玩越卡"是同一件事。

import { glyphLength, hasGlyph, writeChar } from "./brush-ink";
import { PAINTINGS } from "./data";
import { clamp, type Dual, lerp, type View } from "./state";

/** 「书写汉字」的池子。都在 `glyphs.ts` 里烘过笔顺。 */
const WRITE_POOL = [..."山水云风花雪灯影光墨梦鹤竹茶江剑星河尘归春秋舟"];

const MAX_BLOTS = 40;
const MAX_CHARS = 8;
/** 全屏水墨画同时在场最多两幅：第三幅来时最旧的那幅缓慢淡化让位 */
const MAX_PAINTINGS = 2;
/** 「缓慢淡化」：老旧墨迹退场要 ~2.6 秒，不是瞬删（瞬删像画面被挖掉一块） */
const FADE = 2.6;
/** 一幅水墨从落点晕满整幅要的时间（秒） */
const REVEAL = 2.4;

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
	/** 超上限后开始淡出的时刻，−1 = 没在淡 */
	fadeAt: number;
};
type Surfaced = {
	idx: number;
	/** 点击点：reveal 从这里向外晕开 */
	cx: number;
	cy: number;
	born: number;
	/** 晕满并烘进纸了没有 —— 见 `draw()` 的 ④。 */
	baked: boolean;
	/** 第三幅登场时开始淡出的时刻，−1 = 没在淡 */
	fadeAt: number;
};

export type InkWorld = {
	resize(view: View): void;
	draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number): void;
	dot(x: number, y: number, power: number): void;
	trail(x: number, y: number): void;
	beginDrag(x: number, y: number): void;
	endDrag(): void;
	/** 在 (x,y) 写一个字。抢不到（正在写）就返回 null；否则返回这个字，交给罗盘去落记忆点。 */
	write(x: number, y: number): string | null;
	/** 从 (x,y) 向外全屏晕开一幅水墨。 */
	surface(x: number, y: number): boolean;
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
	/** 离屏「晕」：全屏水墨画的径向 reveal 在这里做 mask，做完贴到主画布 */
	let wash: HTMLCanvasElement | null = null;
	let wg: CanvasRenderingContext2D | null = null;
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
		if (!wash) {
			wash = document.createElement("canvas");
			wg = wash.getContext("2d");
		}
		if (page.width !== w || page.height !== h) {
			page.width = w;
			page.height = h;
			for (const b of blots) b.baked = false;
		}
		if (wash.width !== w || wash.height !== h) {
			wash.width = w;
			wash.height = h;
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

	/** 把一幅水墨 cover 铺满宣纸区（river 以下整幅），居中裁边。 */
	function paintCover(
		g: CanvasRenderingContext2D,
		img: HTMLImageElement,
		alpha: number,
	) {
		const iw = img.naturalWidth;
		const ih = img.naturalHeight;
		if (!iw || !ih) return;
		const rw = view.w;
		const rh = view.h - view.river;
		const sc = Math.max(rw / iw, rh / ih);
		const dw = iw * sc;
		const dh = ih * sc;
		g.globalAlpha = clamp(alpha, 0, 1);
		g.drawImage(img, (rw - dw) / 2, view.river + (rh - dh) / 2, dw, dh);
		g.globalAlpha = 1;
	}

	/**
	 * 全屏晕染浮现：从点击点 (cx,cy) 向外径向 reveal，边缘带羽毛，像墨在纸上洇开。
	 * 先在离屏「晕」里 cover 铺图、用 destination-in 扣出圆晕，再整张贴上主画布 ——
	 * 每帧一次 drawImage，与半径无关。
	 */
	function paintWash(
		g: CanvasRenderingContext2D,
		s: Surfaced,
		t: number,
		cap: number,
	) {
		const img = images.get(s.idx);
		if (!img?.complete || !img.naturalWidth) return;
		// 正在淡出的旧画：整张画慢慢隐去（新画的晕染不受它影响）
		if (s.fadeAt >= 0) {
			const f = clamp(1 - (t - s.fadeAt) / FADE, 0, 1);
			paintCover(g, img, cap * f);
			return;
		}
		const u = clamp((t - s.born) / REVEAL, 0, 1);
		if (u >= 1 || !wg || !wash) {
			paintCover(g, img, cap);
			return;
		}
		const ease = u * u * (3 - 2 * u);
		// 盖住整幅需要的半径 = 到宣纸区四个角的最远距离
		let diag = 1;
		for (const [qx, qy] of [
			[0, view.river],
			[view.w, view.river],
			[0, view.h],
			[view.w, view.h],
		] as const) {
			diag = Math.max(diag, Math.hypot(qx - s.cx, qy - s.cy));
		}
		const r = Math.max(1, ease * diag);
		wg.setTransform(1, 0, 0, 1, 0, 0);
		wg.clearRect(0, 0, wash.width, wash.height);
		wg.scale(view.dpr, view.dpr);
		paintCover(wg, img, 1);
		wg.globalCompositeOperation = "destination-in";
		const rg = wg.createRadialGradient(s.cx, s.cy, r * 0.55, s.cx, s.cy, r);
		rg.addColorStop(0, "rgb(0 0 0 / 1)");
		rg.addColorStop(1, "rgb(0 0 0 / 0)");
		wg.fillStyle = rg;
		wg.fillRect(0, 0, view.w, view.h);
		wg.globalCompositeOperation = "source-over";
		g.save();
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.globalAlpha = cap;
		g.drawImage(wash, 0, 0);
		g.restore();
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
		// 画在最底层（记忆从纸底醒来），墨与字盖在它上面 —— 「已写汉字可被新墨迹覆盖」
		for (const s of surfaced) {
			if (s.fadeAt >= 0 || !s.baked) continue;
			const im = images.get(s.idx);
			if (im?.complete && im.naturalWidth) paintCover(pg, im, 0.92);
		}
		for (const b of blots) {
			// born<=0 = 还没在纸上落定（刚 push、第一帧还没跑），这种不能烘，否则会
			// 以"长定了"的样子直接定死
			if (b.fadeAt >= 0 || b.born <= 0) continue;
			paintBlot(pg, b, big, d);
			b.baked = true;
		}
		for (const w of written) {
			// 正在淡出的老字不烘回纸里：它只剩「当场画、越来越淡」这一条命
			if (w.fadeAt >= 0) continue;
			writeChar(pg, w.ch, w.x, w.y, {
				size: w.size,
				progress: 1,
				color: `rgb(${inkTriple(d).join(" ")})`,
				alpha: w.alpha,
				halo: 1,
				dry: true,
			});
		}
	}

	/** 超上限：挑最老的开始淡出（**不是瞬删** —— 瞬删会像画面被挖掉一块）。
	 *  墨点、字、画一视同仁：先标 `fadeAt`，淡出期间当场画、不进烘，淡完再抹掉重烘。 */
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
			const n = written.length - MAX_CHARS;
			for (let i = 0; i < n; i++) {
				const w = written[i];
				if (w.fadeAt < 0) {
					w.fadeAt = d.now;
					changed = true;
				}
			}
		}
		if (surfaced.length > MAX_PAINTINGS) {
			const n = surfaced.length - MAX_PAINTINGS;
			for (let i = 0; i < n; i++) {
				const s = surfaced[i];
				if (s.fadeAt < 0) {
					s.fadeAt = d.now;
					changed = true;
				}
			}
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

	function write(x: number, y: number): string | null {
		if (writing) return null;
		const pool = WRITE_POOL.filter(hasGlyph);
		if (!pool.length) return null;
		const ch = pool[Math.floor(rnd() * pool.length)] ?? "山";
		const size =
			clamp((view.h - view.river) * 0.3, 88, 320) * (0.9 + rnd() * 0.2);
		// 字心在点击处，但整字（含洇开的晕）不许越出纸面
		writing = {
			ch,
			x: clamp(x, size * 0.62, view.w - size * 0.62),
			y: clamp(y, view.river + size * 0.68, view.h - size * 0.6),
			size,
			from: 0,
			dur: clamp(glyphLength(ch) * 0.42, 1.1, 3.2),
		};
		return ch;
	}

	function surface(x: number, y: number): boolean {
		const used = new Set(surfaced.map((s) => s.idx));
		const free = PAINTINGS.map((_, i) => i).filter((i) => !used.has(i));
		if (!free.length) return false;
		const idx = free[Math.floor(rnd() * free.length)] ?? 0;
		surfaced.push({
			idx,
			cx: clamp(x, 0, view.w),
			cy: clamp(y, view.river, view.h),
			born: 0,
			baked: false,
			fadeAt: -1,
		});
		// 同时在场最多两幅：第三幅登场，最旧的缓慢淡化让位（不是瞬删）
		const d = ref;
		if (d && surfaced.length > MAX_PAINTINGS) {
			const n = surfaced.length - MAX_PAINTINGS;
			for (let i = 0; i < n; i++) {
				if (surfaced[i].fadeAt < 0) surfaced[i].fadeAt = d.now;
			}
			rebake();
		}
		// 落点先聚一颗墨，画从这颗墨里晕开 —— 仪式感来自"先有墨、再有画"
		dot(x, y, 0.8);
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
				s.cx *= sx;
				s.cy *= sy;
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
			// ⚠️ 必须裁到河以下：page 是整张画布大小的位图，里面烘的内容只在「当时」的
			// 纸面区域。进了寰宇（河涨到 0.86h）不裁的话，烘进去的墨与画会整片压到
			// 星空上 —— 局部小图时看不出来，全屏水墨画让这条变成「满屏穿帮」。
			g.beginPath();
			g.rect(0, (v.river - 2) * v.dpr, page.width, page.height);
			g.clip();
			g.drawImage(page, 0, 0);
			g.restore();
		}

		g.save();
		g.beginPath();
		g.rect(0, v.river - 2, v.w, v.h - v.river + 2);
		g.clip();

		let settled = false;
		// ② 浮现中 / 正在淡出的画：先画，压在墨与字的下面（记忆从纸底醒来）
		for (const s of surfaced) {
			if (s.born <= 0) {
				s.born = t;
				continue;
			}
			if (s.fadeAt < 0 && !s.baked) {
				paintWash(g, s, t, 0.92);
				// ⚠️ 晕满必须烘进纸。只在 REVEAL 这几秒里现画的话，画会**自己消失** ——
				// 而 `rebake()` 原本只在"有墨沉下去"时才跑，于是"浮现一幅画"变成了"闪一下"。
				if (t - s.born >= REVEAL) {
					const im = images.get(s.idx);
					// 图还没就绪就先不烘、也不标记，下一帧再试 —— 否则会烘出一块空白再定死。
					if (im?.complete && im.naturalWidth) {
						s.baked = true;
						rebake();
					}
				}
				continue;
			}
			if (s.fadeAt >= 0) paintWash(g, s, t, 0.92);
		}
		// 淡完的旧画抹掉
		for (let i = surfaced.length - 1; i >= 0; i--) {
			const s = surfaced[i];
			if (s.fadeAt >= 0 && t - s.fadeAt > FADE) {
				surfaced.splice(i, 1);
				settled = true;
			}
		}

		// ③ 还在长 / 还在淡的墨：当场画
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

		// ④ 正在写的字（压在纸上面）
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
					fadeAt: -1,
				});
				writing = null;
				rebake();
			}
		}

		// ⑤ 正在淡出的老字：不进烘，只剩当场画这一条命，越来越淡
		for (const w of written) {
			if (w.fadeAt < 0) continue;
			const f = clamp(1 - (t - w.fadeAt) / FADE, 0, 1);
			writeChar(g, w.ch, w.x, w.y, {
				size: w.size,
				progress: 1,
				color: `rgb(${inkTriple(d).join(" ")})`,
				alpha: w.alpha * f,
				halo: 1,
				dry: true,
			});
		}
		// 淡完的老字抹掉
		for (let i = written.length - 1; i >= 0; i--) {
			const w = written[i];
			if (w.fadeAt >= 0 && t - w.fadeAt > FADE) {
				written.splice(i, 1);
				settled = true;
			}
		}
		g.restore();

		// ⑥ 指针在纸上游走的墨影。正在拖墨线时不画 —— 手在滴墨，别再叠一层雾
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

		// ⑦ 收尾：把已经长定的烘进纸；超上限的挑老的淡出
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
