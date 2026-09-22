<script lang="ts">
import { onMount } from "svelte";
import {
	KIND_GLOW,
	LANTERNS,
	MOON_HINT,
	MOON_LABEL,
	type MoonPhase,
} from "./lanterns";

let fieldEl: HTMLElement | undefined = $state();
let fxEl: HTMLCanvasElement | undefined = $state();
let shadowEl: SVGCircleElement | undefined = $state();

let hoverIndex = $state<number | null>(null);
/** 正在「升起—燃放—消散」的那盏灯；期间它交给 CSS 动画，主循环不再写它的 transform */
let launching = $state<number | null>(null);
/** hero 滚过去了没。月亮是 fixed 的，不退场就会浮在正文标题上 */
let asleep = $state(false);
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
/** 窄屏（≤700px，与 CSS 断点同一个数）。缓存在 layout 里，免得每帧读 innerWidth */
let narrowW = false;
/** hero 底边在文档里的 y（layout 时算一次）。月亮要不要退场就看它 */
let heroEndDoc = Number.POSITIVE_INFINITY;
let heroEl: HTMLElement | null = null;

/** 信息卡按顶边钉在场地顶部这条横带上（横向仍跟着灯走） */
const CARD_TOP = 6;
/** 卡片高度预算，只用来算场地上沿要给它留多少空 */
const CARD_H = 104;

/**
 * 场地上沿的留白：卡高 + 半个灯 + 一道缝。只有能悬停的设备才要留 ——
 * 触屏压根不弹卡，留了就是白丢一片湖面。
 * 窄屏上月亮是锚在湖面上沿的（见 CSS），所以那一档还得再让出一条月盘带。
 */
function topPad() {
	if (canHover) return CARD_H + size * 0.5 + 14;
	return narrowW ? size * 2.2 : size * 0.95;
}

let canHover = true;
let reduce = false;
let raf = 0;
let last = 0;
let layoutPending = true;
let launchTimer = 0;
let navTimer = 0;

/* ------------------------------------------------------------ 烟花 */

type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	max: number;
	r: number;
	/** 线的颜色下标 */
	t: number;
	/** 这颗粒子所属那发的水平镜面线（水影用）。必须逐粒记 ——
	    多朵烟花同时在空中的话，共用一个全局值会让先炸的那朵倒影跟着后炸的跳 */
	oy: number;
};
let parts: Particle[] = [];
let fxRaf = 0;
let tail = 0;
let cw = 0;
let ch = 0;
/**
 * 画布比场地多出来的那一截（向上探进夜空的那段，见 CSS 里 .lantern-fx 的 top）。
 * ⚠️ 场地的坐标（nodes 里的 y）是**相对场地**的，画布的坐标是**相对画布**的，
 * 两者差着这一截 —— 把灯的位置换算成爆点时必须加上它，否则烟花会整体往上偏。
 * 由 sizeCanvas() 从实测尺寸算出来，不跟 CSS 里的 clamp 重复维护。
 */
let fxHead = 0;
/**
 * 一朵烟花向上能炸多远（px）。乱射那档最快的粒子约 265px/s、寿命约 1.16s，
 * 扣掉空气阻力与重力后实测约 180，取 200 留余量。
 * ⚠️ 爆点离画布上沿不能比这个近，否则花瓣会被上沿切平（神报的那个 bug）。
 */
const BURST_REACH = 200;
/** 下一朵自动烟花该在什么时候开 */
let autoAt = 0;
/** 每个色号一枚预渲染的光点。逐粒现画径向渐变太贵，13 张小图一次做好就够了。
    ⚠️ 必须逐色一枚 —— 共用一枚暖金的话，不管粒子是什么色，亮头永远是金的，
    整簇看上去就"是一盘白金色的线"，色号等于白设。 */
let sprites: (HTMLCanvasElement | null)[] = [];

/** 烟花色：暖金为主，掺月白与青玉，别成一盘彩虹。存成 [r,g,b] 才能拿去调透明度 */
const TINTS: [number, number, number][] = [
	[255, 240, 205], // 暖金
	[255, 219, 155],
	[255, 193, 121],
	[255, 246, 230], // 蜜
	[255, 224, 168],
	[255, 184, 119],
	[234, 242, 255], // 月白
	[198, 220, 255],
	[160, 190, 245],
	[150, 238, 205], // 青玉
	[112, 214, 176],
	[255, 178, 214], // 桃
	[255, 146, 190],
];

function rgb(t: [number, number, number], a: number) {
	return `rgba(${t[0]},${t[1]},${t[2]},${a})`;
}

/** 暖金 5 成、蜜 3 成、月白 1 成、青玉与桃各半成 */
function pickTint() {
	const r = Math.random();
	if (r < 0.5) return (Math.random() * 3) | 0;
	if (r < 0.8) return 3 + ((Math.random() * 3) | 0);
	if (r < 0.9) return 6 + ((Math.random() * 3) | 0);
	return 9 + ((Math.random() * 4) | 0);
}

/**
 * 四种放法，只调参数不改引擎：
 * [粒子数, 基础初速, 速度抖动, 生命基准, 生命抖动, 角度乱不乱]
 */
const FORMS: [number, number, number, number, number, boolean][] = [
	[70, 92, 30, 0.6, 0.5, false], // 圆环：等角、速度齐，干干净净一圈
	[52, 54, 16, 1.05, 0.6, true], // 垂柳：慢而寿长，靠重力慢慢垂下来
	[64, 116, 150, 0.44, 0.34, true], // 乱射：角度与速度全放开
	[88, 96, 40, 0.66, 0.5, true], // 复色环：内外两层速度，双色交替
];

function makeSprite(t: [number, number, number]) {
	const c = document.createElement("canvas");
	c.width = 64;
	c.height = 64;
	const g = c.getContext("2d");
	if (!g) return null;
	const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grd.addColorStop(0, rgb(t, 1));
	grd.addColorStop(0.34, rgb(t, 0.62));
	grd.addColorStop(1, rgb(t, 0));
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
	// 画布向上多探出来的那段（=场地之外的高度）。爆点换算与安全余量都要用它
	fxHead = Math.max(0, ch - h);
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
		// 水面倒影：以这发自己的爆点线镜像，亮度压到五分之一
		const ry = p.oy * 2 - p.y;
		const rty = p.oy * 2 - ty;

		g.strokeStyle = rgb(TINTS[p.t], 1);
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

		const sp = sprites[p.t];
		if (sp) {
			const s = p.r * (0.4 + k * 0.7);
			g.globalAlpha = a;
			g.drawImage(sp, p.x - s, p.y - s, s * 2, s * 2);
			g.globalAlpha = a * 0.14;
			g.drawImage(sp, p.x - s, ry - s, s * 2, s * 2);
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

/** 放一朵。form 不给就随便挑一种，所以"点击随机烟花"和自动燃放共用同一条路 */
function burst(
	cx: number,
	cy: number,
	form = (Math.random() * FORMS.length) | 0,
) {
	if (reduce) return;
	if (parts.length === 0 && fxRaf === 0) sizeCanvas();
	tail = 16;
	const [count, spd0, jit, life0, lifeJit, chaos] = FORMS[form];
	// 一枚弹丸一个主色，少数双色 —— 比"每粒都随机"更像真烟花
	const t1 = pickTint();
	const t2 = Math.random() < 0.28 ? pickTint() : t1;
	for (let i = 0; i < count; i++) {
		const ang = chaos
			? Math.random() * Math.PI * 2
			: (i / count) * Math.PI * 2 + Math.random() * 0.18;
		// 复色环：奇数粒子走外圈
		const ring = form === 3 && i % 2 ? 1.35 : 1;
		const spd = (spd0 + Math.random() * jit) * ring;
		// max 必须等于自己的寿命：写死成一个常数会让短寿命粒子一出生就只有
		// 一半亮度（k = life/max < 1），整簇看着就是"没炸开"
		const life = life0 + Math.random() * lifeJit;
		parts.push({
			x: cx,
			y: cy,
			vx: Math.cos(ang) * spd,
			vy: Math.sin(ang) * spd - (form === 1 ? 8 : 26),
			life,
			max: life,
			r: 1.1 + Math.random() * 1.5,
			t: i % 2 ? t2 : t1,
			oy: cy,
		});
	}
	if (!fxRaf) fxRaf = requestAnimationFrame(frame);
}

function autoBurst(now: number) {
	autoAt = now + 2800 + Math.random() * 3800;
	// 炸在湖面上空那片：场地自己就压在湖面之上，取它纵深的上三分之一。
	// ⚠️ 两处换算别忘：① 场地的 y 加上 fxHead 才是画布的 y；
	// ② 离画布上沿至少留一个 BURST_REACH，否则上半朵会被切平。
	const want = fxHead + h * (0.08 + Math.random() * 0.32);
	burst(cw * (0.12 + Math.random() * 0.76), Math.max(want, BURST_REACH));
}

/* ------------------------------------------------------------ 月相 */

/** 一轮朔望多少秒。太快像在快进，太慢就「看不出在变」 */
const LUNAR = 52;
let lum = 0.6;

/**
 * 月相只用两个量算出来，都从上弦角 θ 推：
 *   f = 照度（0 朔、1 望）—— 亮多少，真值就是 (1-cosθ)/2
 *   d = 遮挡圆相对月盘的水平位移（单位＝月盘半径，正右负左）—— 亮的是哪一边
 *
 * ⚠️ 别用「让位移走正弦」那套。正弦扫到 -2 又往回收，于是后半程
 * 「亮面在右、却在变缺」，跟真实月相正好镜像 —— 文案写残月，画面上却是个上弦凸月。
 * 位移取 d = ±2f，符号由「θ<π 是上弦（亮右），过了 π 是残月（亮左）」定：
 * 这样位移一路单调扫过去，亮面始终跟着照度一起增减，形状和文案永远不会打架。
 */
function paintMoon(now: number) {
	const th = ((now / 1000 / LUNAR) * Math.PI * 2) % (Math.PI * 2);
	const f = (1 - Math.cos(th)) / 2;
	const d = (th < Math.PI ? -1 : 1) * 2 * f;
	if (shadowEl)
		shadowEl.style.transform = `translateX(${(d * 20).toFixed(2)}px)`;
	// ⚠️ 别每帧都写 --lum：13 盏灯的 filter 都会跟着失效重绘。
	// 阈值卡到 0.015，一轮下来只写几十次，肉眼看不出台阶
	const next = 0.66 + 0.52 * f;
	if (Math.abs(next - lum) > 0.015) {
		lum = next;
		fieldEl?.style.setProperty("--lum", lum.toFixed(3));
		// 月亮自己的存在感也跟着照度走：朔月几乎隐进夜色，望月亮得压住半片湖。
		// 跟着同一个阈值一起写，不多付一次重绘。
		fieldEl?.style.setProperty("--moonf", f.toFixed(3));
	}
	// 标签只用来挑文案和给 CSS 挂钩，粗分四档就够
	const p: MoonPhase =
		f > 0.86 ? "full" : f < 0.14 ? "new" : th < Math.PI ? "waxing" : "waning";
	if (p !== moon) moon = p;
}

/**
 * 月盘上的「粒子」：黄金角撒点天然铺得匀。⚠️ 必须确定值，SSR 与 hydrate 得一致。
 *
 * 尺寸是真踩过的坑：月盘只有 20 个 SVG 单位半径，渲染出来约 47px 宽 ——
 * 单位 ≈ 1.2px。原来把点写在 0.3～0.5 单位上，等于 0.4px，亚像素一律被抗锯齿抹平，
 * 「粒子月面」在屏幕上根本不存在，月亮只是一块死白。
 * 现在最细的点也 ≥0.9 单位（≈1.1px），覆盖约四成，明暗两层才看得出颗粒感。
 */
const DUST = Array.from({ length: 96 }, (_, i) => {
	const a = i * 2.399963229728653; // 黄金角
	const rad = 19.2 * Math.sqrt((i + 0.5) / 96);
	// 每五粒挑一粒当暗斑（月海）。白点叠在白底上等于没画，必须有暗的才读得出"颗粒"。
	const dark = i % 5 === 2;
	return {
		x: 32 + Math.cos(a) * rad,
		y: 32 + Math.sin(a) * rad,
		r: dark ? 1.05 + ((i * 13) % 4) * 0.32 : 0.9 + ((i * 7) % 5) * 0.2,
		o: dark ? 0.14 + ((i * 3) % 3) * 0.05 : 0.34 + ((i * 11) % 6) * 0.11,
		fill: dark ? "#8ba0c6" : "#ffffff",
	};
});

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
	narrowW = window.innerWidth <= 700;
	size = Math.max(42, Math.min(84, Math.round(w / 15.5)));
	minDist = size * 1.44;
	el.style.setProperty("--lantern-size", `${size}px`);
	// 顺手记下 hero 的底边。读 rect 只在这里做一次，滚动心跳里就只比对 scrollY
	if (heroEl)
		heroEndDoc = heroEl.getBoundingClientRect().bottom + window.scrollY;
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

	// 月相自己走：θ 匀速推，照度与遮挡圆位移都由 paintMoon 内部算
	paintMoon(now);
	if (now > autoAt) autoBurst(now);

	const t = now / 1000;
	const frozen = canHover ? hoverIndex : null;

	for (let i = 0; i < nodes.length; i++) {
		const n = nodes[i];
		// 起飞的那盏交给 CSS 动画，主循环撒手 —— 否则每帧写的 transform 会跟动画打架
		if (i === frozen || i === launching) {
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
			const ia = i === frozen || i === launching ? 0 : 1;
			const ib = j === frozen || j === launching ? 0 : 1;
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
		if (!el || i === launching) continue;
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

/** 放走一盏灯：升起 → 半空燃放 → 散进夜里 → 才跳转。整段 2.5 秒 */
function tap(i: number, ev: MouseEvent) {
	// 修饰键交给浏览器：那是"后台开一个"的意思，别拦
	if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
	ev.preventDefault();
	const url = LANTERNS[i].url;
	if (reduce) {
		window.open(url, "_blank", "noopener,noreferrer");
		return;
	}
	if (launching !== null) return; // 一次只放飞一盏，免得两盏灯的定时器互相踩
	const n = nodes[i];
	/**
	 * ⚠️ 新页必须在「用户手势」里**同步**开出来，这里只开一张空白页拿着句柄，
	 * 动画演完再给它填地址。
	 *
	 * 原实现是等 2.5s 之后才 window.open —— 那会儿已经不在手势上下文里，
	 * 浏览器按弹窗拦掉（返回 null），于是兜底的 location.href 把**博客自己**
	 * 一起带走了（神报的 bug：博客所在界面也跟着跳）。
	 * 预开之后博客这页全程不动，只是那张新页晚 2.5s 才拿到地址。
	 */
	const win = window.open("", "_blank");
	if (win) {
		// noopener 的等价写法：拿到句柄之后自己把 opener 断掉。
		// 不能把 "noopener" 写进 features —— 那样 window.open 会返回 null，
		// 拿不到句柄也就没法事后填地址了。
		win.opener = null;
		window.focus(); // 别让新页抢走焦点：这段升起—燃放的动画要在这边演完
	}
	launching = i;
	close();
	// 燃放对齐 keyframes 的 46%（2.3s × 0.46 ≈ 1.06s），正好在升到最高那口气上
	launchTimer = window.setTimeout(() => {
		// 同样要加 fxHead 换成画布坐标，并留够爆开的余量
		if (n) burst(n.x, Math.max(BURST_REACH, fxHead + n.y - size * 1.6));
	}, 1060);
	navTimer = window.setTimeout(() => {
		if (win && !win.closed) win.location.href = url;
		else location.href = url; // 预开就被拦（弹窗拦截器全关）才退化成当前页跳转
		launching = null; // 交给 .lantern 上的 opacity 过渡慢慢淡回来
	}, 2500);
}

/** 点湖面／夜空也来一朵。点灯的话交给 tap，别叠两发 */
function onDocClick(ev: MouseEvent) {
	if (reduce || !fxEl) return;
	const t = ev.target as Element | null;
	if (t?.closest?.(".lantern, .lantern-card, a, button")) return;
	const r = fxEl.getBoundingClientRect();
	if (r.bottom < 60) return; // 画布都滚出视口了，炸了也看不见
	const x = ev.clientX - r.left;
	const y = ev.clientY - r.top;
	const inCanvas = x > 0 && y > 0 && x < r.width && y < r.height;
	burst(
		inCanvas ? x : cw * (0.15 + Math.random() * 0.7),
		// 竖向也要留够爆开的余量：点在画布很靠上的地方（天际线附近）时往下让一让，
		// 否则上半朵还是会被上沿切平 —— 宁可炸得比手指低一点，也别炸出个平顶
		inCanvas
			? Math.max(y, BURST_REACH)
			: Math.max(fxHead + h * (0.1 + Math.random() * 0.45), BURST_REACH),
	);
}

onMount(() => {
	canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
	reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	heroEl = fieldEl?.closest<HTMLElement>(".lantern-hero") ?? null;
	sprites = TINTS.map(makeSprite);
	paintMoon(0); // 先把月盘摆到初始月相，降级模式下也要有个像样的样子

	els = Array.from(
		fieldEl?.querySelectorAll<HTMLElement>("[data-lantern]") ?? [],
	);

	const ro = new ResizeObserver(() => {
		layoutPending = true;
	});
	if (fieldEl) ro.observe(fieldEl);
	window.addEventListener("resize", onWin);
	window.addEventListener("click", onDocClick);

	layout();
	layoutPending = false;
	last = performance.now();
	autoAt = last + 1600;

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
		window.removeEventListener("click", onDocClick);
		clearTimeout(launchTimer);
		clearTimeout(navTimer);
	};
});

function onWin() {
	layoutPending = true;
}

// 元素尺寸变化（字体加载、旋转屏幕）后的补一次布局；顺手看住月亮。
// 月亮那条放在这里而不是 tick() 里，是因为降级模式（prefers-reduced-motion）压根不跑 tick，
// 而 fixed 的月亮在降级模式下一样会浮到正文上。
$effect(() => {
	if (!fieldEl) return;
	const id = window.setInterval(() => {
		asleep = window.scrollY >= heroEndDoc - 140;
		if (!layoutPending) return;
		layoutPending = false;
		layout();
	}, 240);
	return () => clearInterval(id);
});
</script>

<div class="lantern-field" bind:this={fieldEl} data-moon={moon} class:is-asleep={asleep}>
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
			class:is-launching={launching === i}
			style="--glow:{KIND_GLOW[l.kind]};--i:{i}"
			href={l.url}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`${l.name} · ${l.epithet}（新标签页打开）`}
			onmouseenter={() => open(i)}
			onmouseleave={close}
			onfocus={() => open(i)}
			onblur={close}
			onclick={(e) => tap(i, e)}
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
			<!-- 粒子月面：一层细碎的亮点 + 暗斑。整组一起呼吸，不用逐粒动画 -->
			<g class="lantern-moon-dust" clip-path="url(#lantern-moon-cut)">
				{#each DUST as d}
					<circle cx={d.x} cy={d.y} r={d.r} opacity={d.o} fill={d.fill} />
				{/each}
			</g>
			<g clip-path="url(#lantern-moon-cut)">
				<!-- transform 由 paintMoon 每帧直接写，不走响应式状态，也别加 CSS transition -->
				<circle class="lantern-moon-shadow" bind:this={shadowEl} cx="32" cy="32" r="20" />
			</g>
		</svg>
		<span class="lantern-moon-hint">{MOON_HINT[moon]}</span>
	</div>
</div>

<style>
	.lantern-field {
		--lantern-size: 68px;
		--lum: 0.66;
		--moonf: 0;
		position: absolute;
		/* 只在湖面之上活动：下界留出底部渐隐带，上界压住正文/图例不与之打架；
		   矮屏时用 24rem 兜底，免得 52% 落得太高又叠到标题上。 */
		top: max(52%, 24rem);
		right: 0;
		bottom: 6%;
		left: 0;
		pointer-events: none;
		z-index: 3;
		/* 烟花画布向上探进夜空的高度 —— 给花瓣爆开留的余量，见 .lantern-fx。
		   写成变量是因为 top 和 height 两处都要用它，函数式写法会漂。 */
		--fx-head: clamp(6rem, 20vh, 11rem);
	}

	/* --lum（灯的整体明暗）与 --moonf（月亮的存在感）都由 paintMoon 直接写到这个元素上：
	   两个都是连续量，CSS 按四档再分一次够用不了。这里只留预置值供 JS 起来之前用，
	   过渡交给 .lantern / .lantern-moon 上的 transition。
	   data-moon 保留是因为它给 CSS 帮不上忙了，但自测要靠它读当前档位。 */

	.lantern-fx {
		position: absolute;
		/* ⚠️ 画布必须比场地「高出一截」（向上探进夜空），这段余量是给烟花爆开用的：
		   爆点上方没有余量的话，花瓣会被画布上沿一刀切平 —— 上半朵烟花直接消失。
		   JS 侧由 fxHead（= 画布高 - 场地高）读出这段，爆点换算与安全余量都用它。 */
		top: calc(-1 * var(--fx-head));
		left: 0;
		/* ⚠️ canvas 是**替换元素**：尺寸写 auto 时它会用固有尺寸 300×150，
		   而绝对定位下 bottom:0 会被直接忽略（过渡约束时 bottom 让位）——
		   高度只有 150px、宽度只有 300px，烟花全挤到左上角去。
		   所以宽度和高度都必须显式给，不能用 left/right/top/bottom 去撑。 */
		width: 100%;
		height: calc(100% + var(--fx-head));
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
		/* opacity 这条是给"放走一盏灯"收尾用的：动画跑完把类摘掉，灯自己淡回来 */
		transition:
			filter 1.6s ease,
			opacity 0.7s ease;
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

	/* 放飞：升起 → 半空燃放 → 散进夜里。升与烧写在 .lantern-body 上（它本来就有自己的
	   transform，hover 的抬升也是它），淡出写在 .lantern 上，两层各管一件事。
	   时长 2.3s，跳转排在 2.5s —— 整段不超过三秒。
	   ⚠️ 期间 tick 里要跳过这盏灯的 transform，否则每帧写的内联值和动画互相盖。 */
	.lantern.is-launching {
		animation: lantern-launch-out 2.3s ease-in forwards;
	}

	.lantern.is-launching .lantern-body {
		animation: lantern-launch-rise 2.3s cubic-bezier(0.3, 0.62, 0.3, 1) forwards;
	}

	.lantern.is-launching .lantern-body svg {
		animation: lantern-launch-burn 2.3s ease-in-out forwards;
	}

	@keyframes lantern-launch-rise {
		0% {
			transform: translateY(0) scale(1);
		}
		46% {
			transform: translateY(-72px) scale(1.06);
		}
		100% {
			transform: translateY(-108px) scale(0.68);
		}
	}

	/* 46% 是灯在半空"点着"的那一瞬，跟 tap() 里放烟花的 1060ms 对齐 */
	@keyframes lantern-launch-burn {
		0%,
		28% {
			filter: drop-shadow(0 0 7px rgb(255 206 140 / 0.4));
		}
		46% {
			filter: drop-shadow(0 0 28px rgb(255 232 178 / 0.95)) brightness(1.6);
		}
		100% {
			filter: drop-shadow(0 0 10px rgb(255 226 170 / 0.22)) brightness(0.78);
		}
	}

	@keyframes lantern-launch-out {
		0%,
		42% {
			opacity: 1;
		}
		70% {
			opacity: 0.7;
		}
		100% {
			opacity: 0;
		}
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

	/* 悬在湖面正上空的月亮。定死在视口里（滚动时不跟着跑），水平居中 ——
	   居中它才在湖面正上方，水面那道光带也才好对着它。 */
	.lantern-moon {
		position: fixed;
		top: clamp(3.4rem, 7.5vh, 6rem);
		left: 50%;
		transform: translateX(-50%);
		width: clamp(54px, 6vw, 76px);
		pointer-events: none;
		z-index: 20;
		/* 存在感跟着照度连续走（--moonf 由 paintMoon 写）。原来按 data-moon 分四档跳，
		   于是刚过满月就"啪"地掉到 44% —— 一个不该有的台阶 */
		opacity: calc(0.6 + 0.4 * var(--moonf, 0));
		transition: opacity 1.2s ease;
	}

	/* 微微发出的月光：一圈很大的冷光，跟着月相明暗收放 */
	.lantern-moon::before {
		content: "";
		position: absolute;
		inset: -130%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgb(216 232 255 / 0.17) 0%,
			rgb(186 210 255 / 0.08) 34%,
			rgb(170 198 250 / 0.03) 56%,
			transparent 72%
		);
		opacity: calc(0.34 + 0.66 * var(--moonf, 0));
		transition: opacity 1.6s ease;
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
		filter: drop-shadow(0 0 calc(6px + 14px * var(--moonf, 0)) rgb(226 236 255 / 0.42));
	}

	/* 粒子月面：细碎亮点与暗斑铺满月盘，整组慢慢呼吸 —— 逐粒做动画太贵，也没必要。
	   颜色逐粒写在属性上（亮的白、暗的冷灰蓝），这里只管呼吸 */
	.lantern-moon-dust {
		animation: lantern-moon-dust 7.5s ease-in-out infinite;
	}

	@keyframes lantern-moon-dust {
		0%,
		100% {
			opacity: 0.72;
		}
		50% {
			opacity: 1;
		}
	}

	.lantern-moon-shadow {
		/* 不用纯色盖死：留一丝透光，新月时月盘才看得出是个球，而不是一个洞。
		   ⚠️ 这里不能加 transition：位移是每帧算的，过渡只会让它追不上 */
		fill: rgb(8 15 28 / 0.94);
	}

	.lantern-moon-hint {
		/* 月盘只有一个字符宽，这行字必须绝对定位 + 不换行，
		   否则窄屏上会被挤成一列竖排单字 */
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-top: 0.4rem;
		font-size: 0.58rem;
		letter-spacing: 0.16em;
		white-space: nowrap;
		color: rgb(206 220 244 / 0.38);
	}

	/* hero 滚过去之后月亮必须退场：它是 fixed 的，不退就直接浮在正文标题上
	   （实测 scrollY≈hero 高度时，月亮正好落在正文第一行）。
	   淡出交给 .lantern-moon 自己那条 opacity 过渡，别在这里再写 transition。 */
	.lantern-field.is-asleep .lantern-moon {
		opacity: 0;
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

		/* 窄屏上月亮不能再 fixed：这时开场文案就排在文档流最上面，
		   钉在视口顶的月亮正好压在标题与图例上（实测压住「载尘望星 · 浮游工具集」）。
		   改成锚在湖面上沿 —— "湖面正上空"本来也是它该在的地方；
		   顺带它会跟湖一起滚走，不必再靠 is-asleep 退场。
		   场地上沿的留白同步加高（topPad 里那一档），给月盘和月相文案腾出位置。 */
		.lantern-moon {
			position: absolute;
			top: 0.4rem;
			width: 46px;
		}
	}

	/* ---------------------------------------------------------- 退化 */

	@media (prefers-reduced-motion: reduce) {
		.lantern,
		.lantern-moon,
		.lantern-moon::before {
			transition: none;
		}

		.lantern-body,
		.lantern-glow,
		.lantern-ripple::before,
		.lantern-ripple::after,
		.lb-mirror,
		.lantern-moon-shadow,
		.lantern-moon-dust {
			transition: none;
			animation: none;
		}

		.lantern-card {
			animation: none;
		}

		/* 降级路径里 tap() 直接开新页，压根不会挂 is-launching —— 这条纯属兜底，
		   免得日后有人在降级分支补上动画时，灯被钉在半空不回来 */
		.lantern.is-launching,
		.lantern.is-launching .lantern-body,
		.lantern.is-launching .lantern-body svg {
			animation: none;
			opacity: 1;
		}
	}
</style>
