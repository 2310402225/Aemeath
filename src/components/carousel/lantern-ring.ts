// 走马灯：六张灯片挂在墨钟内圈上，自己慢慢地转。
//
// 几处刻意的选择：
//  ① 灯片**不跟着环转**（不把面板旋转到「朝外」）。真走马灯的面板是朝外的，
//     但那意味着下半圈的字是倒的 —— 这里宁可让灯片一直立着，只给一点点倾斜，
//     读得出来才是正经。
//  ② 六张灯片只在**离观众最近**（六点方向）时最大最实，绕到对面就小一分淡一分，
//     于是「转」这件事不用看也能感觉到。
//  ③ 面板上的字是烘好的位图缓存（换尺寸或墨色档才重画）；展开时反而不画字 ——
//     那一刻由 brush.ts 在墨层上按笔顺现写。纸底**不烘**，贴的时候现画（见 drawSlide）。
//  ④ 六张灯片正面**只有字，没有角色形象**：名单上那些都是受版权保护的 IP，
//     写名字没问题，画形象就是另一回事了。

import { fitSize, HALO_SCALE, paintText, type WriterOptions } from "./brush";
import {
	type Couplings,
	clamp,
	goldRgba,
	inkRgba,
	lerp,
	PAPER,
	smoothstep,
} from "./couplings";

/** PAPER 是 CSS 串（"#f5f0e6"），要和色就得拆成分量。别把两个地方的颜色写两遍。 */
const PAPER_RGB: [number, number, number] = (() => {
	const h = PAPER.replace("#", "");
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
		number,
		number,
		number,
	];
})();

export type PanelSpec = {
	/** 毛笔要写的题名（空格分列，竖排从右往左） */
	title: string;
	/** 对应哪件旧物（见 scenery.ts 的 RELICS 下标） */
	relic: number;
	/** 展开时落在下面的说明，走站内字体 */
	note: string;
	/** 毛笔写不了的拉丁字母与数字，单独一行走印刷体 */
	latin: string;
};

export const PANELS: PanelSpec[] = [
	{
		title: "葫芦娃 黑猫警长",
		relic: 0,
		note: "六点半的动画片。片头曲一响，小板凳已经搬到电视机前面了。",
		latin: "1986 / 1984",
	},
	{
		title: "马里奥 魂斗罗",
		relic: 1,
		note: "三十条命的传说，和隔壁那位一人一条换着打，谁死了谁下场。",
		latin: "1985 / 1987",
	},
	{
		title: "赛尔号 洛克王国",
		relic: 1,
		note: "放学先开电脑。精灵和宠物都养在别人的服务器上，关服那天跟着没了。",
		latin: "2009 / 2010",
	},
	{
		title: "秦时明月 虹猫蓝兔",
		relic: 0,
		note: "一个是武侠，一个是江湖。守着点看完，片尾曲都舍不得跳。",
		latin: "2007 / 2006",
	},
	{
		title: "掌机 卡带",
		relic: 1,
		note: "卡带里存的不是进度，是一整个暑假。电池没电，存档就跟着走了。",
		latin: "GBA / NDS",
	},
	{
		title: "发条玩具 玻璃弹珠",
		relic: 2,
		note: "拧三下发条，它跳三下。弹珠在土里滚，输赢就是那几颗。",
		latin: "1980s",
	},
];

const SLOTS = PANELS.length;
/** 灯片是**竖的**（高 > 宽）：题名竖排，横着的框一定留白 —— 真灯罩也是立轴的。 */
const PANEL_W = 0.32;
const PANEL_H = 0.4;
/** 题名本身最多占到框的多少（四边都留白，不然字贴着墨边） */
const INK_INSET = 0.9;
/** 但排版要塞进去的是「字 + 洇」那一坨，所以还得把洇的倍数除掉。
 *  忘了除会怎样：字号看着刚好，那层淡边却顶到灯片的框上，像字被框切了一刀。 */
const TEXT_FILL_W = INK_INSET / HALO_SCALE;
const TEXT_FILL_H = INK_INSET / HALO_SCALE;
/** 自己转一圈要多久（秒） */
const LAP_SECONDS = 72;
/** 长按多久算「收藏」（触屏没有右键，这是替代手势） */
export const HOLD_TO_COLLECT = 1.5;

export type Ring = {
	resize: () => void;
	frame: (dt: number) => void;
	/** 落点命中第几张灯片（-1 = 没命中） */
	hit: (x: number, y: number) => number;
	/** 指针悬停：减速 + 点亮对应旧物 */
	hover: (x: number, y: number) => number;
	beginDrag: (x: number, y: number) => void;
	drag: (x: number, y: number) => void;
	endDrag: () => void;
	/** 按下 / 抬起：按住时冻结，按够 HOLD_TO_COLLECT 秒算收藏 */
	press: (x: number, y: number) => void;
	release: () => void;
	heldMs: () => number;
	/** 展开 / 收起。返回新的展开下标（-1 = 收起） */
	toggle: (slot: number) => number;
	expanded: () => number;
	/** 展开动画走到位了没有（写字要等它落位） */
	expandProgress: () => number;
	/** 展开中的灯片当前在屏幕上的位置与内区尺寸（写字要用） */
	expandedBox: () => {
		x: number;
		y: number;
		w: number;
		h: number;
		size: number;
	} | null;
	collected: () => boolean[];
	markCollected: (slot: number) => void;
	/** 每张灯片现在的几何（位置、框、字号）—— 给页内自测断言「字进得去框」。 */
	slots: () => {
		slot: number;
		x: number;
		y: number;
		pw: number;
		ph: number;
		size: number;
	}[];
};

export function createRing(
	canvas: HTMLCanvasElement,
	c: Couplings,
	center: () => { x: number; y: number },
	radius: () => number,
): Ring {
	const ctxRaw = canvas.getContext("2d");
	if (!ctxRaw) throw new Error("ring: 拿不到 2d 上下文");
	// 同 clock.ts：收窄进不了被提升的函数声明（ts 18047），另绑一个非空常量。
	const ctx: CanvasRenderingContext2D = ctxRaw;

	let w = 0;
	let h = 0;
	let dpr = 1;
	/** 当前角度（自 12 点起顺时针） */
	let rot = 0;
	/** 拖拽时的目标角度，实际角度向它阻尼收敛 —— 这就是 spec 要的「阻尼」。 */
	let targetRot: number | null = null;
	let dragging = false;
	let dragStartAngle = 0;
	let dragStartRot = 0;
	let hoverSlot = -1;
	let pressed = false;
	let pressAt = 0;
	const collected: boolean[] = new Array(SLOTS).fill(false);
	let expand = 0;
	let expandSlot = -1;
	let expandTarget = 0;
	const dust: {
		x: number;
		y: number;
		vx: number;
		vy: number;
		life: number;
		r: number;
	}[] = [];
	const cache = new Map<string, HTMLCanvasElement>();

	const PANEL_CACHE_LIMIT = 64;

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = Math.min(2, window.devicePixelRatio || 1);
		w = Math.max(1, Math.round(rect.width));
		h = Math.max(1, Math.round(rect.height));
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		cache.clear();
	}

	/** 环上第 slot 张灯片的位置（含「离观众越近越大」的透视） */
	function slotState(slot: number) {
		const R = radius();
		const a = rot + (slot / SLOTS) * Math.PI * 2;
		const ringR = R * 0.585;
		const { x: cx, y: cy } = center();
		// 六点方向（a = π）最靠前：最大最实
		const near = (Math.cos(a - Math.PI) + 1) / 2; // 0 = 最远，1 = 最近
		const scale = 0.78 + 0.3 * near;
		const alpha = 0.46 + 0.54 * near;
		const pw = R * PANEL_W * scale;
		const ph = R * PANEL_H * scale;
		return {
			slot,
			a,
			x: cx + Math.sin(a) * ringR,
			y: cy - Math.cos(a) * ringR,
			pw,
			ph,
			// 一点点倾斜，像灯罩上的画在随灯转
			tilt: Math.sin(a) * 0.1,
			alpha: alpha * (1 - 0.5 * expand * (expandSlot === slot ? 1 : 0)),
			near,
			scale,
		};
	}

	/** 灯罩纸：上暖下淡、中间比边缘亮（灯在里面），加两道错开的淡墨边。
	 *
	 *  `keep` = 这张灯片还剩多少「实」：远灯小一分淡一分、有灯展开时其余退到后面。
	 *
	 *  ⚠️ **「淡」是把纸色往页面纸色里和，不是降 alpha。** 灯罩纸必须画成不透明的：
	 *  环一直在自转，钟针又正好伸到内圈里（0.74R 对上灯片 0.43–0.74R 那一段），
	 *  半透明的纸会让针从每张灯片里各穿出来一次，像画错的一道墨。而
	 *  `lerp(页面纸色, 灯罩色, keep)` 与「灯罩色压 alpha=keep 在同样的纸色上」
	 *  在数值上是同一个颜色 —— 所以观感一点没变，只是背后不再透。
	 */
	function drawSlide(
		g: CanvasRenderingContext2D,
		pw: number,
		ph: number,
		hair: number,
		keep = 1,
	) {
		const paper = (r: number, gg: number, b: number) =>
			`rgb(${Math.round(lerp(PAPER_RGB[0], r, keep))} ${Math.round(
				lerp(PAPER_RGB[1], gg, keep),
			)} ${Math.round(lerp(PAPER_RGB[2], b, keep))})`;
		const grad = g.createLinearGradient(0, 0, 0, ph);
		grad.addColorStop(0, paper(252, 248, 238));
		grad.addColorStop(0.55, paper(248, 242, 228));
		grad.addColorStop(1, paper(240, 232, 214));
		g.fillStyle = grad;
		g.beginPath();
		g.roundRect(0, 0, pw, ph, Math.min(pw, ph) * 0.14);
		g.fill();

		// 淡墨边：两条错开一点点的细线，比一条干净的线更像手画的
		for (const off of [0, hair * 1.2]) {
			g.strokeStyle = inkRgba(c, (off === 0 ? 0.34 : 0.12) * keep);
			g.lineWidth = hair;
			g.beginPath();
			g.roundRect(
				off,
				off,
				pw - off * 2,
				ph - off * 2,
				Math.min(pw, ph) * 0.14,
			);
			g.stroke();
		}
	}

	/** 灯片面：只有烘好的题名（透明底）。纸底不烘 —— 它得按 `keep` 现画，
	 *  而 keep 每一帧都在变（环在转、展开时其余灯在退），进不了缓存。 */
	function panelArt(
		slot: number,
		pw: number,
		ph: number,
		size: number,
	): HTMLCanvasElement {
		const bucket = Math.round(c.rewind * 6);
		const key = `${slot}|${Math.round(pw)}|${Math.round(ph)}|${Math.round(size)}|${bucket}`;
		const hit = cache.get(key);
		if (hit) return hit;
		const pad = 14;
		const cv = document.createElement("canvas");
		cv.width = Math.round((pw + pad * 2) * dpr);
		cv.height = Math.round((ph + pad * 2) * dpr);
		const g = cv.getContext("2d");
		if (!g) return cv;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.translate(pad, pad);

		const opt: WriterOptions = { size, mode: "v", alpha: 1 };
		paintText(g, PANELS[slot].title, pw / 2, ph / 2, opt, inkRgba(c, 0.92));

		if (cache.size > PANEL_CACHE_LIMIT) cache.clear();
		cache.set(key, cv);
		return cv;
	}

	/** 展开时那张灯片的位置：飞到钟心，放大到能写字。
	 *  长宽比跟环上那六张**一样**（0.8）—— 题名是竖排的两列，横着的框两边全是空。 */
	function expandedRect() {
		const R = radius();
		const { x: cx, y: cy } = center();
		const ew = R * 0.66;
		const eh = R * 0.825;
		// size 也走 fitSize（跟环上那六张同一个规则），否则展开时字会跟框对不上
		const title = expandSlot >= 0 ? PANELS[expandSlot].title : "";
		const size = fitSize(title || "时时", ew * TEXT_FILL_W, eh * TEXT_FILL_H);
		return { x: cx, y: cy - R * 0.06, w: ew, h: eh, size };
	}

	function drawPanels() {
		for (let i = 0; i < SLOTS; i++) {
			const st = slotState(i);
			const isExpanded = expandSlot === i && expand > 0.001;
			// 展开中的那张：位置与尺寸从环上插值飞到钟心
			let x = st.x;
			let y = st.y;
			let pw = st.pw;
			let ph = st.ph;
			let alpha = st.alpha;
			let tilt = st.tilt;
			if (isExpanded) {
				const e = expandedRect();
				const ease = smoothstep(expand);
				x = st.x + (e.x - st.x) * ease;
				y = st.y + (e.y - st.y) * ease;
				pw = st.pw + (e.w - st.pw) * ease;
				ph = st.ph + (e.h - st.ph) * ease;
				alpha = Math.max(st.alpha, 0.94);
				tilt = st.tilt * (1 - ease);
			} else if (expandSlot >= 0) {
				// 有一张展开了，其余的退到后面去
				alpha *= 1 - 0.62 * smoothstep(expand);
			}
			// 字号由**这张题名自己的行列数**定，而不是一个固定比值 ——
			// 2 字一列和 4 字一列的题名共用同一个比值时，必有一张是空的或撑破的。
			const textSize = clamp(
				isExpanded
					? expandedRect().size
					: fitSize(PANELS[i].title, pw * TEXT_FILL_W, ph * TEXT_FILL_H),
				9,
				90,
			);

			// 灯片的暖光晕：悬停或被选中时更亮，像灯捻被挑了一下
			const lit = i === hoverSlot || isExpanded;
			if (lit || st.near > 0.35) {
				const glow = ctx.createRadialGradient(x, y, 0, x, y, pw * 1.25);
				const a = (lit ? 0.3 : 0.12) * st.near * (1 - c.rewind * 0.4);
				glow.addColorStop(0, `rgb(255 236 190 / ${a})`);
				glow.addColorStop(1, "rgb(255 236 190 / 0)");
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(x, y, pw * 1.25, 0, Math.PI * 2);
				ctx.fill();
			}

			const art = panelArt(i, pw, ph, textSize);
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(x, y);
			ctx.rotate(tilt);
			if (collected[i]) {
				// 收藏过的灯片在角上多一道金边
				ctx.strokeStyle = goldRgba(0.4);
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.roundRect(-pw / 2 - 5, -ph / 2 - 5, pw + 10, ph + 10, 10);
				ctx.stroke();
			}
			// 灯罩纸：展没展开都先画（展开的灯片就是同一张灯片放大了，单独写一套白底
			// 矩形会看着像贴上去的一张白卡）。⚠️ 这张纸**不透明** —— 见 drawSlide：
			// 半透明的纸会让自转的环每转一圈就把钟针「穿」过每张灯片一次。
			// 临时把 globalAlpha 提回 1：alpha 那层「淡」已经由 keep 承担了，不然淡两遍。
			ctx.save();
			ctx.translate(-pw / 2, -ph / 2);
			ctx.globalAlpha = 1;
			drawSlide(ctx, pw, ph, isExpanded ? 1.4 : 1, alpha);
			ctx.restore();
			// ⚠️ 展开中的灯片**不画字**：那一刻字是由墨层按笔顺现写的，
			// 两处都画会重影。
			if (!isExpanded) {
				ctx.drawImage(
					art,
					-art.width / dpr / 2,
					-art.height / dpr / 2,
					art.width / dpr,
					art.height / dpr,
				);
			}
			ctx.restore();
		}
	}

	function drawDust() {
		if (!dust.length) return;
		for (const p of dust) {
			const a = Math.max(0, p.life) * 0.5;
			if (a <= 0.01) continue;
			ctx.fillStyle = goldRgba(a);
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function frame(dt: number) {
		// 展开动画：走到位才让写字开始
		if (Math.abs(expand - expandTarget) > 0.0005)
			expand += (expandTarget - expand) * Math.min(1, dt * 5.5);
		else expand = expandTarget;

		// 转：拖拽时向目标阻尼收敛；悬停减速；按住冻结
		const frozen = pressed || expand > 0.35;
		if (targetRot != null) {
			rot += (targetRot - rot) * Math.min(1, dt * 7);
		} else if (!frozen) {
			const speedMul =
				(hoverSlot >= 0 ? 0.22 : 1) *
				clamp(c.speed, 0.25, 3) *
				(1 - 0.5 * c.rewind);
			rot += ((Math.PI * 2) / LAP_SECONDS) * dt * speedMul;
		}

		// 金尘：只有环在动、且还没被褪色压住的时候才逸散
		const want = !frozen && c.rewind < 0.75;
		if (want && Math.random() < dt * 6) {
			const a = rot + Math.random() * Math.PI * 2;
			const { x: cx, y: cy } = center();
			const ringR = radius() * 0.585;
			dust.push({
				x: cx + Math.sin(a) * ringR,
				y: cy - Math.cos(a) * ringR,
				vx: (Math.random() - 0.5) * 8,
				vy: -6 - Math.random() * 10,
				life: 1.6 + Math.random() * 1.6,
				r: 0.6 + Math.random() * 1.1,
			});
		}
		for (let i = dust.length - 1; i >= 0; i--) {
			const p = dust[i];
			p.life -= dt;
			if (p.life <= 0) {
				dust.splice(i, 1);
				continue;
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vy -= dt * 3; // 微微上浮，像被灯的热气托着
		}
		if (dust.length > 160) dust.splice(0, dust.length - 160);

		ctx.clearRect(0, 0, w, h);
		drawPanels();
		drawDust();
	}

	/** 命中：面板是轴对齐的圆角矩形（只带很小一点倾斜），按矩形判就够。 */
	function hit(x: number, y: number): number {
		const { x: cx, y: cy } = center();
		// 只在自己那一段扇形里找，免得圆环两侧的灯片被算成命中
		const ang = Math.atan2(x - cx, -(y - cy));
		const turns = (((ang / (Math.PI * 2)) % 1) + 1) % 1;
		const slot =
			Math.round(((((turns - rot / (Math.PI * 2)) % 1) + 1) % 1) * SLOTS) %
			SLOTS;
		const st = slotState(slot);
		const padX = st.pw / 2 + 8;
		const padY = st.ph / 2 + 10;
		if (Math.abs(x - st.x) <= padX && Math.abs(y - st.y) <= padY) return slot;
		return -1;
	}

	return {
		resize,
		frame,
		hit,
		hover(x, y) {
			// 悬停判定比命中宽一点：手指/鼠标不必咬准边缘
			const s = hit(x, y);
			hoverSlot = s >= 0 ? s : -1;
			return s;
		},
		beginDrag(x, y) {
			const { x: cx, y: cy } = center();
			dragging = true;
			dragStartAngle = Math.atan2(x - cx, -(y - cy));
			dragStartRot = rot;
		},
		drag(x, y) {
			if (!dragging) return;
			const { x: cx, y: cy } = center();
			const a = Math.atan2(x - cx, -(y - cy));
			targetRot = dragStartRot + (a - dragStartAngle);
		},
		endDrag() {
			dragging = false;
			targetRot = null;
		},
		press(x, y) {
			pressed = true;
			pressAt = performance.now();
			hoverSlot = hit(x, y);
		},
		release() {
			pressed = false;
		},
		heldMs: () => (pressed ? performance.now() - pressAt : 0),
		toggle(slot) {
			if (expandSlot === slot && expandTarget > 0) {
				expandTarget = 0;
				expandSlot = -1;
				return -1;
			}
			expandSlot = slot;
			if (expand < 0.02) expand = 0.02;
			expandTarget = 1;
			targetRot = null;
			return slot;
		},
		expanded: () => (expandTarget > 0 ? expandSlot : -1),
		expandProgress: () => (expandTarget > 0 ? expand : 0),
		expandedBox() {
			if (expandSlot < 0 || expand <= 0.001) return null;
			const e = expandedRect();
			const t = smoothstep(expand);
			return { x: e.x, y: e.y, w: e.w * t, h: e.h * t, size: e.size };
		},
		collected: () => collected,
		markCollected(slot) {
			collected[slot] = true;
		},
		slots() {
			return Array.from({ length: SLOTS }, (_, i) => {
				const st = slotState(i);
				return {
					slot: i,
					x: st.x,
					y: st.y,
					pw: st.pw,
					ph: st.ph,
					size: fitSize(
						PANELS[i].title,
						st.pw * TEXT_FILL_W,
						st.ph * TEXT_FILL_H,
					),
				};
			});
		},
	};
}
