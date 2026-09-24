// 「丝缕」的共用核心 —— A / B / C 三面 + 枢纽首页那层流动底纹，走的都是这一份。
//
// 三件事：
//   1. 噪声方向场（画出来的东西为什么长这样，全在它）
//   2. 笔：一条会自己蠕动的短链（原站 WeaveSilk 的核心，见 createPen / stepPen）
//   3. 把一束丝按对称份数画到画布上（几何只有一份，风格分三档挂上去）
//
// ⚠️ 混合模式用 "lighter"，但**画布本身必须是透明的、白底来自 CSS**：
//   在不透明白底上画 "lighter"，颜色会被一路加到白 —— 等于什么都画不出来。
//   原站就是这么做的（透明 canvas 累积 + 页面白底）。
// ⚠️ 不用 shadowBlur 做发光：几万条线段上开阴影会直接掉帧，原站也不这么做。
// ⚠️ 也**没有「线宽随笔速变化」这件事**：原站整条曲线的 lineWidth 是常数，
//   画面上那些粗细变化和丝理，全是几百上千遍重叠自己堆出来的。别再加回去。

export type SymmetryMode = "none" | "mirror" | "spiral";

/** 渲染风格：丝缕 / 像素 / 赛博。对称、笔、历史逻辑三者完全共用 */
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

/**
 * 向心螺旋收到最里面那份，半径还剩多少。
 *
 * ⚠️ 这个常数被两头各坑过一次，别凭手感调（两次都是「看着合理、实测很糟」）：
 *   - **每份固定 ×0.94**（六份只收到 0.73）：相邻两份半径差 6%，而线本身就有
 *     好几个像素宽 → 六份**叠成一条毛边**。屏幕上是一笔被描了六遍（重影 + 台阶 + 断口）。
 *   - **端点取 1/4、步长按等比反推**：最里那几份半径太小，又各自转了 60°，
 *     形状一不规则就在中心绞成一朵小结 → 画面变成「一个大圈 + 中间一坨」。
 *
 * 现在的取法两头都躲开，而且**逐份等距**而不是等比：
 *     k_i = 1 - (1 - INNER) * i / (count - 1)
 * 「螺旋」的读法本来就是等距的 —— 阿基米德螺线的圈距是常数；等比会让外圈很阔、
 * 里圈挤成一团（那就是「一坨」的来源）。0.45 是「一眼看得出在收、又不会缩成
 * 一小坨」的位置。
 *
 * 等距还顺手解决了份数问题：写死比例的话 12 份会收到 0.86^11 ≈ 8%，中心糊成疙瘩；
 * 现在不管几份都收到 45% 为止，步长自己算出来 —— 换份数不用回来改常数。
 */
const SPIRAL_INNER = 0.45;

/**
 * 单根丝一遍的透明度。
 *
 * ⚠️ 这个数**只在「一遍有多淡 × 一共有多少遍」这个乘积里有意义**，单独看它没有意义。
 * 原站是 0.09，本站照搬 —— 但它成立的**前提是每帧要画 5 个子步 × 一束约 30 根丝**，
 * 也就是同一片地方一秒能被叠上几百遍。早先本站是「一次 pointermove 画一段」，
 * 那个密度下 0.09 淡得看不见，所以当时写的是 0.2。
 * → 改笔的密度就必须回来重新看这个数，别只改一处。
 */
export const STROKE_ALPHA = 0.09;

/** 丝缕的饱和度/亮度：高饱和高明度才有霓虹感 */
const SAT = 88;
const LIGHT = 62;

/**
 * 三档风格各自的**基准线宽**（CSS px）。
 *
 * 丝缕 1.5：原站是 1 个设备像素，但它跑在 dpr=1 的画布上；本站画布按 dpr 缩放，
 *            取 1.5 CSS px 在 2x 屏上才是「一根细丝」而不是一条粗线。
 * 像素 9  ：这一档不当线宽用，当**方块边长**用（见 paintStroke 里的 pixel 分支）。
 * 赛博 1.7：比丝缕略粗，配上那层虚线才有「扫描线」的分量。
 */
const STYLE_WIDTH: Record<PaintKind, number> = {
	silk: 1.5,
	pixel: 9,
	cyber: 1.7,
};

/** 橡皮的线宽倍数：比画粗一档，擦起来才不用来回蹭 */
export const ERASE_WIDTH = 2.6;

/**
 * 橡皮一遍擦掉的比例。
 *
 * ⚠️ 这个数换过一轮含义，别照抄旧值：早先是「一次 pointermove 擦一段、一遍 0.85」，
 * 现在一笔是「5 子步 × 30 根丝」压在同一个地方 —— 一遍 = 几百次 destination-out，
 * 还写 0.85 就是**擦过即净**，而且边缘会硬。
 * 0.16 是在「按住不放」那种最密的叠法下，一遍大约抹掉八成、回来第二趟才彻底干净。
 */
export const ERASE_ALPHA = 0.16;

export function hsla(h: number, s: number, l: number, a: number): string {
	return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function norm360(h: number): number {
	return ((h % 360) + 360) % 360;
}

// ============================================================ 噪声方向场
//
// 逐字移植原站自己那份 processing 风格的 Perlin（它的 js/noise.js）。
// 丝缕之所以「通灵」，全靠这股力的方向场：**方向由位置决定、随时间缓慢漂移**，
// 于是同一处永远往同一个方向卷 —— 画出来是一股股顺着走的丝，而不是一团随机抖动。
// 换一套噪声等于换一幅画，所以照搬，不另写。
//
// 种子用的是 Marsaglia 的默认常数（0 落到 362436069/521288629），也就是说
// **每次刷新得到的是同一幅画**，原站也是这样，不是随机种。

const PERM = (() => {
	let z = 362436069;
	let w = 521288629;
	const nextInt = () => {
		z = (36969 * (z & 65535) + (z >>> 16)) & 0xffffffff;
		w = (18000 * (w & 65535) + (w >>> 16)) & 0xffffffff;
		return (((z & 0xffff) << 16) | (w & 0xffff)) & 0xffffffff;
	};
	const perm = new Uint8Array(512);
	for (let i = 0; i < 256; i++) perm[i] = i;
	for (let i = 0; i < 256; i++) {
		const j = nextInt() & 0xff;
		const t = perm[j];
		perm[j] = perm[i];
		perm[i] = t;
	}
	for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
	return perm;
})();

function grad3(i: number, x: number, y: number, z: number): number {
	switch (i & 15) {
		case 0x0:
			return x + y;
		case 0x1:
			return -x + y;
		case 0x2:
			return x - y;
		case 0x3:
			return -x - y;
		case 0x4:
			return x + z;
		case 0x5:
			return -x + z;
		case 0x6:
			return x - z;
		case 0x7:
			return -x - z;
		case 0x8:
			return y + z;
		case 0x9:
			return -y + z;
		case 0xa:
			return y - z;
		case 0xb:
			return -y - z;
		case 0xc:
			return y + x;
		case 0xd:
			return -y + z;
		case 0xe:
			return y - x;
		default:
			return -y - z;
	}
}

/** 单层 Perlin 3D（与原站同一张置换表、同一个 smoothstep 插值） */
function noise3(ix: number, iy: number, iz: number): number {
	// 格点坐标 + 格内小数部分，后面只用小数部分（原站是就地改写入参，这里落成局部量）
	const X = (ix | 0) & 255;
	const Y = (iy | 0) & 255;
	const Z = (iz | 0) & 255;
	const x = ix - (ix | 0);
	const y = iy - (iy | 0);
	const z = iz - (iz | 0);
	const fx = (3 - 2 * x) * x * x;
	const fy = (3 - 2 * y) * y * y;
	const fz = (3 - 2 * z) * z * z;
	const p0 = PERM[X] + Y;
	const p00 = PERM[p0] + Z;
	const p01 = PERM[p0 + 1] + Z;
	const p1 = PERM[X + 1] + Y;
	const p10 = PERM[p1] + Z;
	const p11 = PERM[p1 + 1] + Z;
	const l = (t: number, a: number, b: number) => a + t * (b - a);
	return l(
		fz,
		l(
			fy,
			l(fx, grad3(PERM[p00], x, y, z), grad3(PERM[p10], x - 1, y, z)),
			l(fx, grad3(PERM[p01], x, y - 1, z), grad3(PERM[p11], x - 1, y - 1, z)),
		),
		l(
			fy,
			l(
				fx,
				grad3(PERM[p00 + 1], x, y, z - 1),
				grad3(PERM[p10 + 1], x - 1, y, z - 1),
			),
			l(
				fx,
				grad3(PERM[p01 + 1], x, y - 1, z - 1),
				grad3(PERM[p11 + 1], x - 1, y - 1, z - 1),
			),
		),
	);
}

const NOISE_OCTAVES = 8;
const NOISE_FALLOUT = 0.65;

/**
 * 八度叠加。值域 [0, Σ0.65^i ≈ 1.8] —— 注意**不是** [0,1]。
 * 方向角 = NOISE_ANGLE_SCALE × 它，所以乘完之后角度能绕好几圈 ——
 * 这正是原站要的：方向场在小尺度上就拐弯，丝才会打卷。
 */
function fbm(x: number, y: number, z: number): number {
	let effect = 1;
	let k = 1;
	let sum = 0;
	for (let i = 0; i < NOISE_OCTAVES; i++) {
		effect *= NOISE_FALLOUT;
		sum += (effect * (1 + noise3(k * x, k * y, k * z))) / 2;
		k *= 2;
	}
	return sum;
}

// ============================================================ 笔（一条会自己蠕动的短链）
//
// 原站的笔**不是一条折线**，而是一条短链 —— 一束丝。指针只负责往链尾塞新粒子，
// 链本身由噪声力推着走、被刚性和摩擦拉着。这一个设计同时解释了三件看家本事：
//   - **按住不动它仍然在画**：噪声力一直在推，链一直在蠕动 → 墨一直出。
//     「长按自动抖动作画」不是加了个定时器，是这套力学的必然结果。
//   - **拖得快会出现优雅的长弧**：链被落在指针后面，像一根被风吹着的绳子。
//   - **抬笔之后还会自己收一会儿尾**：每颗粒子有固定寿命，走完才掉队。
//
// 所以「笔」和「一笔的轨迹」是两回事：轨迹是**每颗粒子一生的路径**（threads）。
// 一束丝约 30 根，画面上那些细密的丝理就是它们叠出来的 —— 不是叠了一层滤镜。

const START_LIFE = 150;
/**
 * 每帧积几个子步。
 *
 * ⚠️ 别按手感调这个数 —— 它决定笔每秒跑多远（每子步被方向场推约 1px），
 * 也决定链有多长（寿命 150 个子步 ÷ 步频 = 存活帧数 = 链上的粒子数，
 * 因为一帧只生一颗）。150/5 = **30 帧寿命、30 颗粒子在链上**。
 *
 * 原站有两处不同的取值：起步状态是 5，而首屏那段自己会画的 intro 特意写了 2。
 * 用户真正落笔的那条路径走的是 `Silk.initialState`（= 5），所以取 5。
 * （用 2 的话链会有 75 颗、寿命 1.2 秒，丝会拖得长很多 —— 那是 introsilk 的样子。）
 */
const STEPS_PER_FRAME = 5;
const NOISE_SPACE_SCALE = 0.02;
const NOISE_TIME_SCALE = 0.005;
/** 噪声值 → 方向角。乘 5π 是原站的取法 */
const NOISE_ANGLE_SCALE = 5 * Math.PI;
/** 原站给 x/y 加的一个大常数，只为了把坐标推离 0 附近（噪声表在 0 附近是规则的） */
const NOISE_ANCHOR = 1000000;
/** 指针每帧的位移当成一次冲量喂给新粒子，然后按 0.98 衰减 */
const VELOCITY_IMPULSE = 0.3;
const VELOCITY_DECAY = 0.98;
/** 相邻粒子互相往中间拽的力度。配合 restingDistance = 0，链被拉成一束紧绷的丝 */
const RIGIDITY = 0.2;

// ⚠️ 这里**没有惯性项**，是照原样来的，不是漏了。
//
// 原站写的是位置式积分 `p.x += (p.x - p.px) * friction + accx`，紧跟着一句
// `p.px = p.x` —— 而那时 `p.x` 已经换成新值了，于是下一子步 `(p.x - p.px)` 恒为 0：
// **那个 friction 项在新版里从头到尾是死的**（friction: 0.975 是个残留参数）。
// 所以粒子的运动是「每个子步被方向场推大约 1 像素」，没有速度积累。
//
// 这一点必须照做，不能"顺手修好"：给上真正的惯性之后，力方向在小范围内基本恒定，
// 位移会一路自乘到 40px/子步，按住一秒就把整块画布轰满 —— 实测过，一眼就不对。
// 手上这个"gentle"的手感，恰恰是那个死项换来的。
const STRIDE = 5;
const IX = 0;
const IY = 1;
const IVX = 2;
const IVY = 3;
const ILIFE = 4;

export type Pen = {
	/** 扁平 [x,y,ivx,ivy,life] × 链长（见 STRIDE / IX…ILIFE）；[0] 最老、末尾最新 */
	chain: number[];
	/**
	 * **每一子步一张**：穿过整条链的那条曲线（扁平 [x0,y0,x1,y1,…]）。
	 *
	 * 🔴 这才是「一笔」的几何本体，别改成「每颗粒子自己的轨迹」。原站的
	 * `draw()` 每个子步做的就是 `moveTo(curve[0]); quadraticCurveTo(…, curve[i])` ——
	 * 画的是**同一时刻、粒子之间**连成的那条线，画完就丢，从不留轨迹。
	 * 两者在「拖着走」时看着差不多（都贴着指针的路），但**按住不动时完全不同**：
	 * 刚性会把整条链绞成一束（实测 30 颗全挤在 1~2px 内），此时
	 *   · 画链   → 仍是一条几十像素长的绳，照常出墨（原站的做法）
	 *   · 画轨迹 → 每颗粒子自己只在一个小结里打转，画面**冻住**（实测 198px 不变一秒）
	 */
	snaps: number[][];
	/** 噪声的时间轴。它一直在走，所以画布上的丝永远在缓慢呼吸 */
	time: number;
	/** 笔尖目标（指针当前位置）与上一次的指针位置（用来算冲量） */
	tx: number;
	ty: number;
	ptx: number;
	pty: number;
	/** 指针还按着吗 —— 决定这一帧还要不要往链尾塞新粒子 */
	held: boolean;
};

/**
 * 落笔：一条全新的链，**第一颗粒子就生在这儿**。
 *
 * ⚠️ 播下这颗种子是必须的，不是省事：粒子本来是在帧里生的（一帧一颗），
 * 所以「按下和抬起落在同一帧里」的那种极快的点击会一颗都生不出来 ——
 * 手上明明是点了一下，画面上一片空白。种一颗下去，点一下也有个小小的星子。
 */
export function createPen(x: number, y: number): Pen {
	return {
		chain: [x, y, 0, 0, START_LIFE],
		snaps: [],
		time: 0,
		tx: x,
		ty: y,
		ptx: x,
		pty: y,
		held: true,
	};
}

/** 指针还在按着但没动 —— 也要喂进来，链才知道「笔尖现在在哪」 */
export function aimPen(pen: Pen, x: number, y: number): void {
	pen.tx = x;
	pen.ty = y;
}

/**
 * 一帧：先按指针位置生一颗新粒子，再跑 STEPS_PER_FRAME 个子步。
 *
 * ⚠️ 生粒子**一帧只生一颗**（原站一次 inputFrame 一颗）。写成「每个子步一颗」
 * 会让链长直接翻五倍，画出来的东西完全不是一回事。
 */
export function framePen(
	pen: Pen,
	cx: number,
	cy: number,
	/** 每个子步之后叫一次 —— 调用方在这儿把新长出来的那一小段补到画布上 */
	onStep?: (pen: Pen) => void,
): void {
	if (pen.held) {
		pen.chain.push(
			pen.tx, // x
			pen.ty, // y
			pen.tx - pen.ptx, // ivx：这一帧指针自己走了多远
			pen.ty - pen.pty, // ivy
			START_LIFE,
		);
	}
	pen.ptx = pen.tx;
	pen.pty = pen.ty;
	for (let s = 0; s < STEPS_PER_FRAME; s++) {
		stepPen(pen, cx, cy);
		if (onStep) onStep(pen);
	}
}

/** 最新那颗粒子还剩多少寿命（1 = 刚生下来）。整束丝的透明度按它淡出 */
export function penFade(pen: Pen): number {
	const c = pen.chain;
	if (!c.length) return 0;
	return c[c.length - STRIDE + ILIFE] / START_LIFE;
}

/** 链上还剩几颗粒子。为 0 就是这一笔彻底收完了 */
export function penAlive(pen: Pen): number {
	return pen.chain.length / STRIDE;
}

function stepPen(pen: Pen, cx: number, cy: number): void {
	const c = pen.chain;
	pen.time++;

	// 寿命走完的粒子从**链头**退役，链头往后缩一格。
	// ⚠️ 必须真的移走。留着的话链会一头锚死在落笔处，被拉成一根两头固定的长绳 ——
	//    那就不再是「笔」了，是慢慢拉长的一根线。
	while (c.length && c[ILIFE] <= 0) {
		c.splice(0, STRIDE);
	}

	for (let i = 0; i < c.length; i += STRIDE) {
		let accx = 0;
		let accy = 0;
		const x = c[i + IX];
		const y = c[i + IY];

		// 噪声方向场。角度里多加的那一项，作用是把整片区域的力**统一偏转**，
		// 链因此绕着某个点卷，而不是四处乱撞。
		//
		// 🔴 这里**必须照原站写 `atan2(cx - y, cy - x)`**（x/y 是颠倒的），
		//    不要「按名字改成极角」。曾经按 `rotateAnglesAroundSymmetryAxis`
		//    这个名字「修正」成 `atan2(cy - y, cx - x)`，代价很大：
		//      · 极角的梯度是 1/r → **对称中心正是一个奇点**。半径几像素内方向场
		//        逐像素乱跳、相关长度归零 → 粒子近乎纯随机游走，整根绳钉死不动。
		//        实测：指针按在正中，600→1200ms **墨量冻在 190px 一动不动**，
		//        1200ms 之后才突然开闸；同一支笔挪到 (0.36,0.44) 立刻变成从 200ms
		//        起就平滑增长、2 秒 7046px。而画布正中正是引导文字所在地，
		//        用户第一笔最可能就落在那里。
		//      · 颠倒写法等价于「朝点 (cy, cx) 收敛」的恢复力。对横幅画布
		//        (cy, cx) = (h/2, w/2) 落在**屏幕外**（本机 1228×566 → (283,614)），
		//        于是画面里没有奇点，方向场处处光滑。
		//    改回照抄之后：正中心长按 200ms 就有 397px、2 秒 5399px（原 1657px），
		//    全程单调、无冻结；构图仍居中对称，没有朝那个屏幕外的点跑偏。
		const nv = fbm(
			x * NOISE_SPACE_SCALE + NOISE_ANCHOR,
			y * NOISE_SPACE_SCALE + NOISE_ANCHOR,
			pen.time * NOISE_TIME_SCALE,
		);
		const ang = NOISE_ANGLE_SCALE * nv + Math.atan2(cx - y, cy - x);
		accx += Math.cos(ang);
		accy += Math.sin(ang);

		// 指针位移的冲量，按 0.98 衰减
		accx += VELOCITY_IMPULSE * c[i + IVX];
		accy += VELOCITY_IMPULSE * c[i + IVY];
		if (c[i + IVX] || c[i + IVY]) {
			c[i + IVX] *= VELOCITY_DECAY;
			c[i + IVY] *= VELOCITY_DECAY;
		}

		// 一步就这么远：方向场推的 1 像素 + 指针冲量。没有速度积累（理由见上面 STRIDE 那段）
		c[i + IX] = x + accx;
		c[i + IY] = y + accy;
		c[i + ILIFE]--;

		// 刚性：把和上一个粒子之间过长的距离往两边各收 20%。
		// 原站 restingDistance = 0，于是式子退化成 fx = -RIGIDITY * (prev - cur)。
		if (i) {
			const j = i - STRIDE;
			const xoff = c[j + IX] - c[i + IX];
			const yoff = c[j + IY] - c[i + IY];
			if (xoff * xoff + yoff * yoff > 1e-4) {
				const fx = -RIGIDITY * xoff;
				const fy = -RIGIDITY * yoff;
				c[i + IX] -= fx;
				c[i + IY] -= fy;
				c[j + IX] += fx;
				c[j + IY] += fy;
			}
		}
	}

	// 记下**这一子步收工之后**那条链的形状 —— 位置含刚性的修正，
	// 和原站「步进完统一 draw()」读到的值一致。原站每子步画一次、画完就丢；
	// 我们多存一份是为了「撤销 / 橡皮 / 换风格」能全量重放。
	const snap = new Array((c.length / STRIDE) * 2);
	for (let i = 0, k = 0; i < c.length; i += STRIDE, k += 2) {
		snap[k] = c[i + IX];
		snap[k + 1] = c[i + IY];
	}
	pen.snaps.push(snap);
}

// ============================================================ 对称

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
 * - spiral ：每份均分旋转，半径逐份**等距**往中心收，线条向内收敛成螺旋。
 *            第 0 份在原半径、第 count-1 份落在 SPIRAL_INNER 处，步长自己算。
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
	// 只有一份时 steps 会是 0 —— 那会让 i/steps 变成 NaN，整条线一个点都画不出来
	const steps = Math.max(1, count - 1);
	return {
		a: (i * Math.PI * 2) / count,
		k: 1 - (1 - SPIRAL_INNER) * (i / steps),
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

// ============================================================ 一笔 = 一叠链快照

/**
 * 一笔。
 *
 * `snaps` 里第 s 项是**第 s 个子步那条穿过整条链的曲线**（扁平 [x0,y0,x1,y1,…]）。
 * 一笔两秒 ≈ 600 张 × 约 30 点。画出来那些细密的丝理，就是相邻两张只差约 1px
 * 叠出来的 —— 不是叠了一层滤镜。
 *
 * ⚠️ 别改成「每颗粒子一生的轨迹」那套（原站也没有）。两者在拖着走时看着差不多，
 * 但按住不动时：刚性把链绞成一束，链的形状照旧（画链仍出墨），而单颗粒子只在
 * 一个几像素的小结里打转（画轨迹直接冻住）。见 `Pen.snaps` 那段。
 */
export type Stroke = {
	snaps: number[][];
	hue: number;
	alpha: number;
	mode: SymmetryMode;
	count: number;
	/** 逐份拷贝的色相步进 —— 各份颜色层层推进，同一个图形才有彩虹般的层次 */
	hueStep: number;
	/** 覆盖基准线宽（枢纽那层底纹用 30 这种粗线，浮起来当帷幕） */
	width?: number;
	/**
	 * 橡皮：这一笔是**擦**不是画。
	 *
	 * 擦除做成「一种笔画」而不是「一条单独的擦除图层」的理由：历史栈里
	 * 画与擦按发生顺序混在一起，全量重绘（撤销走的就是它）逐条回放，
	 * 于是「擦掉的区域」天然正确、撤销一步也天然正确 —— 不用为擦除
	 * 另写一套状态，也就没有「撤销之后擦痕复活」这类 bug。
	 * 笔、噪声力、对称份数全部照用，擦痕与画痕因此必然同形。
	 */
	erase?: boolean;
};

export type PaintOpts = {
	/**
	 * 只画第几张快照（作画中的增量渲染 —— 每子步只有最新那张是新定形的）；
	 * 不传就整笔重画（撤销 / 换风格）。**两者走的是同一段代码、同一批曲线**，
	 * 所以撤销之后画面不会走样。
	 */
	only?: number;
	kind?: PaintKind;
	/** C 面的故障偏移力度 0~1，其余风格忽略 */
	glitch?: number;
	/** 这一遍的透明度倍数（新增的丝随寿命淡出，靠它传 0~1） */
	fade?: number;
};

const _p0: number[] = [0, 0];
const _p1: number[] = [0, 0];

/**
 * 把一笔画到 ctx 上。
 *
 * ⚠️ 它**每帧要被调 5 次**，所以刻意不做贝塞尔平滑：原站用
 *    `quadraticCurveTo(…, 中点)` 平滑，但它是 30 个点一段 5px，直线段与二次曲线
 *    看不出差别，而平滑要多花一倍路径指令。（早先本站的采样来自 pointermove、
 *    动辄隔几十像素，那时才非平滑不可。）
 *
 * 一份拷贝一条路径：所有快照的所有曲线塞进同一个 path，最后一次 stroke()。
 * 逐条 stroke() 的话一笔就是几万次调用，白白掉帧。
 */
export function paintStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	cx: number,
	cy: number,
	opts: PaintOpts = {},
): void {
	// 擦除一律按丝缕那档来画：像素风的硬方块、赛博的虚线/故障抖动留在画布上
	// 都会变成一粒一粒擦不干净的花斑。擦痕要连续、要能一次到位。
	const kind: PaintKind = stroke.erase ? "silk" : (opts.kind ?? "silk");
	const glitch = opts.glitch ?? 0;
	const alpha = stroke.alpha * (opts.fade ?? 1);
	if (alpha <= 0.002) return;

	const base =
		(stroke.width ?? STYLE_WIDTH[kind]) * (stroke.erase ? ERASE_WIDTH : 1);

	ctx.save();
	// 相加混合：单根很淡，重叠处自己堆出辉光。
	// 橡皮反过来走 destination-out：按源的 alpha 把画布上已有的 alpha 减掉。
	// 对称、丝理、逐份拷贝全部复用同一条路径 —— 擦出来的形状必然和画出来的
	// 形状是同一套，不会出现「这边擦掉了、镜像那份还在」。
	ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "lighter";
	ctx.lineCap = kind === "pixel" ? "butt" : "round";
	ctx.lineJoin = "round";
	// 赛博风带扫描线纹理：把线画成细密的虚线，本身就是一层「扫描条纹」
	if (kind === "cyber") ctx.setLineDash([2, 3 + glitch * 6]);

	const total = copyCount(stroke.mode, stroke.count);
	// 要画的曲线：作画中只画刚定形的那一张，全量重绘画全部。
	// ⚠️ 用 `!= null` 而不是真值判断 —— `only: 0`（第一张）是合法值。
	const snaps =
		opts.only != null
			? [stroke.snaps[opts.only]].filter(Boolean)
			: stroke.snaps;

	for (let c = 0; c < total; c++) {
		const t = copyTransform(stroke.mode, stroke.count, c);
		// 各份拷贝的色相依次推进，图形才有层次。
		// 擦除不看颜色（destination-out 只用 alpha），所有拷贝都用同一个值。
		ctx.strokeStyle = stroke.erase
			? `rgba(0, 0, 0, ${alpha})`
			: hsla(norm360(stroke.hue + c * stroke.hueStep), SAT, LIGHT, alpha);
		ctx.fillStyle = ctx.strokeStyle;
		// 螺旋里收得越小的那份，线也越细 —— 不然中心那几份会糊成一块
		const width = base * t.k;

		if (kind === "pixel") {
			// 像素风：沿每段按方块边长撒硬方块，并吸附到网格上，才有 8bit 颗粒感。
			// 网格吸附在**局部坐标**里做，各份拷贝因此共用同一套网格，只是被旋转开。
			const g = Math.max(2, Math.round(width));
			for (const th of snaps) {
				const n = th.length / 2;
				if (n < 2) continue;
				for (let i = 1; i < n; i++) {
					const ax = th[(i - 1) * 2] - cx;
					const ay = th[(i - 1) * 2 + 1] - cy;
					const bx = th[i * 2] - cx;
					const by = th[i * 2 + 1] - cy;
					// 用两点距离估步数就够了（每段只有几像素），上限兜住极端的手速
					const steps = Math.max(
						1,
						Math.min(24, Math.round(Math.hypot(bx - ax, by - ay) / g)),
					);
					for (let k = 1; k <= steps; k++) {
						const tt = k / steps;
						applyCopy(
							Math.round((ax + (bx - ax) * tt) / g) * g,
							Math.round((ay + (by - ay) * tt) / g) * g,
							t,
							_p0,
						);
						// ⚠️ 落位后再对齐一次屏幕像素：镜像/螺旋会把方块转到小数坐标上，
						// 那样每条边都被抗锯齿抹一道，就不是「硬边方块」了。
						ctx.fillRect(
							Math.round(_p0[0] + cx - g / 2),
							Math.round(_p0[1] + cy - g / 2),
							g,
							g,
						);
					}
				}
			}
			continue;
		}

		ctx.lineWidth = width;
		ctx.beginPath();
		for (const th of snaps) {
			const n = th.length / 2;
			if (n < 2) continue;
			for (let i = 1; i < n; i++) {
				applyCopy(th[(i - 1) * 2] - cx, th[(i - 1) * 2 + 1] - cy, t, _p0);
				applyCopy(th[i * 2] - cx, th[i * 2 + 1] - cy, t, _p1);
				// 旋转+等比缩放是线性变换，所以「变换后再连」和「连完再变换」完全一致
				ctx.moveTo(_p0[0] + cx, _p0[1] + cy);
				ctx.lineTo(_p1[0] + cx, _p1[1] + cy);
			}
		}
		ctx.stroke();
	}
	ctx.restore();
}

/** 从调色盘的色块里取一个随机基色（高饱和高明度区间的色相） */
export function randomHue(): number {
	return Math.random() * 360;
}
