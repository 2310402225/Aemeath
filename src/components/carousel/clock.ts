// 墨钟：一只用毛笔画出来的表盘 + 一根可以拨回去的针。
//
// 语义（三处交互都建立在这上面）：
//   一圈 = 一段可以回望的时间，12 点方向是「此刻」。
//   针自己顺时针慢慢走 —— 时间在流逝，所以你拨出来的倒流度会自己慢慢缩小。
//   你把针逆时针推回去，就是让时光倒流：纸开始褪色、墨开始变褐、灯转得慢下来。
//   双击钟心（或按右下角那颗按钮）把针拨回此刻。
//
// 刻度同时是「记忆的落点」：点刻度落一颗永久墨点，收藏一张灯片落一颗金点。

import {
	type Couplings,
	clamp,
	dprCap,
	goldRgba,
	inkRgba,
	lampRgba,
	lerp,
	rewindFromAngle,
	smoothstep,
	wallRgba,
} from "./couplings";

/** 12 个刻度，4 个主刻度（含 12 点）。 */
export const TICK_COUNT = 12;
const TICK_MAIN_EVERY = 3;

/** 毛笔圆：画一圈要用多少段。抖动表必须与它等长 ——
 *  长度不等就会在 i 绕回 0 的地方把半径硬拽一下，圆上出现一个看得见的折点
 *  （96 段配 72 个抖动值时，折点正好落在 9 点方向）。 */
const RIM_SEGS = 96;
/** 针自己走一圈要多久（秒）。四分钟一圈：看得出在走，又不会一分钟就褪回原样。 */
const DRIFT_LAP_SECONDS = 240;
/** 指针可以被拖到的最外层 / 最内层（相对半径）。 */
const HAND_INNER = 0.16;
/** 墨点落地那一下：先「滴」下来再「晕」开，两个时长。 */
const DROP_MS = 0.24;
const BLOOM_MS = 0.42;
/** 刻度上落墨点的半径（按 R=300 那一档量的，随 R 缩放）。 */
const MARK_R = 5.6;
/** 旧时光颗粒的贴图边长（设备像素）。小了会看出重复，大了白占内存。 */
const GRAIN_PX = 128;

/** 一张确定性的噪点贴图，铺满全屏做胶片颗粒。
 *  每帧现算 130 万像素的随机数是不可能的，所以烘一张小图然后平铺。 */
function makeGrain(): HTMLCanvasElement {
	const cv = document.createElement("canvas");
	cv.width = GRAIN_PX;
	cv.height = GRAIN_PX;
	const g = cv.getContext("2d");
	if (!g) return cv;
	const img = g.createImageData(GRAIN_PX, GRAIN_PX);
	const rnd = lcg(20260926);
	for (let i = 0; i < img.data.length; i += 4) {
		// 亮暗各一半：只有暗点会变成一层灰，只有亮点会变成一层雾
		const v = rnd() < 0.5 ? 0 : 255;
		img.data[i] = v;
		img.data[i + 1] = v;
		img.data[i + 2] = v;
		img.data[i + 3] = 255;
	}
	g.putImageData(img, 0, 0);
	return cv;
}

function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (1103515245 * s + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

/** 一点落在第几刻度上（0 = 12 点，顺时针）。 */
export function tickAt(x: number, y: number, cx: number, cy: number): number {
	const a = Math.atan2(x - cx, -(y - cy)); // 12 点方向为 0，顺时针为正
	const turns = (((a / (Math.PI * 2)) % 1) + 1) % 1;
	return Math.round(turns * TICK_COUNT) % TICK_COUNT;
}

export type Mark = {
	/** 落在第几刻度 */
	tick: number;
	kind: "ink" | "gold";
	/** 灯片下标（只有金点有） */
	slot: number;
	born: number;
};

export type Clock = {
	resize: () => void;
	frame: (dt: number) => void;
	/** 半径，走马灯要用它算内环 */
	radius: () => number;
	center: () => { x: number; y: number };
	/** 落点在钟的哪一部分：针 / 刻度 / 圆心 / 都不在 */
	partAt: (x: number, y: number) => "hand" | "tick" | "center" | null;
	/** 准备拨针：记下指针当前的角度，之后 drag 靠**累加角差**来转针。
	 *  为什么不拿 atan2 的绝对值直接换算：atan2 只落在 (−π, π]，针一旦被拨过半圈，
	 *  角度就折回来了 —— 表现为「再往下拨突然弹回此刻」，而且 smoothstep 那半边的
	 *  「少年 / 幼时」永远够不着。累加角差没有这个上界。 */
	beginDrag: (x: number, y: number) => void;
	/** 指针按下之后每一动的落点（内部会换算成倒流度） */
	drag: (x: number, y: number) => void;
	endDrag: () => void;
	reset: () => void;
	dropMark: (tick: number, kind: "ink" | "gold", slot?: number) => void;
	marks: () => readonly Mark[];
	/** 倒流度（由 couplings 持有，这里给个只读视图方便自测断言） */
	rewind: () => number;
	/** 唯一的真源：逆时针偏离 12 点的弧度。`rewind` 要等下一帧才会跟上，
	 *  所以要「从当前状态再拨一段」时必须读它，读 rewind 会拿到上一帧的旧值。 */
	sweep: () => number;
};

export function createClock(canvas: HTMLCanvasElement, c: Couplings): Clock {
	const ctxRaw = canvas.getContext("2d");
	if (!ctxRaw) throw new Error("clock: 拿不到 2d 上下文");
	// ⚠️ 必须另绑一个非空常量。`if (!ctx) throw` 的收窄**进不了下面那些被提升的
	// function 声明**（ts 18047）：函数声明会被提到守卫之前，TS 不敢假设守卫跑过。
	// 直接沿用 `ctx` 的话，那几十处全是「possibly null」，而运行期其实一定不空。
	const ctx: CanvasRenderingContext2D = ctxRaw;

	let w = 0;
	let h = 0;
	let dpr = 1;
	let cx = 0;
	let cy = 0;
	let R = 100;
	/** 逆时针偏离「此刻」的弧度，0..2π。这是本页唯一的时间真源。 */
	let swept = 0;
	/** 复位时用的缓动目标（null = 不在复位） */
	let resetting = false;
	/** 拨针时上一帧的指针角，见 beginDrag */
	let lastAngle = 0;
	/** 是不是正在拨（没 beginDrag 就 drag 会被忽略，免得拿陈旧的角算出一次大跳） */
	let turning = false;
	const marks: Mark[] = [];
	/** 纸纹那侧的随机：钟面的圆要有手画的抖，但不能每帧变。
	 *  预先把表旋转出几份，而不是在循环里 `(i + seed) % n` —— 后者到了绕回的那一段
	 *  会从表尾直接跳回表头，半径硬拽一下，圆上就多出一个折点。
	 *  旋转过的表首尾是连着的，怎么绕都不会断。 */
	const base = Array.from({ length: RIM_SEGS }, (_, i) => {
		const rnd = lcg(4471 + i);
		return (rnd() - 0.5) * 2;
	});
	const rimJitter = [0, 17].map((k) => base.slice(k).concat(base.slice(0, k)));
	let t = 0;
	/** 颗粒贴图与它的 pattern。pattern 跟画布尺寸无关，只在首帧建一次。 */
	const grain = makeGrain();
	let grainPat: CanvasPattern | null = null;
	/** 六张灯片收齐 → 钟盘金边的显现进度（0..1，不跟 rewind 走）。 */
	let allT = 0;

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = dprCap();
		w = Math.max(1, Math.round(rect.width));
		h = Math.max(1, Math.round(rect.height));
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		grainPat = ctx.createPattern(grain, "repeat");
		cx = w / 2;
		// 钟心明显偏下：上面那一条是留给标题的（眉题 + h1 + 副题 + 一句提示），
		// 钟顶必须落在它底下，否则 12 点那张灯片正好被标题压住 —— 六张灯片里
		// 少一张是看不出来的，只会觉得「上面那张怎么是空的」。
		cy = h * 0.6;
		// 宽屏按高度定半径（否则钟会撑出屏幕），窄屏按宽度定（否则手机上钟太小）。
		R = Math.min(w * 0.42, h * 0.33);
	}

	/** 毛笔圆：半径与线宽都带一点抖，闭合处重叠收尾 —— 手画的圆不可能等宽。 */
	function inkCircle(
		radius: number,
		baseWidth: number,
		alpha: number,
		seed: number,
	) {
		const segs = RIM_SEGS;
		// seed 在这里当「第几份抖动表」用（0 = 外圈，17 = 内圈）
		const jitter = rimJitter[seed % rimJitter.length];
		ctx.lineCap = "round";
		for (let i = 0; i < segs; i++) {
			const a0 = (i / segs) * Math.PI * 2;
			const a1 = ((i + 1) / segs) * Math.PI * 2;
			const j0 = jitter[i];
			const j1 = jitter[(i + 1) % segs];
			const r0 = radius + j0 * baseWidth * 0.8;
			const r1 = radius + j1 * baseWidth * 0.8;
			// 线宽沿着圆缓慢变化，像落笔时提按了一次
			const press = 0.55 + 0.45 * Math.sin((i / segs) * Math.PI * 2 + seed);
			ctx.lineWidth = baseWidth * (0.45 + press);
			ctx.strokeStyle = inkRgba(c, alpha * (0.75 + 0.25 * press));
			ctx.beginPath();
			ctx.moveTo(cx + Math.sin(a0) * r0, cy - Math.cos(a0) * r0);
			ctx.lineTo(cx + Math.sin(a1) * r1, cy - Math.cos(a1) * r1);
			ctx.stroke();
		}
	}

	function drawFace() {
		const ageT = c.rewind;
		// 有灯片展开时整圈退到后面：让位，但别整个消失（那是「退后」不是「关灯」）
		const back = 1 - 0.55 * c.focus;

		// ── 灯壁 ──────────────────────────────────────────────────────────────
		// 一整页最缺的不是光，是暗端。见 couplings.ts 的 WALL_NEW：纸是 (240,234,222)，
		// 往白上加暖光只有六七级，画了看不出来；得先把灯的内壁压下去。
		//
		// 形状是**一个墨环，不是一枚圆片，也不是一只球**：
		//   灯心（0–0.44R）几乎摊平 —— 纸本身就是最亮的地方，针、轴心、读数全在这一块，
		//                       留白它们才最好认。这一段必须是**平**的：一旦从圆心就开始
		//                       渐暗，整只钟立刻读成一只鼓起来的碗；
		//   0.5–0.86R 压下去，0.78R 最深 —— 六张灯片占 0.37R–0.80R（slotState 的
		//                       ringR=0.585R 加减 ph/2），暗带压在它们身下，
		//                       纸灯片才从暗里亮出来；
		//   0.94R 起彻底收干净 —— 刻度（0.873–0.935R）与最外那道钟圈都得留在亮处，
		//                       否则墨色的刻度会沉进暗里看不见。
		// 两头都是渐收的，所以钟盘不会变成一枚贴在纸上的棕色圆片。
		//
		// ⚠️ 必须画在**这一层**（钟层在走马灯层下面）：灯片、木框、刻度、针全都在它上面，
		// 画到走马灯层去就会把刻度与针整片盖掉。
		//
		// ⚠️ 这一层**不随 focus 变淡**：灯片推开时它在暗里推出来，才叫「推窗」。
		const wall = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
		wall.addColorStop(0, wallRgba(c, 0.02));
		wall.addColorStop(0.3, wallRgba(c, 0.05));
		wall.addColorStop(0.44, wallRgba(c, 0.13));
		wall.addColorStop(0.56, wallRgba(c, 0.34));
		wall.addColorStop(0.68, wallRgba(c, 0.54));
		wall.addColorStop(0.78, wallRgba(c, 0.62));
		wall.addColorStop(0.86, wallRgba(c, 0.48));
		wall.addColorStop(0.92, wallRgba(c, 0.24));
		wall.addColorStop(0.97, wallRgba(c, 0.06));
		wall.addColorStop(1, wallRgba(c, 0));
		ctx.fillStyle = wall;
		ctx.beginPath();
		ctx.arc(cx, cy, R, 0, Math.PI * 2);
		ctx.fill();

		// 灯壁也得是「纸」：纯径向渐变看着像一片塑料壳，铺一层极淡的纸纹
		// 才有墨落在纸上的颗粒感。与末尾那层胶片颗粒同一张图，浓度低一档。
		if (grainPat) {
			ctx.globalAlpha = 0.03;
			ctx.fillStyle = grainPat;
			ctx.beginPath();
			ctx.arc(cx, cy, R, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		}

		// 破对称：一个完美的径向渐变永远读成「一只罩子」。往环上撒六团浓淡不一的墨，
		// 让浓度沿圆周不均匀 —— 手画出来的一圈墨不该是数学圆。
		// 位置取**定表**（不随帧变）：会呼吸的墨环看着像有生命，反而假。
		const mottle = lcg(90210);
		for (let i = 0; i < 6; i++) {
			const ma = mottle() * Math.PI * 2;
			const mr = R * (0.52 + mottle() * 0.28);
			const mb = R * (0.18 + mottle() * 0.2);
			const mx = cx + Math.sin(ma) * mr;
			const my = cy - Math.cos(ma) * mr;
			const blot = ctx.createRadialGradient(mx, my, 0, mx, my, mb);
			blot.addColorStop(0, wallRgba(c, 0.08 + 0.1 * mottle()));
			blot.addColorStop(1, wallRgba(c, 0));
			ctx.fillStyle = blot;
			ctx.beginPath();
			ctx.arc(mx, my, mb, 0, Math.PI * 2);
			ctx.fill();
		}

		// 双圈：外圈稍浓、内圈极淡，像两层墨洇开的边
		inkCircle(R, Math.max(1.1, R * 0.0055), 0.72 * back, 0);
		inkCircle(R * 0.955, Math.max(0.6, R * 0.0022), 0.3 * back, 17);

		// 六张灯片收齐之后，钟盘外沿再压一道鎏金边。这一笔是「攒齐了」的凭据，
		// 所以它不随时间回退褪色 —— 只有这一处金色不受 age 管。
		if (allT > 0.002) {
			ctx.beginPath();
			ctx.arc(cx, cy, R * 1.014, 0, Math.PI * 2);
			ctx.strokeStyle = goldRgba(0.12 * allT * back);
			ctx.lineWidth = Math.max(3, R * 0.014);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(cx, cy, R * 1.014, 0, Math.PI * 2);
			ctx.strokeStyle = goldRgba(0.5 * allT * back);
			ctx.lineWidth = Math.max(1, R * 0.0034);
			ctx.stroke();
		}

		// 刻度分三档：此刻（最浓）／主刻度（含洇墨）／其余（最细）。
		// 主刻度底下先铺一层宽而淡的墨：那是笔尖落纸时被吸进去的那一口。
		// 只给主刻度铺 —— 十二根都铺，一整圈就糊成一环灰。
		for (let i = 0; i < TICK_COUNT; i++) {
			const a = (i / TICK_COUNT) * Math.PI * 2;
			const main = i % TICK_MAIN_EVERY === 0;
			const isNow = i === 0;
			const len = R * (main ? 0.062 : 0.036);
			const width = Math.max(0.9, R * (main ? 0.0085 : 0.0045));
			const r0 = R * 0.935;
			const r1 = r0 - len;
			const sinA = Math.sin(a);
			const cosA = Math.cos(a);
			if (main) {
				const over = width * 0.9;
				ctx.strokeStyle = inkRgba(c, (isNow ? 0.14 : 0.1) * back);
				ctx.lineWidth = width * 3.4;
				ctx.lineCap = "round";
				ctx.beginPath();
				ctx.moveTo(cx + sinA * (r0 + over), cy - cosA * (r0 + over));
				ctx.lineTo(cx + sinA * (r1 - over), cy - cosA * (r1 - over));
				ctx.stroke();
			}
			ctx.strokeStyle = inkRgba(c, (isNow ? 0.8 : main ? 0.6 : 0.34) * back);
			ctx.lineWidth = width;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(cx + sinA * r0, cy - cosA * r0);
			ctx.lineTo(cx + sinA * r1, cy - cosA * r1);
			ctx.stroke();
			// 「此刻」的刻度旁边再点一个更小的点，好认
			if (isNow) {
				ctx.beginPath();
				ctx.arc(
					cx + sinA * R * 1.035,
					cy - cosA * R * 1.035,
					Math.max(1.4, R * 0.011),
					0,
					Math.PI * 2,
				);
				ctx.fillStyle = inkRgba(c, 0.55 * back);
				ctx.fill();
			}
		}

		// 内环：给走马灯一个「转盘」的托，不至于悬在空中。
		// ⚠️ 有了灯壁之后这一笔得改成**暖的**：0.6R 正落在暗带里，墨色画进去等于没画。
		ctx.beginPath();
		ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
		ctx.strokeStyle = lampRgba(c, (0.1 + 0.06 * (1 - ageT)) * back);
		ctx.lineWidth = Math.max(0.6, R * 0.0018);
		ctx.stroke();
	}

	/** 墨点：一颗，不是一圈。三层同心、彼此错开一点，看起来才是墨洇出来的。 */
	function drawDot(
		x: number,
		y: number,
		radius: number,
		kind: "ink" | "gold",
		alpha: number,
	) {
		const rnd = lcg(Math.round(x * 7 + y * 13));
		const layers = kind === "gold" ? 2 : 3;
		for (let i = 0; i < layers; i++) {
			const off = rnd() * radius * 0.5;
			const ang = rnd() * Math.PI * 2;
			const r = radius * (1 - i * 0.24);
			const gx = x + Math.cos(ang) * off;
			const gy = y + Math.sin(ang) * off;
			const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
			if (kind === "gold") {
				grad.addColorStop(0, goldRgba(alpha * 0.95));
				grad.addColorStop(0.55, goldRgba(alpha * 0.55));
				grad.addColorStop(1, goldRgba(0));
			} else {
				grad.addColorStop(0, inkRgba(c, alpha * 0.9));
				grad.addColorStop(0.6, inkRgba(c, alpha * 0.45));
				grad.addColorStop(1, inkRgba(c, 0));
			}
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(gx, gy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawMarks() {
		const back = 1 - 0.55 * c.focus;
		for (const m of marks) {
			const a = (m.tick / TICK_COUNT) * Math.PI * 2;
			const r = R * (m.kind === "gold" ? 0.875 : 0.9);
			const life = t - m.born;
			// 落点那一下分两个动作：先从上一格「滴」下来（纵向归位，带一点加速度），
			// 再「晕」开（半径涨到位、略微过冲再收）。只做放大是「弹出」，不是滴。
			const drop = life < DROP_MS ? (1 - smoothstep(life / DROP_MS)) ** 2 : 0;
			const bloom =
				life < BLOOM_MS
					? lerp(0.5, 1.07, smoothstep(life / (BLOOM_MS * 0.6)))
					: lerp(1.07, 1, smoothstep((life - BLOOM_MS) / 0.5));
			const x = cx + Math.sin(a) * r;
			const y = cy - Math.cos(a) * r - drop * R * 0.075;
			// 沉淀：落得越久，点越散、越淡 —— 墨在纸里是会走的
			const lifeMin = life / 60;
			const spread = bloom * (1 + Math.min(0.5, lifeMin * 0.06));
			const fade =
				Math.max(0.42, 1 - lifeMin * 0.02) * Math.min(1, life / 0.12);
			drawDot(
				x,
				y,
				(m.kind === "gold" ? 7.4 : MARK_R) * spread * (R / 300),
				m.kind,
				0.85 * fade * back,
			);
			if (m.kind === "gold") {
				// 高光：金是金属，得有一点扎眼的亮，不然只是一团土黄
				const u = (R / 300) * spread;
				ctx.beginPath();
				ctx.arc(
					x - 1.7 * u,
					y - 1.7 * u,
					Math.max(0.7, 1.5 * u),
					0,
					Math.PI * 2,
				);
				ctx.fillStyle = `rgb(255 246 220 / ${0.55 * fade * back})`;
				ctx.fill();
				ctx.beginPath();
				ctx.arc(x, y, 10.5 * (R / 300) * spread, 0, Math.PI * 2);
				ctx.strokeStyle = goldRgba(0.28 * fade * back);
				ctx.lineWidth = Math.max(0.6, R * 0.0022);
				ctx.stroke();
			}
		}
	}

	/** 针：一根毛笔。根部粗、约三分之一处最粗、尖端细成丝。
	 *
	 *  灯就在这只钟里，所以针的两条边会被灯照出一道暖光 —— 那是**光边**，
	 *  不是给针换个金色。针本身仍旧是墨，只在根部落一点明。
	 */
	function drawHand() {
		// 还没人动过的时候指针自己轻轻晃两下。这一页有四个交互，不说一句的话
		// 「拨动指针」这句提示就只是一行字 —— 手会动，人才知道可以拨。
		const a = -swept + (c.hint > 0 ? Math.sin(t * 2.2) * 0.05 * c.hint : 0);
		const len = R * 0.74;
		const dirX = Math.sin(a);
		const dirY = -Math.cos(a);
		const nx = Math.cos(a);
		const ny = Math.sin(a);
		const steps = 26;
		const thickAt = (p: number) =>
			R * 0.026 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.86);
		/** 笔形。k 是把笔加粗到几倍（光晕那层要宽一点）。 */
		const bodyPath = (k: number) => {
			ctx.beginPath();
			for (let i = 0; i <= steps; i++) {
				const p = i / steps;
				const th = thickAt(p) * k;
				const r = p * len;
				ctx.lineTo(cx + dirX * r + nx * th, cy + dirY * r + ny * th);
			}
			for (let i = steps; i >= 0; i--) {
				const p = i / steps;
				const th = thickAt(p) * k;
				const r = p * len;
				ctx.lineTo(cx + dirX * r - nx * th, cy + dirY * r - ny * th);
			}
			ctx.closePath();
		};
		/** 从轴心往针尖淡去的一道暖光：离灯越远越照不到。 */
		const rimGrad = (a0: number) => {
			const g = ctx.createLinearGradient(
				cx,
				cy,
				cx + dirX * len,
				cy + dirY * len,
			);
			g.addColorStop(0, lampRgba(c, a0));
			g.addColorStop(0.45, lampRgba(c, a0 * 0.42));
			g.addColorStop(1, lampRgba(c, 0));
			return g;
		};

		// 光晕：比笔身宽一圈的那层。去掉它针就只是一块墨，贴在纸上。
		bodyPath(1.85);
		ctx.fillStyle = rimGrad(0.26);
		ctx.fill();

		bodyPath(1);
		ctx.fillStyle = inkRgba(c, 0.92 * (1 - 0.7 * c.focus));
		ctx.fill();
		// 光边：沿笔身两条边描一道，根部浓、尖端无
		if (c.focus < 0.9) {
			ctx.strokeStyle = rimGrad(0.9);
			ctx.lineWidth = Math.max(0.7, R * 0.0042);
			ctx.stroke();
		}

		// 拖影：倒流时从针尖再拖出一条淡尾，像是被拉长了
		if (c.rewind > 0.02) {
			ctx.beginPath();
			for (let i = 0; i <= steps; i++) {
				const p = i / steps;
				const thick = R * 0.009 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.9);
				const r = p * len * lerp(1, 0.6, 1 - c.rewind);
				const aa = a + c.rewind * 0.16 * (1 - p);
				ctx.lineTo(
					cx + Math.sin(aa) * r + Math.cos(aa) * thick,
					cy - Math.cos(aa) * r + Math.sin(aa) * thick,
				);
			}
			for (let i = steps; i >= 0; i--) {
				const p = i / steps;
				const thick = R * 0.009 * Math.sin(Math.PI * p ** 0.62) * (1 - p * 0.9);
				const r = p * len * lerp(1, 0.6, 1 - c.rewind);
				const aa = a + c.rewind * 0.16 * (1 - p);
				ctx.lineTo(
					cx + Math.sin(aa) * r - Math.cos(aa) * thick,
					cy - Math.cos(aa) * r - Math.sin(aa) * thick,
				);
			}
			ctx.closePath();
			ctx.fillStyle = inkRgba(c, 0.22 * c.rewind);
			ctx.fill();
		}

		// 轴心：一颗小墨点加一圈黄铜环，把针按在纸上
		const hub = Math.max(2.6, R * 0.019);
		const hubT = (1 - 0.7 * c.focus) * allT;
		if (hubT > 0.01) {
			ctx.beginPath();
			ctx.arc(cx, cy, hub * 1.75, 0, Math.PI * 2);
			ctx.strokeStyle = goldRgba(0.4 * hubT);
			ctx.lineWidth = Math.max(0.8, R * 0.003);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(cx, cy, hub, 0, Math.PI * 2);
		ctx.fillStyle = inkRgba(c, 0.9 * (1 - 0.7 * c.focus));
		ctx.fill();
	}

	/** 旧时光滤镜。四件事叠在一起：暖雾（顺带把对比压下来一点）、中心向外暖、
	 *  四角沉、胶片颗粒。
	 *
	 *  不是「给整页加一层黄」：中心那层暖是「灯还亮着」，四角那层旧是「纸放久了」，
	 *  两者方向相反，合起来画面才有纵深。浓度一律由 age 驱动。
	 */
	function drawFilter() {
		const a = smoothstep(c.rewind);
		if (a <= 0.003) return;
		// 暖雾：一层中调暖色压上去，明暗两头都被压向中间 —— 这就是「对比微降」
		ctx.fillStyle = `rgb(124 98 62 / ${0.075 * a})`;
		ctx.fillRect(0, 0, w, h);
		// 中心向外暖：灯在钟心里，光从那儿往外铺
		const warm = ctx.createRadialGradient(
			cx,
			cy,
			0,
			cx,
			cy,
			Math.max(w, h) * 0.66,
		);
		warm.addColorStop(0, `rgb(228 178 106 / ${0.09 * a})`);
		warm.addColorStop(0.55, `rgb(228 178 106 / ${0.03 * a})`);
		warm.addColorStop(1, "rgb(228 178 106 / 0)");
		ctx.fillStyle = warm;
		ctx.fillRect(0, 0, w, h);
		// 四角沉：半径铺得比画布还大，边角就是「柔」下去的而不是被画了个框
		const vg = ctx.createRadialGradient(
			cx,
			cy,
			R * 0.35,
			cx,
			cy,
			Math.max(w, h) * 0.95,
		);
		vg.addColorStop(0, "rgb(96 76 46 / 0)");
		vg.addColorStop(1, `rgb(96 76 46 / ${0.11 * a})`);
		ctx.fillStyle = vg;
		ctx.fillRect(0, 0, w, h);
		// 颗粒：位置每 0.1 秒换一次（60 帧全换会沸得像沙暴），浓度跟着 age 涨。
		// prefers-reduced-motion 下不换位置 —— 抖的是它的位置，不是浓度。
		if (grainPat && a > 0.02) {
			const tick10 = Math.floor(t * 10);
			const ox = c.calm ? 0 : -(((tick10 * 37) % 97) / 97) * GRAIN_PX;
			const oy = c.calm ? 0 : -(((tick10 * 61) % 89) / 89) * GRAIN_PX;
			ctx.save();
			ctx.translate(ox, oy);
			ctx.globalAlpha = 0.03 + 0.05 * a;
			ctx.fillStyle = grainPat;
			ctx.fillRect(0, 0, w + GRAIN_PX, h + GRAIN_PX);
			ctx.restore();
		}
	}

	function frame(dt: number) {
		t += dt;
		if (resetting) {
			// 复位不是瞬间跳回去：针要有「被拨回来」的动作，所以走缓动
			swept = Math.max(0, swept - dt * 9);
			if (swept <= 0.0005) {
				swept = 0;
				resetting = false;
			}
		} else if (!c.dragging) {
			// 时间在流逝：针顺时针慢慢走，于是倒流度自己一点点缩小。
			// 静思模式下这一项归零 —— 时间不流了，才叫静。
			swept = Math.max(
				0,
				swept -
					(Math.PI * 2 * dt * c.speed * (1 - c.still)) / DRIFT_LAP_SECONDS,
			);
		}
		c.rewind = rewindFromAngle(swept);
		// 金边是「攒齐了」的凭据，不跟时间走 —— 攒下的东西不该因为倒流就没了
		allT += ((c.allCollected ? 1 : 0) - allT) * Math.min(1, dt * 2.4);

		ctx.clearRect(0, 0, w, h);
		drawFace();
		drawMarks();
		drawHand();
		drawFilter();
	}

	return {
		resize,
		frame,
		radius: () => R,
		center: () => ({ x: cx, y: cy }),
		partAt(x, y) {
			const d = Math.hypot(x - cx, y - cy);
			// 钟外一律 null：外面的落点是「空白」（写字）或旧物剪影的地盘
			if (d > R * 1.05) return null;
			if (d < R * HAND_INNER) return "center";
			if (d > R * 0.86) return "tick";
			return "hand";
		},
		beginDrag(x, y) {
			const d = Math.hypot(x - cx, y - cy);
			if (d < R * 0.12) {
				turning = false;
				return;
			}
			turning = true;
			lastAngle = Math.atan2(x - cx, -(y - cy));
		},
		drag(x, y) {
			// 落点换算成「逆时针偏离 12 点的弧度」。拖在钟心附近时角度不稳，直接忽略。
			if (!turning) return;
			const d = Math.hypot(x - cx, y - cy);
			if (d < R * 0.12) return;
			const cw = Math.atan2(x - cx, -(y - cy));
			// 跨过 ±π 的那一帧角差会突然差一整圈，补回来才是连续的手势
			let delta = cw - lastAngle;
			if (delta > Math.PI) delta -= Math.PI * 2;
			if (delta < -Math.PI) delta += Math.PI * 2;
			lastAngle = cw;
			// 指针逆时针走（delta < 0）＝ 把针往过去拨（swept 变大）
			swept = clamp(swept - delta, 0, Math.PI * 2);
			// 齿感：快到整点的时候被「搭」一下，于是停手总是停在格上。
			// 只在离格中心 13% 的窗口里往回拉，且只拉掉 68% ——
			// 想故意停在两格之间的人照样停得住，这不是吸附。
			const step = (Math.PI * 2) / TICK_COUNT;
			const near = Math.round(swept / step) * step;
			const off = swept - near;
			if (Math.abs(off) < step * 0.13) swept = near + off * 0.32;
			resetting = false;
		},
		endDrag() {
			turning = false;
			resetting = false;
		},
		reset() {
			resetting = true;
		},
		dropMark(tick, kind, slot = -1) {
			const norm = ((tick % TICK_COUNT) + TICK_COUNT) % TICK_COUNT;
			// 同一刻度上同一种点只留一颗，别叠出一坨黑
			const i = marks.findIndex((m) => m.tick === norm && m.kind === kind);
			if (i >= 0) {
				marks.splice(i, 1);
				return;
			}
			marks.push({ tick: norm, kind, slot, born: t });
		},
		marks: () => marks,
		rewind: () => c.rewind,
		sweep: () => swept,
	};
}
