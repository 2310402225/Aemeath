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
	dprCap,
	goldRgba,
	inkRgba,
	lampRgba,
	lerp,
	PAPER,
	smoothstep,
	woodRgba,
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
/** 光影条纹从灯心往外能照到几个 R。
 *  0.95 正好停在最外那道钟圈（R）里侧：光纹照到钟圈外面，就变成一圈扫过的扇叶了。 */
const STREAK_REACH = 0.95;
/** 长按多久算「收藏」（触屏没有右键，这是替代手势） */
export const HOLD_TO_COLLECT = 1.5;
/** 灯片木框的粗细（相对灯片短边）。走马灯是木头架的，灯片不该浮在空气里。 */
const FRAME_RATIO = 0.05;
/** 木框贴在纸边上，所以它往纸外多占这么多 —— 判定命中时要把它算进去，
 *  否则「点得到框、选不中灯片」。 */
function frameOut(pw: number, ph: number): number {
	return Math.min(pw, ph) * FRAME_RATIO;
}

/**
 * 「推开纸窗」那一下的鼓胀。
 *
 * 几何仍旧走 smoothstep（`expandedBox` 也走它，两者的终值必须都是 1，
 * 否则自测里「字进得去框」的断言会跟着浮动），只在**画的这一侧**中段鼓 3.5%：
 * 纸窗被推开时先涨一下再回正，那点回正就是「纸」的手感，不是弹簧玩具。
 */
function pushOpen(ease: number): number {
	return 1 + 0.035 * Math.sin(Math.PI * clamp(ease, 0, 1));
}

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
	/** 收藏得手的那一下：从那张灯片炸开一圈金尘 + 一圈金色涟漪 */
	burst: (slot: number) => void;
	/** 每张灯片现在的几何（位置、框、字号）—— 给页内自测断言「字进得去框」。 */
	slots: () => {
		slot: number;
		x: number;
		y: number;
		pw: number;
		ph: number;
		size: number;
		/** 木框往外占多少 —— 断言「框不碰题名」时要用 */
		frame: number;
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
	/** 收藏得手时从灯片炸开的一圈金涟漪。 */
	const pulses: { x: number; y: number; life: number; r: number }[] = [];

	const PANEL_CACHE_LIMIT = 64;

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = dprCap();
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

	/** 灯罩纸：上暖下淡、中间比边缘亮（灯在里面），外套一圈木框，
	 *  里衬一道隔扇内框与几根纸纤维，最外是两道错开的淡墨边。
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
		const rad = Math.min(pw, ph) * 0.14;
		// 木框压在纸边上：描边中心落在纸边界上，纸再画上来盖掉里侧的一半，
		// 留下的就是刚好贴在纸外的一圈框（不与纸留缝、也不吃掉纸里那一块）。
		const out = frameOut(pw, ph);
		g.strokeStyle = woodRgba(c, 0.5 * keep);
		g.lineWidth = out;
		g.beginPath();
		g.roundRect(-out / 2, -out / 2, pw + out, ph + out, rad + out / 2);
		g.stroke();

		const grad = g.createLinearGradient(0, 0, 0, ph);
		// 灯罩纸比页面那种宣纸更暖一档：它是被灯从里面照着的，
		// 和「外面的纸」同一个白，灯就白点了（这页的纸本来就接近白，光只能靠暖度说话）。
		grad.addColorStop(0, paper(255, 250, 232));
		grad.addColorStop(0.55, paper(252, 243, 220));
		grad.addColorStop(1, paper(244, 230, 200));
		g.fillStyle = grad;
		g.beginPath();
		g.roundRect(0, 0, pw, ph, rad);
		g.fill();

		// 纸纤维：灯罩纸也是纸。三根不起眼的横丝，够让人觉得它是「一张」东西
		g.save();
		g.beginPath();
		g.roundRect(0, 0, pw, ph, rad);
		g.clip();
		g.strokeStyle = `rgb(180 168 146 / ${0.16 * keep})`;
		g.lineWidth = Math.max(0.5, ph * 0.0035);
		for (const [i, ky] of [0.22, 0.53, 0.79].entries()) {
			const y = ph * ky;
			g.beginPath();
			g.moveTo(0, y);
			g.quadraticCurveTo(
				pw * (0.3 + i * 0.12),
				y + ph * 0.035,
				pw,
				y - ph * 0.012,
			);
			g.stroke();
		}
		g.restore();

		// 隔扇内框：双细线，离纸边一圈。题名最多占到 68%，不会碰到它。
		const inset = Math.min(pw, ph) * 0.075;
		g.strokeStyle = woodRgba(c, 0.3 * keep);
		g.lineWidth = Math.max(0.5, Math.min(pw, ph) * 0.008);
		g.beginPath();
		g.roundRect(inset, inset, pw - inset * 2, ph - inset * 2, rad * 0.62);
		g.stroke();
		// 四角各一道短角饰：中式隔扇的角花，比一整圈花格安静得多
		g.lineCap = "round";
		for (const [sx, sy] of [
			[1, 1],
			[-1, 1],
			[1, -1],
			[-1, -1],
		]) {
			const ax = sx > 0 ? inset : pw - inset;
			const ay = sy > 0 ? inset : ph - inset;
			const len = Math.min(pw, ph) * 0.1;
			g.beginPath();
			g.moveTo(ax + sx * len, ay);
			g.lineTo(ax, ay);
			g.lineTo(ax, ay + sy * len);
			g.stroke();
		}

		// 淡墨边：两条错开一点点的细线，比一条干净的线更像手画的
		for (const off of [0, hair * 1.2]) {
			g.strokeStyle = inkRgba(c, (off === 0 ? 0.34 : 0.12) * keep);
			g.lineWidth = hair;
			g.beginPath();
			g.roundRect(off, off, pw - off * 2, ph - off * 2, rad);
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

	/**
	 * 灯里漏出来的光。**只画一件事**：从六道缝里往外投的光影。
	 *
	 *  灯心那团亮不归这一层 —— 它是钟层「灯壁」留出来的那块白（clock.ts 的 drawFace）。
	 *  这一层在钟层**上面**，在这儿再堆一层加色只会把针和刻度一起洗白。
	 *
	 *  ⚠️ 六个光斑打在**灯片之间的缝**上（`st.a + π/SLOTS`），不是打在灯片自己的角度上。
	 *  第一版画在灯片上，结果那六张纸是不透明的、正好把条纹整段盖住 ——
	 *  从外面只看得到「条纹确实在转」，看不到条纹本身。光本来也就是从缝里漏出来的。
	 *
	 *  ⚠️ 这层加色**要落在暗带上才看得见**。它是往纸色上加暖黄，而暖黄
	 *  (255,230,176) 的亮度其实**低于**纸 (240,234,222) —— 在没压暗的灯心里画，
	 *  算出来是「更暗」而不是「更亮」，白费。灯壁那一环压下去之后，光纹才有东西可加。
	 *
	 *  亮度一律走 `lampRgba`：越往回拨越暖越暗，这一层自己不用知道时间。
	 */
	function drawLightField() {
		const R = radius();
		const { x: cx, y: cy } = center();
		const dim = 1 - 0.5 * expand;

		// 灯心的那团亮**不在这里画** —— 它是钟层的「灯壁」留出来的那块白
		// （见 clock.ts 的 drawFace）。这一层在钟层**上面**，在这里再堆一层加色
		// 只会把针和刻度洗白一遍。这一层只负责一件钟层画不了的事：
		// 光**从六道缝里漏出来**。缝在两张灯片中间，也就是比灯片自己的角度再转半个格。
		//
		// ⚠️ 光带**不许从灯心起笔**。第一版梯度从 0 就开始加色，六条带子从圆心射出去 ——
		// 画面上是一圈辐条，整只钟读成一只木轮子。真灯的光也不是从轴上漏的，
		// 是从**灯片那一段缝**里漏的。所以 0.4 之前一律透明，峰值落在 0.72（约 0.68R），
		// 正好是灯片所在的那一圈。
		//
		// ⚠️ 一条光柱**两侧不能是硬边**。canvas 的扇形只会在两侧切出两条直线，
		// 六道一起画出来就是一把扇子／一条孔雀尾 —— 是图案，不是光。
		// 光柱的边缘要化开，所以每条画两层：宽而淡、窄而浓，叠起来两侧就成了一道坡。
		// （一层就想要柔边只能上 `ctx.filter`，那要每帧把整幅模糊一遍，不值。）
		//
		// ⚠️ 但**不能摊太开**。第一版用三层、最外那层半宽 0.078rad，六道一起糊上去
		// 把整只灯盘洗成一层奶雾，赭晕的对比全被吃掉 —— 那不是「亮」，是「霾」。
		const r1 = R * STREAK_REACH;
		// [宽度倍数, 浓度倍数]：由外到内
		const shafts = [
			[1, 0.24],
			[0.55, 0.34],
		] as const;
		for (let i = 0; i < SLOTS; i++) {
			const a = slotState(i).a + Math.PI / SLOTS;
			const near = (Math.cos(a - Math.PI) + 1) / 2;
			const bright = (0.35 + 0.65 * near) * dim * 0.75;
			const half = 0.042 + 0.022 * near;
			for (const [wk, wa] of shafts) {
				const g = ctx.createLinearGradient(
					cx,
					cy,
					cx + Math.sin(a) * r1,
					cy - Math.cos(a) * r1,
				);
				g.addColorStop(0, lampRgba(c, 0));
				g.addColorStop(0.4, lampRgba(c, 0));
				g.addColorStop(0.72, lampRgba(c, wa * bright));
				g.addColorStop(1, lampRgba(c, 0));
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				// 画布的角度从 +x 轴起算，而这一页的 a 是「12 点为 0、顺时针为正」，
				// 方向向量是 (sin a, −cos a)，换算过去就是 a − π/2。
				const h = half * wk;
				ctx.arc(cx, cy, r1, a - Math.PI / 2 - h, a - Math.PI / 2 + h);
				ctx.closePath();
				ctx.fill();
			}
		}
	}

	/** 收藏得手的那一圈金涟漪。 */
	function drawPulses() {
		for (const p of pulses) {
			const k = 1 - p.life;
			ctx.strokeStyle = goldRgba(0.5 * p.life * p.life);
			ctx.lineWidth = Math.max(1, 6 * p.life * (p.r / 120));
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r * (0.35 + k * 1.25), 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	function drawPanels() {
		const ease = smoothstep(expand);
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
				// 几何走 smoothstep、鼓胀走 pushOpen：终值都是 1，所以落位之后
				// 与 expandedBox 完全对得上（写字那一下才不会错位）。
				const k = pushOpen(ease);
				x = st.x + (e.x - st.x) * ease;
				y = st.y + (e.y - st.y) * ease;
				pw = st.pw + (e.w * k - st.pw) * ease;
				ph = st.ph + (e.h * k - st.ph) * ease;
				alpha = Math.max(st.alpha, 0.94);
				tilt = st.tilt * (1 - ease);
			} else if (expandSlot >= 0) {
				// 有一张展开了，其余的退到后面去
				alpha *= 1 - 0.62 * ease;
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

			// 灯片的暖光晕：悬停或被选中时更亮，像灯捻被挑了一下。
			// 展开的那张另加一层「涌出来的光」—— 纸窗推开，灯里的光一下就出来了。
			//
			// ⚠️ 半径必须**小于**灯片间距的一半（灯片间距 = 环周 2πR/6 ≈ 1.05R，
			// 六片的光晕半径一旦超过 0.52R 就会互相咬住、把整圈填成一片亮，
			// 那六道缝里的光影就再也看不出来了 —— 之前 1.25×灯片宽正是这个毛病。
			const lit = i === hoverSlot || isExpanded;
			const spill = isExpanded ? ease : 0;
			if (lit || st.near > 0.35) {
				const rr = pw * (isExpanded ? 1.5 : 0.9);
				const glow = ctx.createRadialGradient(x, y, 0, x, y, rr);
				glow.addColorStop(
					0,
					lampRgba(c, (lit ? 0.44 : 0.17) * st.near + spill * 0.34),
				);
				glow.addColorStop(
					0.55,
					lampRgba(c, (lit ? 0.19 : 0.06) * st.near + spill * 0.16),
				);
				glow.addColorStop(1, lampRgba(c, 0));
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(x, y, rr, 0, Math.PI * 2);
				ctx.fill();
			}

			const art = panelArt(i, pw, ph, textSize);
			const out = frameOut(pw, ph);
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(x, y);
			ctx.rotate(tilt);
			if (collected[i] || spill > 0.01) {
				// 收藏过的灯片在角上多一道金边；展开的那张同样镶一道，
				// 于是「开着的那扇窗」和「收下的那张」用的是同一个记号。
				const pad = out + (spill > 0.01 ? 3 : 5);
				ctx.strokeStyle = goldRgba(0.4 * Math.max(collected[i] ? 1 : 0, spill));
				ctx.lineWidth = Math.max(1, out * 0.14);
				ctx.beginPath();
				ctx.roundRect(
					-pw / 2 - pad,
					-ph / 2 - pad,
					pw + pad * 2,
					ph + pad * 2,
					out + pad,
				);
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
			expand += (expandTarget - expand) * Math.min(1, dt * 6.5);
		else expand = expandTarget;

		// 转：拖拽时向目标阻尼收敛；悬停减速；按住冻结；静思模式下彻底停住
		const frozen = pressed || expand > 0.35;
		if (targetRot != null) {
			rot += (targetRot - rot) * Math.min(1, dt * 7);
		} else if (!frozen) {
			const speedMul =
				(hoverSlot >= 0 ? 0.22 : 1) *
				clamp(c.speed, 0.25, 3) *
				(1 - 0.5 * c.rewind) *
				(1 - c.still);
			rot += ((Math.PI * 2) / LAP_SECONDS) * dt * speedMul;
		}

		// 金尘 / 时光粒子：环在动、且还没被褪色压住的时候才逸散。
		// 这是全页唯一一套粒子 —— 再做第二套只是白花两份预算。
		const want = !frozen && c.rewind < 0.75 && c.still < 0.5;
		if (want && Math.random() < dt * 6) {
			const a = rot + Math.random() * Math.PI * 2;
			const { x: cx, y: cy } = center();
			const ringR = radius() * 0.585;
			dust.push({
				x: cx + Math.sin(a) * ringR,
				y: cy - Math.cos(a) * ringR,
				vx: (Math.random() - 0.5) * 12,
				vy: -6 - Math.random() * 12,
				life: 2.4 + Math.random() * 2,
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
		if (dust.length > 90) dust.splice(0, dust.length - 90);
		for (let i = pulses.length - 1; i >= 0; i--) {
			pulses[i].life -= dt * 1.5;
			if (pulses[i].life <= 0) pulses.splice(i, 1);
		}

		ctx.clearRect(0, 0, w, h);
		drawLightField();
		drawPanels();
		drawPulses();
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
		// 木框也算这张灯片的一部分：点得到框，就该选得中它
		const out = frameOut(st.pw, st.ph);
		const padX = st.pw / 2 + out + 8;
		const padY = st.ph / 2 + out + 10;
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
			// 每格顿一下：离某一格只差一成的时候往回拉掉大半，松手总停在灯片正中。
			// 与拨针的齿感同一套做法 —— 一页里两种「格」不该是两种手感。
			const step = (Math.PI * 2) / SLOTS;
			const near = Math.round(targetRot / step) * step;
			const off = targetRot - near;
			if (Math.abs(off) < step * 0.1) targetRot = near + off * 0.32;
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
		burst(slot) {
			const st = slotState(slot);
			pulses.push({ x: st.x, y: st.y, life: 1, r: Math.max(st.pw, st.ph) });
			for (let i = 0; i < 16; i++) {
				const a = Math.random() * Math.PI * 2;
				const v = 30 + Math.random() * 90;
				dust.push({
					x: st.x,
					y: st.y,
					vx: Math.cos(a) * v,
					vy: Math.sin(a) * v - 24,
					life: 1.1 + Math.random() * 1.1,
					r: 0.8 + Math.random() * 1.6,
				});
			}
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
					frame: frameOut(st.pw, st.ph),
				};
			});
		},
	};
}
