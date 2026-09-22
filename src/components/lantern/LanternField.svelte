<script lang="ts">
import { onMount } from "svelte";
import {
	KIND_GLOW,
	LANTERNS,
	MOON_HINT,
	MOON_LABEL,
	MOON_OFFSET,
	type MoonPhase,
} from "./lanterns";

let fieldEl: HTMLElement | undefined = $state();
let fxEl: HTMLCanvasElement | undefined = $state();

let hoverIndex = $state<number | null>(null);
let tappedIndex = $state<number | null>(null);
let cardX = $state(0);
let cardY = $state(0);
let moon = $state<MoonPhase>("new");

// 位置每帧直接写进 DOM，不进响应式状态 —— 13 个节点每帧过一遍 diff 不值当。
type Node = { x: number; y: number; vx: number; vy: number; ph: number };
let nodes: Node[] = [];
let els: HTMLElement[] = [];

let w = 0;
let h = 0;
let size = 68;
let minDist = 100;

/** 信息卡按顶边钉在场地顶部这条横带上（横向仍跟着灯走） */
const CARD_TOP = 6;
/** 卡片高度预算，只用来算场地上沿要给它留多少空 */
const CARD_H = 104;

/**
 * 场地上沿的留白：卡高 + 半个灯 + 一道缝。只有能悬停的设备才要留 ——
 * 触屏压根不弹卡，留了就是白丢一片湖面。
 */
function topPad() {
	return canHover ? CARD_H + size * 0.5 + 14 : size * 0.95;
}

let canHover = true;
let reduce = false;
let raf = 0;
let last = 0;
let lastActivity = 0;
let layoutPending = true;
let flashTimer = 0;
let fullTimer = 0;

/* ------------------------------------------------------------ 烟花 */

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	r: number;
	/** 线的颜色下标（几种暖金，别搞成彩虹） */
	t: number;
};
let parts: Particle[] = [];
let fxRaf = 0;
let tail = 0;
let cw = 0;
let ch = 0;
let originY = 0;
let sprite: HTMLCanvasElement | null = null;

/** 烟花只有这几种暖金：香槟／足金／琥珀 */
const TINTS = ["#fff0cd", "#ffdb9b", "#ffc179"];

function makeSprite() {
	const c = document.createElement("canvas");
	c.width = 64;
	c.height = 64;
	const g = c.getContext("2d");
	if (!g) return null;
	const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grd.addColorStop(0, "rgba(255,244,214,1)");
	grd.addColorStop(0.32, "rgba(255,216,132,0.62)");
	grd.addColorStop(1, "rgba(255,190,96,0)");
	g.fillStyle = grd;
	g.fillRect(0, 0, 64, 64);
	return c;
}

function sizeCanvas() {
	const c = fxEl;
	if (!c) return;
	const r = c.getBoundingClientRect();
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	cw = r.width;
	ch = r.height;
	c.width = Math.max(1, Math.round(cw * dpr));
	c.height = Math.max(1, Math.round(ch * dpr));
	const g = c.getContext("2d");
	if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame() {
	fxRaf = 0;
	const c = fxEl;
	const g = c?.getContext("2d");
	if (!c || !g) return;

	g.globalCompositeOperation = "destination-out";
	g.fillStyle = "rgba(0,0,0,0.15)";
	g.fillRect(0, 0, cw, ch);

	const dt = 1 / 60;
	g.globalCompositeOperation = "lighter";
	g.lineCap = "round";
	for (const p of parts) {
		p.life -= dt;
		if (p.life <= 0) continue;
		p.vy += 96 * dt;
		const drag = 1 - 1.05 * dt;
		p.vx *= drag;
		p.vy *= drag;
		p.x += p.vx * dt;
		p.y += p.vy * dt;

		const k = Math.max(0, p.life / p.max);
		const a = k * k;
		// 细金线：尾巴长度跟着当前速度走，飞得越快拖得越长
		const tx = p.x - p.vx * 0.075;
		const ty = p.y - p.vy * 0.075;
		// 水面倒影：以爆点那条水平线镜像，亮度压到五分之一
		const ry = originY * 2 - p.y;
		const rty = originY * 2 - ty;

		g.strokeStyle = TINTS[p.t];
		g.globalAlpha = a * 0.78;
		g.lineWidth = 0.9 + k * 1.1;
		g.beginPath();
		g.moveTo(p.x, p.y);
		g.lineTo(tx, ty);
		g.stroke();

		g.globalAlpha = a * 0.15;
		g.beginPath();
		g.moveTo(p.x, ry);
		g.lineTo(tx, rty);
		g.stroke();

		if (sprite) {
			const s = p.r * (0.4 + k * 0.7);
			g.globalAlpha = a;
			g.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2);
			g.globalAlpha = a * 0.14;
			g.drawImage(sprite, p.x - s, ry - s, s * 2, s * 2);
		}
	}
	g.globalAlpha = 1;

	parts = parts.filter((p) => p.life > 0);
	if (parts.length > 0) {
		fxRaf = requestAnimationFrame(frame);
	} else if (tail > 0) {
		tail -= 1;
		fxRaf = requestAnimationFrame(frame);
	} else {
		g.globalCompositeOperation = "source-over";
		g.clearRect(0, 0, cw, ch);
	}
}

function burst(cx: number, cy: number) {
	if (reduce) return;
	if (parts.length === 0 && fxRaf === 0) sizeCanvas();
	originY = cy;
	tail = 16;
	// 细金线那种烟花：线多、点小、初速低一点，散开才像抽出来的丝
	const count = 76;
	for (let i = 0; i < count; i++) {
		const ang = (i / count) * Math.PI * 2 + Math.random() * 0.3;
		const spd = 76 + Math.random() * 198;
		// max 必须等于自己的寿命：写死成 1.1 会让短寿命粒子一出生就只有
		// 一半亮度（k = life/max < 1），整簇看着就是"没炸开"
		const life = 0.62 + Math.random() * 0.7;
		parts.push({
			x: cx,
			y: cy,
			vx: Math.cos(ang) * spd,
			vy: Math.sin(ang) * spd - 26,
			life,
			max: life,
			r: 1.1 + Math.random() * 1.5,
			t: Math.random() < 0.24 ? 1 + ((Math.random() * 2) | 0) : 0,
		});
	}
	if (!fxRaf) fxRaf = requestAnimationFrame(frame);
}

/* ------------------------------------------------------------ 月相 */

function setMoon(p: MoonPhase) {
	if (moon === p) return;
	moon = p;
	if (flashTimer) clearTimeout(flashTimer);
	if (fullTimer) clearTimeout(fullTimer);
	if (p === "full") {
		fullTimer = window.setTimeout(() => {
			if (moon !== "full") return;
			moon = performance.now() - lastActivity > 8000 ? "waning" : "waxing";
		}, 5200);
	}
}

function touch() {
	lastActivity = performance.now();
	if (moon === "new" || moon === "waning") setMoon("waxing");
}

/* ------------------------------------------------------------ 布局 */

function place(i: number, fresh: boolean) {
	const n = nodes[i];
	if (!n) return;
	const padX = size * 0.7;
	const padTop = topPad();
	const padBottom = size * 0.75;
	n.x = Math.min(Math.max(n.x, padX), Math.max(padX, w - padX));
	n.y = Math.min(Math.max(n.y, padTop), Math.max(padTop, h - padBottom));
	if (fresh && els[i]) {
		els[i].style.transform =
			`translate3d(${n.x - size / 2}px, ${n.y - size / 2}px, 0)`;
	}
}

function seed() {
	const count = LANTERNS.length;
	const padX = size * 0.8;
	const padTop = topPad();
	const spanX = Math.max(size, w - padX * 2);
	const spanY = Math.max(size, h - padTop - size * 0.8);
	const cols = Math.max(
		2,
		Math.round(Math.sqrt((count * spanX) / Math.max(1, spanY))),
	);
	const rows = Math.ceil(count / cols);
	for (let i = 0; i < count; i++) {
		const c = i % cols;
		const r = Math.floor(i / cols);
		const prev = nodes[i];
		const jx = ((i * 37) % 11) / 11 - 0.5;
		const jy = ((i * 53) % 13) / 13 - 0.5;
		const x = padX + ((c + 0.5 + jx * 0.62) / cols) * spanX;
		const y = padTop + ((r + 0.5 + jy * 0.62) / rows) * spanY;
		if (prev) {
			prev.x = Math.min(Math.max(x, padX), w - padX);
			prev.y = Math.min(Math.max(y, padTop), h - size * 0.8);
		} else {
			nodes[i] = {
				x: Math.min(Math.max(x, padX), w - padX),
				y: Math.min(Math.max(y, padTop), h - size * 0.8),
				vx: 0,
				vy: 0,
				ph: i * 1.37,
			};
		}
	}
}

function layout() {
	const el = fieldEl;
	if (!el) return;
	const r = el.getBoundingClientRect();
	if (r.width < 40 || r.height < 40) return;
	w = r.width;
	h = r.height;
	size = Math.max(42, Math.min(84, Math.round(w / 15.5)));
	minDist = size * 1.44;
	el.style.setProperty("--lantern-size", `${size}px`);
	sizeCanvas();
	// 只有第一次（或灯数变了）才重新铺阵；单纯尺寸变化只把灯收回界内，
	// 否则用户一拉窗口，满湖的灯就全跳一次位置。
	if (nodes.length !== LANTERNS.length) seed();
	for (let i = 0; i < nodes.length; i++) place(i, true);
}

/* ------------------------------------------------------------ 主循环 */

function tick(now: number) {
	raf = requestAnimationFrame(tick);
	const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
	last = now;

	if (now - lastActivity > 8000 && moon !== "waning" && moon !== "new") {
		if (fullTimer) clearTimeout(fullTimer);
		moon = "waning";
	}

	const t = now / 1000;
	const frozen = canHover ? hoverIndex : null;

	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		if (i === frozen) {
			n.vx = 0;
			n.vy = 0;
			continue;
		}
		// 缓慢游荡：两个不同频率的正弦当作风与暗流。
		// 纵向压得比横向小得多 —— 灯是浮在水上的，主要该在水面平移
		n.vx += Math.cos(t * 0.21 + n.ph) * 7.2 * dt;
		n.vy += Math.sin(t * 0.163 + n.ph * 1.7) * 2.6 * dt;
		const damp = 1 - 0.55 * dt;
		n.vx *= damp;
		n.vy *= damp;
		n.x += n.vx * dt;
		n.y += n.vy * dt;
	}

	// 互斥：13 盏灯，78 对，直接两两算最省事
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i];
			const b = nodes[j];
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			let d = Math.hypot(dx, dy);
			if (d >= minDist) continue;
			if (d < 0.5) {
				dx = 1;
				dy = 0;
				d = 1;
			}
			const push = ((minDist - d) / minDist) * 130 * dt;
			dx /= d;
			dy /= d;
			const ia = i === frozen ? 0 : 1;
			const ib = j === frozen ? 0 : 1;
			a.vx -= dx * push * ia * 2;
			a.vy -= dy * push * ia * 2;
			b.vx += dx * push * ib * 2;
			b.vy += dy * push * ib * 2;
		}
	}

	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		const padX = size * 0.62;
		const padTop = topPad();
		const padBottom = size * 0.68;
		if (n.x < padX) {
			n.x = padX;
			n.vx = Math.abs(n.vx) * 0.5;
		} else if (n.x > w - padX) {
			n.x = w - padX;
			n.vx = -Math.abs(n.vx) * 0.5;
		}
		if (n.y < padTop) {
			n.y = padTop;
			n.vy = Math.abs(n.vy) * 0.5;
		} else if (n.y > h - padBottom) {
			n.y = h - padBottom;
			n.vy = -Math.abs(n.vy) * 0.5;
		}
		const el = els[i];
		if (!el) continue;
		const bob = Math.sin(t * 0.72 + n.ph * 1.4) * size * 0.045;
		el.style.transform = `translate3d(${n.x - size / 2}px, ${n.y - size / 2 + bob}px, 0)`;
	}
}

/* ------------------------------------------------------------ 交互 */

function open(i: number) {
	if (!canHover) return;
	const n = nodes[i];
	const el = els[i];
	if (!n || !el) return;
	const cardW = Math.min(268, Math.max(196, w * 0.24));
	const half = cardW / 2 + 8;
	cardX = Math.min(Math.max(n.x, half), Math.max(half, w - half));
	// 卡钉死在场地顶部：跟着灯走的话，上排的卡会顶出场地压到开场文案，
	// 下排的卡又会盖住上排的灯 —— 钉在带上就谁也撞不着。
	cardY = CARD_TOP;
	hoverIndex = i;
}

function close() {
	hoverIndex = null;
}

function tap(i: number) {
	touch();
	setMoon("full");
	tappedIndex = i;
	if (flashTimer) clearTimeout(flashTimer);
	flashTimer = window.setTimeout(() => {
		if (tappedIndex === i) tappedIndex = null;
	}, 560);
	// 烟花要「在花灯正上方炸开」，所以抬到灯顶以上；倒影再以这条线镜像回来
	const n = nodes[i];
	if (n) burst(n.x, Math.max(12, n.y - size * 0.72));
}

onMount(() => {
	canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
	reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	lastActivity = performance.now();
	sprite = makeSprite();

	els = Array.from(
		fieldEl?.querySelectorAll<HTMLElement>("[data-lantern]") ?? [],
	);

	const ro = new ResizeObserver(() => {
		layoutPending = true;
	});
	if (fieldEl) ro.observe(fieldEl);
	window.addEventListener("resize", onWin);
	window.addEventListener("pointermove", touch, { passive: true });
	window.addEventListener("pointerdown", touch, { passive: true });
	window.addEventListener("scroll", touch, { passive: true });

	layout();
	layoutPending = false;
	last = performance.now();

	if (!reduce) {
		raf = requestAnimationFrame(tick);
	} else {
		// 降级：不动画，直接把灯摆到初始位
		for (let i = 0; i < els.length; i++) place(i, true);
	}

	return () => {
		cancelAnimationFrame(raf);
		cancelAnimationFrame(fxRaf);
		ro.disconnect();
		window.removeEventListener("resize", onWin);
		window.removeEventListener("pointermove", touch);
		window.removeEventListener("pointerdown", touch);
		window.removeEventListener("scroll", touch);
		if (flashTimer) clearTimeout(flashTimer);
		if (fullTimer) clearTimeout(fullTimer);
	};
});

function onWin() {
	layoutPending = true;
}

// 元素尺寸变化（字体加载、旋转屏幕）后的补一次布局
$effect(() => {
	if (!fieldEl) return;
	const id = window.setInterval(() => {
		if (!layoutPending) return;
		layoutPending = false;
		layout();
	}, 240);
	return () => clearInterval(id);
});

const moonOffset = $derived(MOON_OFFSET[moon]);
</script>

<div class="lantern-field" bind:this={fieldEl} data-moon={moon}>
	<canvas class="lantern-fx" bind:this={fxEl} aria-hidden="true"></canvas>

	<!-- 四型灯具只定义一份，13 盏灯靠 <use> 取；倒影取的是同一个形体，关于水线镜射再压扁。
	     ⚠️ <use> 的 shadow tree 里选不中 class，所以这些形体的颜色只能写成属性（或用 var()）。 -->
	<svg class="lantern-defs" aria-hidden="true" focusable="false">
		<defs>
			<!-- 纸色：中心近白，向外收成各型的本色 -->
			<radialGradient id="lp-fish" cx="50%" cy="46%" r="66%">
				<stop offset="0%" stop-color="#fffaf0" />
				<stop offset="44%" stop-color="#ffe6bd" />
				<stop offset="100%" stop-color="#efb474" />
			</radialGradient>
			<radialGradient id="lp-shell" cx="50%" cy="48%" r="64%">
				<stop offset="0%" stop-color="#fbfeff" />
				<stop offset="46%" stop-color="#dff3ee" />
				<stop offset="100%" stop-color="#a6d5cb" />
			</radialGradient>
			<radialGradient id="lp-jelly" cx="50%" cy="48%" r="64%">
				<stop offset="0%" stop-color="#fdfbff" />
				<stop offset="46%" stop-color="#ece0ff" />
				<stop offset="100%" stop-color="#bda3e2" />
			</radialGradient>
			<radialGradient id="lp-star" cx="50%" cy="50%" r="62%">
				<stop offset="0%" stop-color="#fdfef7" />
				<stop offset="46%" stop-color="#e8f6d6" />
				<stop offset="100%" stop-color="#b3d693" />
			</radialGradient>
			<!-- 灯芯：白热的一点，向外化开 -->
			<radialGradient id="lp-core">
				<stop offset="0%" stop-color="#fffdf7" stop-opacity=".95" />
				<stop offset="40%" stop-color="#ffe2ab" stop-opacity=".5" />
				<stop offset="100%" stop-color="#ffc674" stop-opacity="0" />
			</radialGradient>
			<!-- 倒影越深越暗。用 mask 而不是盖一块暗矩形：盖矩形会在水面上留下一个方框边。
			     ⚠️ mask 的坐标系是**引用它的那个元素的**坐标系，也就是倒影已经被
			     translate(0 147.4) scale(1 -0.62) 折过的那套 —— 别按屏幕坐标写 rect。
			     形体底边 y=92 折完落在屏幕水线上（147.4-0.62*92≈90.4），所以要 fade 走的是
			     y 92 → 12 这一段，方向还是从上往下。 -->
			<linearGradient id="lp-fade" gradientUnits="userSpaceOnUse" x1="0" y1="92" x2="0" y2="12">
				<stop offset="0%" stop-color="#ffffff" stop-opacity=".9" />
				<stop offset="55%" stop-color="#ffffff" stop-opacity=".34" />
				<stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
			</linearGradient>
			<mask id="lp-sink" maskUnits="userSpaceOnUse" x="-12" y="0" width="124" height="100">
				<rect x="-12" y="0" width="124" height="100" fill="url(#lp-fade)" />
			</mask>

			<!-- 小鱼花灯：扁胖金鱼，尾鳍分叉，身上三道鳞弧 -->
			<g id="lb-fish">
				<circle cx="50" cy="56" r="19" fill="url(#lp-core)" />
				<path
					d="M74 56c9-12 18-18 23-20-5 11-5 27 0 40-5-2-14-8-23-20Z"
					fill="url(#lp-fish)"
					fill-opacity=".8"
					stroke="#efd6a4"
					stroke-opacity=".46"
					stroke-width=".8"
					stroke-linejoin="round"
				/>
				<path
					d="M42 33c4-9 13-13 20-13-4 6-6 11-7 16Z"
					fill="url(#lp-fish)"
					fill-opacity=".72"
					stroke="#efd6a4"
					stroke-opacity=".42"
					stroke-width=".7"
					stroke-linejoin="round"
				/>
				<path
					d="M44 78c4 8 12 12 19 11-5-5-7-9-8-13Z"
					fill="url(#lp-fish)"
					fill-opacity=".68"
					stroke="#efd6a4"
					stroke-opacity=".4"
					stroke-width=".7"
					stroke-linejoin="round"
				/>
				<path
					d="M18 58c0-16 14-26 30-26 14 0 24 7 29 16 2 4 2 12-1 17-6 9-16 14-29 14-16 0-29-5-29-21Z"
					fill="url(#lp-fish)"
					fill-opacity=".9"
					stroke="#f2dcae"
					stroke-opacity=".66"
					stroke-width=".9"
					stroke-linejoin="round"
				/>
				<path
					d="M30 62c6 2 12 0 16-4-4 10-10 14-16 12Z"
					fill="url(#lp-fish)"
					fill-opacity=".6"
					stroke="#efd6a4"
					stroke-opacity=".38"
					stroke-width=".6"
					stroke-linejoin="round"
				/>
				<path
					d="M40 46c7-3 15-3 22 0M40 55c8-3 17-3 25 1M42 64c7-3 15-3 22 0"
					fill="none"
					stroke="#fff6e2"
					stroke-opacity=".4"
					stroke-width=".7"
					stroke-linecap="round"
				/>
				<circle
					cx="29"
					cy="50"
					r="3.1"
					fill="none"
					stroke="#f6dfae"
					stroke-opacity=".78"
					stroke-width=".8"
				/>
				<circle cx="29" cy="50" r="1.3" fill="#8a6021" fill-opacity=".8" />
				<circle cx="46" cy="54" r="9" fill="url(#lp-core)" fill-opacity=".8" />
			</g>

			<!-- 贝壳花灯：扇面开合，中央一盏莲灯 -->
			<g id="lb-shell">
				<circle cx="50" cy="60" r="20" fill="url(#lp-core)" />
				<path
					d="M50 30C32 30 18 44 18 58c0 14 12 26 32 26s32-12 32-26c0-14-14-28-32-28Z"
					fill="url(#lp-shell)"
					fill-opacity=".86"
					stroke="#f0dcae"
					stroke-opacity=".6"
					stroke-width=".9"
					stroke-linejoin="round"
				/>
				<path
					d="M50 84 26 47M50 84 38 35M50 83V31M50 84 62 35M50 84 74 47"
					fill="none"
					stroke="#fff6e2"
					stroke-opacity=".32"
					stroke-width=".7"
					stroke-linecap="round"
				/>
				<path d="M22 66c11-6 45-6 56 0" fill="none" stroke="#fff6e2" stroke-opacity=".28" stroke-width=".7" />
				<path
					d="M38 56c-4 6-4 13 0 17 3 2 5 0 6-2-2-6-4-10-6-15Z"
					fill="#fdfaf2"
					fill-opacity=".72"
					stroke="#f2d8a2"
					stroke-opacity=".5"
					stroke-width=".7"
					stroke-linejoin="round"
				/>
				<path
					d="M62 56c4 6 4 13 0 17-3 2-5 0-6-2 2-6 4-10 6-15Z"
					fill="#fdfaf2"
					fill-opacity=".72"
					stroke="#f2d8a2"
					stroke-opacity=".5"
					stroke-width=".7"
					stroke-linejoin="round"
				/>
				<path
					d="M50 46c-6 8-8 16-3 22 3 3 5 3 6 0 5-6 3-14-3-22Z"
					fill="#fffaf0"
					fill-opacity=".9"
					stroke="#f2d8a2"
					stroke-opacity=".6"
					stroke-width=".8"
					stroke-linejoin="round"
				/>
				<circle cx="50" cy="63" r="8" fill="url(#lp-core)" />
			</g>

			<!-- 水母花灯：钟罩带裙边，触须一路垂到水里 -->
			<g id="lb-jelly">
				<circle cx="50" cy="52" r="19" fill="url(#lp-core)" />
				<path
					d="M32 66c1 10 4 16 1 25M41 70c3 10 0 16 3 25M50 71c-1 10 2 16 0 25M59 70c-2 10 1 16-2 25M68 66c-1 10-4 16-1 25"
					fill="none"
					stroke="#e6d9f8"
					stroke-opacity=".42"
					stroke-width=".9"
					stroke-linecap="round"
				/>
				<path
					d="M20 60c0-22 14-36 30-36s30 14 30 36c0 5-4 7-8 5-4-2-8 2-12 4-4 2-8-2-12 0-4 2-8 1-12-1-4-2-16 0-16-8Z"
					fill="url(#lp-jelly)"
					fill-opacity=".8"
					stroke="#efe2ff"
					stroke-opacity=".56"
					stroke-width=".9"
					stroke-linejoin="round"
				/>
				<path
					d="M28 56c2-14 11-22 22-22s20 8 22 22"
					fill="none"
					stroke="#fff6ff"
					stroke-opacity=".32"
					stroke-width=".7"
				/>
				<circle cx="50" cy="54" r="8" fill="url(#lp-core)" fill-opacity=".85" />
			</g>

			<!-- 海星花灯：五角撑住，中心一道同心轮廓与四根辐线 -->
			<g id="lb-star">
				<circle cx="50" cy="55" r="21" fill="url(#lp-core)" />
				<path
					d="M50 20c4 0 6 3 7 6l4 13 13-4c3-1 6 1 5 4l-6 12 10 10c2 2 1 6-2 6l-14 1-2 14c0 3-4 4-6 2l-9-10-9 10c-2 2-6 1-6-2l-2-14-14-1c-3 0-4-4-2-6l10-10-6-12c-1-3 2-5 5-4l13 4 4-13c1-3 3-6 7-6Z"
					fill="url(#lp-star)"
					fill-opacity=".84"
					stroke="#f0dcae"
					stroke-opacity=".6"
					stroke-width=".9"
					stroke-linejoin="round"
				/>
				<path
					d="M50 20c4 0 6 3 7 6l4 13 13-4c3-1 6 1 5 4l-6 12 10 10c2 2 1 6-2 6l-14 1-2 14c0 3-4 4-6 2l-9-10-9 10c-2 2-6 1-6-2l-2-14-14-1c-3 0-4-4-2-6l10-10-6-12c-1-3 2-5 5-4l13 4 4-13c1-3 3-6 7-6Z"
					transform="translate(50 55) scale(.6) translate(-50 -55)"
					fill="none"
					stroke="#fff6e2"
					stroke-opacity=".34"
					stroke-width="1.2"
				/>
				<path
					d="M50 38v34M32 55h36M38 43l24 24M62 43l-24 24"
					fill="none"
					stroke="#fff6e2"
					stroke-opacity=".24"
					stroke-width=".7"
				/>
				<path
					d="M36 49c4-2 8-1 10 2M54 49c3-3 8-3 11 0"
					fill="none"
					stroke="#fff6e2"
					stroke-opacity=".32"
					stroke-width=".7"
					stroke-linecap="round"
				/>
				<circle cx="50" cy="55" r="7" fill="url(#lp-core)" />
			</g>

			<!-- 灯底那圈水：亮面 + 压出的波纹环 -->
			<g id="lb-water">
				<ellipse cx="50" cy="91" rx="26" ry="4" fill="#ffd696" fill-opacity=".14" />
				<path
					d="M28 91.4Q50 86.6 72 91.4"
					fill="none"
					stroke="#fff0d6"
					stroke-opacity=".5"
					stroke-width=".8"
				/>
				<ellipse
					cx="50"
					cy="93.5"
					rx="33"
					ry="5.4"
					fill="none"
					stroke="#d6e8ff"
					stroke-opacity=".15"
					stroke-width=".7"
				/>
			</g>
		</defs>
	</svg>

	{#each LANTERNS as l, i (l.url)}
		<a
			class="lantern"
			data-lantern
			data-kind={l.kind}
			class:is-hover={hoverIndex === i}
			class:is-tapped={tappedIndex === i}
			style="--glow:{KIND_GLOW[l.kind]};--i:{i}"
			href={l.url}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`${l.name} · ${l.epithet}（新标签页打开）`}
			onmouseenter={() => open(i)}
			onmouseleave={close}
			onfocus={() => open(i)}
			onblur={close}
			onclick={() => tap(i)}
		>
			<span class="lantern-pool" aria-hidden="true"></span>
			<span class="lantern-glow" aria-hidden="true"></span>
			<span class="lantern-body" aria-hidden="true">
				<svg viewBox="0 0 100 100" role="presentation" focusable="false">
					<!-- 倒影：同一个形体关于水线（y≈91）镜射并压扁 —— 位移取 (1+k)·91（k=.78）。
					     压扁系数别太小：参考图里的倒影是一道又长又亮的痕，k=.62 只有短短一截。
					     再套一层由浅入深的 mask，免得在水面上留出一块方形暗斑 -->
					<use
						class="lb-mirror"
						href={`#lb-${l.kind}`}
						transform="translate(0 162) scale(1 -0.78)"
						mask="url(#lp-sink)"
					/>
					<use href={`#lb-${l.kind}`} />
					<use class="lb-water" href="#lb-water" />
				</svg>
			</span>
			<span class="lantern-ripple" aria-hidden="true"></span>
		</a>
	{/each}

	{#if hoverIndex !== null}
		{@const item = LANTERNS[hoverIndex]}
		<div
			class="lantern-card"
			style="left:{cardX}px; top:{cardY}px; --glow:{KIND_GLOW[item.kind]}"
			role="tooltip"
			aria-hidden="true"
		>
			<div class="lantern-card-top">
				<span class="lantern-card-name">{item.name}</span>
				{#if item.stars}
					<span class="lantern-card-stars">★ {item.stars}</span>
				{/if}
			</div>
			<p class="lantern-card-brief">{item.brief}</p>
			<div class="lantern-card-go">点击 → 新标签页打开</div>
		</div>
	{/if}

	<div class="lantern-moon" data-phase={moon} role="img" aria-label={`当前月相：${MOON_LABEL[moon]}`}>
		<svg viewBox="0 0 64 64" aria-hidden="true">
			<defs>
				<radialGradient id="lantern-moon-lit" cx="38%" cy="34%" r="74%">
					<stop offset="0%" stop-color="#fdfdff" />
					<stop offset="58%" stop-color="#e2ecff" />
					<stop offset="100%" stop-color="#b9cdf0" />
				</radialGradient>
				<!-- 遮挡圆必须裁在月盘里：满月时它要错开两个半径（translateX 40），
				     不裁的话它会在夜空上显成一个和月亮并排的黑球。 -->
				<clipPath id="lantern-moon-cut">
					<circle cx="32" cy="32" r="20" />
				</clipPath>
			</defs>
			<circle class="lantern-moon-rim" cx="32" cy="32" r="20" />
			<circle class="lantern-moon-lit" cx="32" cy="32" r="20" fill="url(#lantern-moon-lit)" />
			<g clip-path="url(#lantern-moon-cut)">
				<circle
					class="lantern-moon-shadow"
					cx="32"
					cy="32"
					r="20"
					style="transform:translateX({moonOffset * 20}px)"
				/>
			</g>
		</svg>
		<span class="lantern-moon-hint">{MOON_HINT[moon]}</span>
	</div>
</div>

<style>
	.lantern-field {
		--lantern-size: 68px;
		--lum: 0.8;
		position: absolute;
		/* 只在湖面之上活动：下界留出底部渐隐带，上界压住正文/图例不与之打架；
		   矮屏时用 24rem 兜底，免得 52% 落得太高又叠到标题上。 */
		top: max(52%, 24rem);
		right: 0;
		bottom: 6%;
		left: 0;
		pointer-events: none;
		z-index: 3;
	}

	/* 月亮越亮，整湖灯越亮。四态各一档，过渡交给 .lantern 上的 filter transition */
	.lantern-field[data-moon="waxing"] {
		--lum: 1.02;
	}

	.lantern-field[data-moon="full"] {
		--lum: 1.18;
	}

	.lantern-field[data-moon="waning"] {
		--lum: 0.68;
	}

	.lantern-fx {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 4;
	}

	/* ---------------------------------------------------------- 花灯 */

	/* 灯具形状只此一份，不参与布局、不占尺寸 */
	.lantern-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.lantern {
		position: absolute;
		left: 0;
		top: 0;
		width: var(--lantern-size);
		height: var(--lantern-size);
		display: block;
		pointer-events: auto;
		-webkit-tap-highlight-color: transparent;
		filter: brightness(var(--lum));
		transition: filter 1.6s ease;
		will-change: transform;
	}

	/* 落在水面上的那摊光 */
	.lantern-pool {
		position: absolute;
		left: 50%;
		bottom: -18%;
		width: 200%;
		height: 46%;
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(
			closest-side,
			rgb(var(--glow) / 0.24) 0%,
			rgb(var(--glow) / 0.08) 50%,
			transparent 78%
		);
	}

	/* 纸透出来的柔光。半径要收住（放太大相邻两盏的光斑会交叠成"泡泡阵"），
	   但尾部必须一路衰减到真零 —— 在半路直接 transparent 会在暗水上留下一圈看得见的圆边 */
	.lantern-glow {
		position: absolute;
		inset: -26% -26% -16%;
		border-radius: 50%;
		background: radial-gradient(
			circle at 50% 46%,
			rgb(255 242 218 / 0.17) 0%,
			rgb(var(--glow) / 0.1) 30%,
			rgb(var(--glow) / 0.05) 55%,
			rgb(var(--glow) / 0.018) 78%,
			transparent 100%
		);
		transition: opacity 0.5s ease;
	}

	.lantern-body {
		position: absolute;
		inset: 0;
		display: block;
		transition: transform 0.5s cubic-bezier(0.22, 0.68, 0.32, 1);
	}

	.lantern-body svg {
		width: 100%;
		height: 100%;
		/* 倒影要画在 100×100 的框外，所以这里不能裁 */
		overflow: visible;
		filter: drop-shadow(0 0 7px rgb(255 206 140 / 0.4));
	}

	/* 倒影：压暗、轻糊，再随水波慢慢忽明忽暗（--i 让十三盏灯不同步）。
	   糊得多一点才像被水揉过，不然就是贴了张镜像图 */
	.lb-mirror {
		opacity: 0.55;
		filter: blur(1.3px);
		animation: lb-shimmer 4.6s ease-in-out infinite;
		animation-delay: calc(var(--i, 0) * -0.62s);
	}

	@keyframes lb-shimmer {
		0%,
		100% {
			opacity: 0.44;
		}
		50% {
			opacity: 0.68;
		}
	}

	/* 涟漪：只有悬停时才开始扩散（灯底压出的那圈水线常驻，见 #lb-water） */
	.lantern-ripple {
		position: absolute;
		left: 50%;
		bottom: -4%;
		width: 140%;
		aspect-ratio: 1 / 0.34;
		transform: translate(-50%, 0);
		opacity: 0;
	}

	.lantern-ripple::before,
	.lantern-ripple::after {
		content: "";
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1px solid rgb(255 236 206 / 0.42);
	}

	.lantern.is-hover .lantern-ripple {
		opacity: 1;
	}

	.lantern.is-hover .lantern-ripple::before {
		animation: lantern-ripple 2.2s ease-out infinite;
	}

	.lantern.is-hover .lantern-ripple::after {
		animation: lantern-ripple 2.2s ease-out 1.1s infinite;
	}

	@keyframes lantern-ripple {
		from {
			transform: scale(0.34);
			opacity: 0.72;
		}
		to {
			transform: scale(1.25);
			opacity: 0;
		}
	}

	/* 悬停：靠过去看一眼 —— 灯亮一档、水面那摊光收紧、涟漪开始扩，
	   不再用"抬起来 + 换色"那种跳法 */
	.lantern.is-hover .lantern-body {
		transform: translateY(-3px) scale(1.03);
	}

	.lantern.is-hover .lantern-glow {
		opacity: 1;
		transform: scale(1.1);
	}

	.lantern.is-hover .lantern-pool {
		transform: translateX(-50%) scale(1.08);
	}

	.lantern.is-hover {
		filter: brightness(calc(var(--lum) * 1.22));
	}

	.lantern.is-tapped .lantern-body svg {
		filter: drop-shadow(0 0 16px rgb(255 216 150 / 0.85)) brightness(1.35);
	}

	.lantern:focus-visible {
		outline: 1px solid rgb(240 220 180 / 0.6);
		outline-offset: 4px;
		border-radius: 50%;
	}

	/* ---------------------------------------------------------- 信息卡 */

	.lantern-card {
		position: absolute;
		width: min(258px, 62vw);
		/* 顶边锚定：卡片再长也只会往下长，不会顶出场地 */
		transform: translate(-50%, 0);
		padding: 0.78rem 0.9rem 0.62rem;
		border-radius: 10px;
		/* 一张克制的墨卡：冷白细边、没有彩色描边，颜色只从纸灯那边偷一点 */
		border: 1px solid rgb(216 228 248 / 0.14);
		background: rgb(9 14 24 / 0.62);
		backdrop-filter: blur(14px) saturate(1.05);
		box-shadow:
			0 18px 40px -20px rgb(0 0 0 / 0.75),
			inset 0 1px 0 rgb(255 246 226 / 0.08);
		color: rgb(236 242 252 / 0.9);
		pointer-events: none;
		z-index: 5;
		animation: lantern-card-in 0.26s ease-out both;
	}

	/* 只淡入：位移动画会和 data-side 的 transform 打架，也会让卡在入场时
	   先越过场地顶边一次 */
	@keyframes lantern-card-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.lantern-card-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.lantern-card-name {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.lantern-card-stars {
		font-size: 0.66rem;
		white-space: nowrap;
		letter-spacing: 0.04em;
		color: rgb(238 214 164 / 0.78);
	}

	.lantern-card-brief {
		margin: 0.4rem 0 0;
		font-size: 0.72rem;
		line-height: 1.7;
		color: rgb(212 224 242 / 0.66);
	}

	.lantern-card-go {
		margin-top: 0.46rem;
		padding-top: 0.36rem;
		border-top: 1px solid rgb(255 255 255 / 0.07);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		color: rgb(206 220 240 / 0.4);
	}

	/* ---------------------------------------------------------- 月相 */

	.lantern-moon {
		position: fixed;
		top: clamp(4.6rem, 9vh, 7rem);
		right: clamp(1rem, 3.4vw, 2.8rem);
		width: clamp(52px, 6vw, 74px);
		pointer-events: none;
		z-index: 20;
		transition: opacity 1.2s ease;
	}

	.lantern-moon svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}

	.lantern-moon-rim {
		fill: rgb(240 246 255 / 0.08);
		/* 一圈极淡的金边：跟湖面上的纸灯是同一套材质 */
		stroke: rgb(232 202 148 / 0.42);
		stroke-width: 1;
	}

	.lantern-moon-lit {
		filter: drop-shadow(0 0 18px rgb(226 236 255 / 0.42));
	}

	/* 光晕跟着月相收放：被遮住的月盘不该还亮着一圈 */
	.lantern-moon[data-phase="new"] .lantern-moon-lit {
		filter: drop-shadow(0 0 7px rgb(214 230 255 / 0.14));
	}

	.lantern-moon[data-phase="waning"] .lantern-moon-lit {
		filter: drop-shadow(0 0 11px rgb(220 234 255 / 0.26));
	}

	.lantern-moon-shadow {
		/* 不用纯色盖死：留一丝透光，新月时月盘才看得出是个球，而不是一个洞 */
		fill: rgb(8 15 28 / 0.94);
		transition: transform 1.7s cubic-bezier(0.4, 0.1, 0.3, 1);
	}

	.lantern-moon-hint {
		/* 月盘只有一个字符宽，这行字必须绝对定位 + 不换行，
		   否则窄屏上会被挤成一列竖排单字 */
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.45rem;
		font-size: 0.58rem;
		letter-spacing: 0.16em;
		white-space: nowrap;
		color: rgb(206 220 244 / 0.38);
	}

	.lantern-field[data-moon="full"] .lantern-moon {
		opacity: 1;
	}

	.lantern-field[data-moon="new"] .lantern-moon {
		opacity: 0.62;
	}

	.lantern-field[data-moon="waning"] .lantern-moon {
		opacity: 0.38;
	}

	/* ---------------------------------------------------------- 窄屏 */

	/* 开场文案（标题 + 四行图例 + 提示）在窄屏上占掉半个多屏，
	   场地再按 52% 绝对定位就会把灯直接铺到提示语上。
	   改成文档流里的一块，灯自然排在文案下面，湖面也从这里才开始。 */
	@media (max-width: 700px) {
		.lantern-field {
			position: relative;
			top: auto;
			right: auto;
			bottom: auto;
			left: auto;
			height: min(58svh, 30rem);
		}
	}

	/* ---------------------------------------------------------- 退化 */

	@media (prefers-reduced-motion: reduce) {
		.lantern {
			transition: none;
		}

		.lantern-body,
		.lantern-glow,
		.lantern-ripple::before,
		.lantern-ripple::after,
		.lb-mirror,
		.lantern-moon-shadow {
			transition: none;
			animation: none;
		}

		.lantern-card {
			animation: none;
		}

		.lantern.is-tapped .lantern-body svg {
			filter: drop-shadow(0 0 12px rgb(255 216 150 / 0.8));
		}
	}
</style>
