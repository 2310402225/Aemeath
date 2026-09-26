// 接线：状态机、事件、四层渲染、全局联动。
//
// 分工：各模块只管"把我这一层画出来"，一切共享量（时间偏移、三维姿态、胶卷展开度、
// 指针位置）都在这一个文件里推进，模块**只读不写**。上一版走马灯在这里吃过亏：
// 钟拨回去了，灯还按原来的速度转。所以这一页的规矩是"一份状态，五个读者"。
//
// 状态机（spec 点名的七态）：
//   idle · dragging_pointer · dragging_compass · dragging_text · rolling_film · ink_writing · frame_preview
// 同一时刻只允许一个主动操作：所有入口都先过 `claim()`，抢不到就什么都不做。
// 场景（surface / cosmos / ink）是**另一个维度** —— 拖针的时候场景可能还在过渡，
// 两者不能互相冒充，所以 `op` 里没有 entering_* 这种值。

import { type Compass, createCompass, type Geom } from "./compass";
import { type Cosmos, createCosmos } from "./cosmos";
import { FILM_FRAMES, FRAME_FILTERS, PHRASES, RING_STEPS, RINGS } from "./data";
import { createInkWorld, type InkWorld } from "./inkworld";
import { createReels, type Reels } from "./reels";
import { createRiver, type River } from "./river";
import {
	approach,
	clamp,
	createDual,
	type Dual,
	type Op,
	riverY,
	type Scene,
	sceneFocus,
	spring,
	type View,
	wrapPi,
} from "./state";

export type DualApp = { destroy(): void };

const TAU = Math.PI * 2;
const STEP = TAU / RING_STEPS;

function need<T extends Element>(sel: string): T {
	const el = document.querySelector<T>(sel);
	// ⚠️ 取不到就炸，不要静默跑默认 —— 上一版就是"按名字取不到、于是整轮姿态从没跑过"，
	// 而且它不报错，只是画面不对。
	if (!el) throw new Error(`dual: 缺少必需的节点 ${sel}`);
	return el;
}
function opt<T extends Element>(sel: string): T | null {
	return document.querySelector<T>(sel);
}

export function createDualApp(): DualApp {
	const stage = need<HTMLElement>("#dr-stage");
	const elCosmos = need<HTMLCanvasElement>("#dr-cosmos");
	const elRiver = need<HTMLCanvasElement>("#dr-river");
	const elInk = need<HTMLCanvasElement>("#dr-ink");
	const elCore = need<HTMLCanvasElement>("#dr-core");

	const d: Dual = createDual();
	const view: View = { w: 0, h: 0, dpr: 1, river: 0 };

	const c1 = elCosmos.getContext("2d");
	const c2 = elRiver.getContext("2d");
	const c3 = elInk.getContext("2d");
	const c4 = elCore.getContext("2d");
	// 「整站静默失效」唯一能提前抓住的哨兵：上下文没了，下面每一句都是空转。
	if (!c1 || !c2 || !c3 || !c4) throw new Error("dual: 拿不到 2D 上下文");
	// ⚠️ ts(18047)：守卫的收窄进不了被提升的 function 声明 → 另绑四条非空常量。
	const gCosmos: CanvasRenderingContext2D = c1;
	const gRiver: CanvasRenderingContext2D = c2;
	const gInk: CanvasRenderingContext2D = c3;
	const gCore: CanvasRenderingContext2D = c4;

	const cosmos: Cosmos = createCosmos();
	const river: River = createRiver();
	const ink: InkWorld = createInkWorld();
	const compass: Compass = createCompass();
	const reels: Reels = createReels();

	let alive = true;
	let raf = 0;
	let last = 0;
	let drawAcc = 0;
	let pointerHot = 0;
	/** 松手后到这一刻之前，针不回位（点了记忆点要停一会儿给你看） */
	let turnsHold = 0;
	let pendingChar: string | null = null;
	let reelTarget = 0;
	let lastSurfaceAt = -1e9;
	// 🔴 弹簧必须**逐帧带速度**回去。`spring(cur, v, …)` 是半隐式欧拉：
	// 传 v=0 会退化成 `x' = x - k(x-target)·dt²`（一阶滞后），时间常数被 dt² 拖慢两个量级 ——
	// k=15、dt=1/61 时每帧只走 0.4%，要 ~18 秒才收敛。表现不是"动画慢"，
	// 而是**整页锁死**：`rolling_film` 要等它收敛才让出 op，于是点一次「展开胶卷」
	// 之后 17.7 秒内拨针/转盘/转环/点胶片全都没反应（实测 17.7s）。
	// 带上速度才是真正的 ζ（reelOpen 6.4/(2√15)=0.83、focus 9.4/(2√30)=0.86，正是注释里写的那个）。
	let focusV = 0;
	let reelOpenV = 0;

	let lastTilt = { x: 0, y: 0 };
	let lastRingAngle = 0;
	let lastNeedleAngle = 0;
	let downAt = 0;
	let downPos = { x: 0, y: 0 };
	let movedFar = false;
	let inkPressed = false;
	let holdFired = false;
	/** 按下只记「抓到了什么」，位移过阈值才真正认领拖拽（spec：修复点击误触）。
	 *  没有这一步，「在针上点一下」也会短暂占住 op，把同一时刻别的操作全挡掉。 */
	let pending: { kind: "needle" | "ring" | "disc"; index: number } | null =
		null;
	/** 水墨模式：点画布是「写字」还是「晕开一幅画」。角落开关 / M 键切换。 */
	let inkMode: "char" | "painting" = "char";

	// ────────────────────────────────────────────── 尺寸

	function relayout() {
		const rect = stage.getBoundingClientRect();
		view.w = Math.max(1, rect.width);
		view.h = Math.max(1, rect.height);
		// 窄屏与粗指针的设备压到 1.25：四张全屏画布按 3 倍铺会直接把内存吃光
		view.dpr = d.lite ? 1.25 : Math.min(2, window.devicePixelRatio || 1);
		view.river = riverY(d, view.h);
		for (const [el, g] of [
			[elCosmos, gCosmos],
			[elRiver, gRiver],
			[elInk, gInk],
			[elCore, gCore],
		] as const) {
			el.width = Math.round(view.w * view.dpr);
			el.height = Math.round(view.h * view.dpr);
			el.style.width = `${view.w}px`;
			el.style.height = `${view.h}px`;
			g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		}
		cosmos.resize(view);
		river.resize(view);
		ink.resize(view);
		compass.resize(view);
		reels.resize(view);
		placeSlips(true);
	}

	/** 每层开画前清干净。`setTransform` 必须重设：上一帧可能改过它。 */
	function clear(g: CanvasRenderingContext2D) {
		g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		g.clearRect(0, 0, view.w, view.h);
	}

	// ────────────────────────────────────────────── 状态机

	function claim(next: Op): boolean {
		if (d.op !== "idle") return false;
		d.op = next;
		return true;
	}

	function setScene(s: Scene) {
		if (d.scene === s) return;
		d.scene = s;
		// 进寰宇：星空散开的同时胶卷旋开、汉字从中心一点飞出组装成罗盘（一次点击全发生）。
		// 离开寰宇：胶卷收拢、汉字收回中心光点，下次进来重新组装。
		reelTarget = s === "cosmos" ? 1 : 0;
		reels.solo(-1);
		syncButtons();
	}

	// ────────────────────────────────────────────── 物理（所有共享量只在这里推进）

	function step(dt: number) {
		const now = d.now;
		pointerHot = Math.max(0, pointerHot - dt);

		// 场景过渡：用弹簧而不是线性插值，才有"铺开"的重量感（ζ≈0.87，不荡）
		const [nf, nfv] = spring(d.focus, focusV, sceneFocus(d.scene), 30, 9.4, dt);
		d.focus = nf;
		focusV = nfv;
		view.river = riverY(d, view.h);

		// 罗盘偏移：松手之后缓动归位。低阻尼但不回弹过头（ζ≈0.87）
		if (d.op !== "dragging_pointer" && now > turnsHold) {
			const [nt, nv] = spring(d.turns, d.turnsV, 0, 17, 7.2, dt);
			d.turns = nt;
			d.turnsV = nv;
			if (Math.abs(d.turns) < 0.002 && Math.abs(d.turnsV) < 0.01) {
				d.turns = 0;
				d.turnsV = 0;
			}
		}
		// 「旧」的唯一来源：|圈数| 的平滑值。别的模块都读它，不各算一份。
		d.age = approach(d.age, clamp(Math.abs(d.turns), 0, 1), 5, dt);

		// 盘面姿态：松手后来回摆几下才停（ζ≈0.26，能看见四五次摆动）
		if (d.op !== "dragging_compass") {
			const [tx, vx] = spring(d.tiltX, d.tiltVX, 0, 26, 2.6, dt);
			const [ty, vy] = spring(d.tiltY, d.tiltVY, 0, 26, 2.6, dt);
			const [sp, sv] = spring(d.qspin, d.qspinV, 0, 12, 2.2, dt);
			d.tiltX = tx;
			d.tiltVX = vx;
			d.tiltY = ty;
			d.tiltVY = vy;
			d.qspin = sp;
			d.qspinV = sv;
		}

		// 汉字环：松手后收敛到"当前这一格正对盘顶"。格位从 data.ts 的 `current()` 读，
		// 不在这里另抄一份日历算法 —— 抄了就会有一天两边对不上。
		if (d.op !== "dragging_text") {
			const t = new Date(now);
			for (let i = 0; i < d.rings.length; i++) {
				const real = -RINGS[i].current(t) * STEP;
				const m = Math.round((d.rings[i] - real) / TAU);
				const target = real + m * TAU;
				const [r, v] = spring(d.rings[i], d.ringV[i], target, 30, 6.2, dt);
				d.rings[i] = r;
				d.ringV[i] = v;
			}
		}

		// 胶卷展开度
		const [ro, rov] = spring(d.reelOpen, reelOpenV, reelTarget, 15, 6.4, dt);
		d.reelOpen = ro;
		reelOpenV = rov;
		if (d.op === "rolling_film" && Math.abs(ro - reelTarget) < 0.012) {
			d.op = "idle";
			syncButtons();
			maybeSurface();
		}

		// 胶片：① 随时间慢慢自滚；② 拖针时全部快速滚（`filmRoll` 跟着指针速度涨、自己衰减）
		d.filmPhase += dt * (0.1 - 0.055 * d.age) * (d.calm ? 0.35 : 1);
		d.filmRoll = approach(d.filmRoll, 0, 2.6, dt);

		// 河的余波：`wave` 是给上下两个位面看的"刚被扰过"
		d.wave = Math.max(0, d.wave - dt * 1.3);

		// 长按落墨：按住不动满 0.5 秒就当场炸开（不等松手，手感才对）
		if (inkPressed && !holdFired && !movedFar && now - downAt > 500) {
			holdFired = true;
			ink.dot(d.px, d.py, 2.2);
			river.disturb(d.px, 0.9);
			d.wave = 1;
		}

		// 写完一个字 → 给罗盘外圈落一颗记忆点
		if (pendingChar && !ink.writing()) {
			compass.remember(d.turns, pendingChar);
			pendingChar = null;
			if (d.op === "ink_writing") {
				d.op = "idle";
				syncButtons();
			}
		}
	}

	// ────────────────────────────────────────────── 渲染

	function render(dt: number) {
		const busy =
			d.op !== "idle" ||
			pointerHot > 0 ||
			Math.abs(d.turnsV) > 0.012 ||
			Math.abs(d.tiltVX) > 0.012 ||
			Math.abs(d.tiltVY) > 0.012 ||
			ink.writing();
		// 静止时把重绘降到 24fps：四张全屏画布按 60fps 空转是纯耗电。
		// ⚠️ 物理（step）仍按 rAF 跑 —— 降的只是画，不是时间。
		drawAcc += dt;
		const budget = busy ? 1 / 61 : 1 / 24;
		if (drawAcc < budget) return;
		drawAcc = 0;

		clear(gCosmos);
		cosmos.draw(gCosmos, d, view, dt);

		clear(gRiver);
		river.draw(gRiver, d, view, dt);

		clear(gInk);
		ink.draw(gInk, d, view, dt);

		clear(gCore);
		const gm: Geom = compass.geom(d, view);
		if (gm.appear > 0.02) {
			// 胶卷的后半圈 → 罗盘 → 胶卷的前半圈。这一次序不能换：
			// 换了"胶片球包住罗盘"就散了架（上一版层序乱的病根）。
			reels.drawBack(gCore, d, view, gm);
			compass.draw(gCore, d, view, dt);
			reels.drawFront(gCore, d, view, gm);
		}
	}

	function frame(now: number) {
		if (!alive) return;
		raf = requestAnimationFrame(frame);
		const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
		last = now;
		// ⚠️ 必须写墙钟，不能写 rAF 的 `now`：rAF 时间戳是「从导航起算的毫秒数」，
		// 拿它去 `new Date(...)` 会落在 1970-01-01，本地显示成 08:00 且从 0 开始走 ——
		// 而这一页的全部意义就是「罗盘与现实一致」。dt 仍用 `now`（同一条时间轴才准）。
		d.now = Date.now();
		step(dt);
		render(dt);
		updateSlips(dt);
		syncReadout();
	}

	// ────────────────────────────────────────────── 指针

	function at(e: PointerEvent) {
		const r = stage.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function angleAt(px: number, py: number, gm: Geom) {
		return Math.atan2(py - gm.cy, px - gm.cx);
	}

	function onDown(e: PointerEvent) {
		const el = e.target as Element | null;
		// 先让开浮层自己（.dr-frame 里的滤镜按钮、字帖、页脚按钮都在这条里）
		if (el?.closest("button,a,input,label,select,.dr-slip,.dr-frame")) return;
		// 全屏帧开着时，**点画面任意处都能退**（spec 说的"再点退出"）。
		// ⚠️ 不能写成"开着就直接 return"：那会让之后每一次 pointerdown 全部石沉大海，
		// 整页看着像死了。上一版就是这样 —— 胶片滚过针的位置时按一下打开一张照片，
		// 从此拨针、转盘、转环一起失效。
		if (d.op === "frame_preview") {
			closeFrame();
			return;
		}
		const { x, y } = at(e);
		if (y < 0 || y > view.h || x < 0 || x > view.w) return;
		d.px = x;
		d.py = y;
		pointerHot = 1.2;
		downAt = d.now;
		downPos = { x, y };
		movedFar = false;
		hideIntro();

		// 起手一律先推一圈涟漪：不管接下来是什么操作，河先应一声
		river.disturb(x, 0.35);

		if (d.scene === "cosmos") {
			const gm = compass.geom(d, view);
			const h = compass.hit(d, view, x, y);
			// ⚠️ 命中次序 = **精度优先**，不是"谁画在上面谁先"：
			// 针与记忆点都是又窄又短的目标（针是 ±4.9° 的一条楔形，记忆点是 0.075R 的小点），
			// 而胶片格是 ~18px 的方块、还随胶片自滚不停换位置。真按"画在上面"来（胶片先判），
			// 胶片滚过针上的那几秒里按下针就变成"打开一张全屏照片" —— 而 frame_preview 会
			// 把**之后每一次** pointerdown 全部吃掉（`onDown` 头一行就 return），于是「拨针」
			// 整条交互一起失效。这一条是 trial-and-error 扫出来的：整圈 72 格里只有 2 格能抓到针。
			if (h?.kind === "needle") {
				pending = { kind: "needle", index: 0 };
				return;
			}
			if (h?.kind === "memory") {
				const mem = compass.memories[h.index];
				d.turns = mem.turns;
				d.turnsV = 0;
				turnsHold = d.now + 3000;
				river.disturb(x, 0.5);
				return;
			}
			const idx = reels.frameAt(x, y);
			if (idx >= 0) {
				openFrame(idx);
				return;
			}
			if (h?.kind === "ring") {
				pending = { kind: "ring", index: h.index };
				return;
			}
			if (h?.kind === "disc") {
				pending = { kind: "disc", index: 0 };
				return;
			}
			if (reels.onReel(x, y, gm) && claim("rolling_film")) {
				reelTarget = reelTarget > 0.5 ? 0 : 1;
				syncButtons();
				return;
			}
			return;
		}

		if (d.scene === "ink") {
			// 落墨只在水墨那一侧：河以上仍是"看"的区域
			if (y < view.river) return;
			inkPressed = true;
			holdFired = false;
			ink.beginDrag(x, y);
			return;
		}

		// surface：贴着河那条带只起涟漪、不切场景；上下两侧点一下才进
		if (Math.abs(y - view.river) < Math.max(26, view.h * 0.045)) {
			river.disturb(x, 0.9);
			d.wave = 1;
		}
	}

	function onMove(e: PointerEvent) {
		if (!alive) return;
		const { x, y } = at(e);
		const inStage = y >= 0 && y <= view.h && x >= 0 && x <= view.w;
		if (!inStage) {
			d.px = -1;
			d.py = -1;
			return;
		}
		d.px = x;
		d.py = y;
		pointerHot = 1.2;
		cosmos.avoid(x, y, Math.min(view.w, view.h) * 0.16);
		if (Math.abs(y - view.river) < view.h * 0.06 && d.op === "idle") {
			river.disturb(x, 0.2);
			d.wave = Math.max(d.wave, 0.4);
		}
		if (Math.hypot(x - downPos.x, y - downPos.y) > 6) movedFar = true;

		// 误触阈值：按下时只记了「抓到什么」，拖过阈值才真正认领。
		// 认领这一帧不算位移（针/环从下一帧开始跟手；转盘用按下点做基准，不丢第一帧）
		if (pending) {
			if (!movedFar) return;
			const gm2 = compass.geom(d, view);
			if (pending.kind === "needle" && claim("dragging_pointer")) {
				lastNeedleAngle = angleAt(x, y, gm2);
			} else if (pending.kind === "ring" && claim("dragging_text")) {
				d.ringIdx = pending.index;
				lastRingAngle = angleAt(x, y, gm2);
				// ④ 转汉字环时，随机让一条胶卷独立自转（一直转到环停稳）
				const n = reels.count();
				d.soloIdx = n > 0 ? Math.floor(Math.random() * n) : -1;
				reels.solo(d.soloIdx);
			} else if (pending.kind === "disc" && claim("dragging_compass")) {
				lastTilt = { x: downPos.x, y: downPos.y };
			}
			pending = null;
			return;
		}

		const gm = compass.geom(d, view);
		if (d.op === "dragging_pointer") {
			const a = angleAt(x, y, gm);
			const delta = wrapPi(a - lastNeedleAngle);
			lastNeedleAngle = a;
			// 🔴 按帧增量积分（跨 ±π 自己解绕）：用绝对 atan2 会在半圈处折回，
			// 于是"再往下拨突然弹回此刻"，圈数也永远到不了两圈以上。
			d.turns += delta / TAU;
			d.turnsV = clamp(delta / 0.016, -6, 6);
			// ② 拖针时全部胶卷快速旋转（与偏移联动）
			d.filmRoll += Math.abs(delta) * 0.9;
			return;
		}
		if (d.op === "dragging_text") {
			const a = angleAt(x, y, gm);
			const delta = wrapPi(a - lastRingAngle);
			lastRingAngle = a;
			const i = clamp(d.ringIdx, 0, d.rings.length - 1);
			d.rings[i] += delta;
			d.ringV[i] = clamp(delta / 0.016, -14, 14);
			return;
		}
		if (d.op === "dragging_compass") {
			// ③ 转罗盘时胶卷**跟着姿态走、自己不自转** —— 所以这里只动 tilt，
			// 碰都不碰 filmRoll。这条是四套逻辑里最容易写错的一套。
			const dx = x - lastTilt.x;
			const dy = y - lastTilt.y;
			lastTilt = { x, y };
			d.tiltY = clamp(d.tiltY + dx * 0.0042, -0.8, 0.8);
			d.tiltX = clamp(d.tiltX + dy * 0.0042, -0.8, 0.8);
			d.tiltVY = clamp(dx * 0.36, -6, 6);
			d.tiltVX = clamp(dy * 0.36, -6, 6);
			d.qspin = clamp(d.qspin + dx * 0.0011, -0.5, 0.5);
			return;
		}
		if (d.scene === "ink" && inkPressed && movedFar && y > view.river) {
			ink.trail(x, y);
		}
	}

	function onUp(e: PointerEvent) {
		if (!alive) return;
		const { x, y } = at(e);
		const click = !movedFar && d.now - downAt < 420;
		pending = null;

		if (
			d.op === "dragging_pointer" ||
			d.op === "dragging_text" ||
			d.op === "dragging_compass"
		) {
			const was = d.op;
			d.op = "idle";
			// 环停稳之后那条独立自转的胶卷也收工
			if (was === "dragging_text") reels.solo(-1);
			syncButtons();
			maybeSurface();
			return;
		}

		if (d.scene === "ink") {
			ink.endDrag();
			const wasPressed = inkPressed;
			inkPressed = false;
			if (wasPressed && y > view.river) {
				if (!movedFar && !holdFired) {
					// 点一下 = 按当前模式触发（spec：所有绘制触发都落在画布点击上，
					// 不再有底部按钮）。想纯粹玩墨：拖一下是墨线、长按是泼墨。
					if (inkMode === "char") {
						tryWriteAt(x, y);
					} else if (ink.surface(x, y)) {
						river.disturb(x, 0.7);
						d.wave = 1;
					}
				} else {
					river.disturb(x, movedFar ? 0.3 : 0.55);
					d.wave = Math.max(d.wave, movedFar ? 0.3 : 0.6);
				}
			}
			return;
		}

		if (d.scene === "surface" && click) {
			if (Math.abs(y - view.river) < Math.max(26, view.h * 0.045)) return;
			setScene(y < view.river ? "cosmos" : "ink");
			d.wave = 1;
			river.disturb(x, 1);
		}
	}

	/** 胶卷定格之后偶尔浮一幅画出来。概率不高 —— 这一页不要"处处有反馈"。 */
	function maybeSurface() {
		if (d.now - lastSurfaceAt < 20000) return;
		if (Math.random() > 0.34) return;
		lastSurfaceAt = d.now;
		ink.surface(
			view.w * (0.25 + Math.random() * 0.5),
			view.river + (view.h - view.river) * (0.3 + Math.random() * 0.4),
		);
	}

	/** 在 (x,y) 起笔写一个字（楷书模式下的画布点击）。 */
	function tryWriteAt(x: number, y: number) {
		if (!claim("ink_writing")) return;
		const ch = ink.write(x, y);
		if (!ch) {
			d.op = "idle";
			return;
		}
		pendingChar = ch;
		syncButtons();
	}

	// ────────────────────────────────────────────── 全屏帧

	const frameBox = opt<HTMLElement>("#dr-frame");
	const frameImg = opt<HTMLImageElement>("#dr-frame-img");
	const frameTitle = opt<HTMLElement>("#dr-frame-title");
	const filterBox = opt<HTMLElement>("#dr-filters");
	let filter = -1;

	function openFrame(idx: number) {
		if (!frameBox || !frameImg || d.op !== "idle") return;
		const f = FILM_FRAMES[idx];
		if (!f) return;
		d.op = "frame_preview";
		d.frame = idx;
		frameImg.src = f.src;
		frameImg.alt = `${f.title}（放大的胶卷帧）`;
		frameImg.style.filter = "none";
		if (frameTitle) frameTitle.textContent = f.title;
		frameBox.hidden = false;
		filter = -1;
		for (const b of filterBox?.querySelectorAll("button") ?? []) {
			b.setAttribute("aria-pressed", "false");
		}
	}

	function closeFrame() {
		if (d.op !== "frame_preview") return;
		if (frameImg) frameImg.style.filter = "none";
		if (frameBox) frameBox.hidden = true;
		d.op = "idle";
		d.frame = -1;
		syncButtons();
	}

	if (filterBox) {
		for (const [i, f] of FRAME_FILTERS.entries()) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = f.label;
			b.setAttribute("aria-pressed", "false");
			b.addEventListener("click", (ev) => {
				ev.stopPropagation();
				filter = filter === i ? -1 : i;
				if (frameImg) frameImg.style.filter = filter < 0 ? "none" : f.css;
				for (const x of filterBox.querySelectorAll("button")) {
					x.setAttribute(
						"aria-pressed",
						x === b ? String(filter === i) : "false",
					);
				}
			});
			filterBox.append(b);
		}
	}
	frameBox?.addEventListener("click", closeFrame);

	// ────────────────────────────────────────────── 字帖纸片

	type Slip = {
		el: HTMLButtonElement;
		x: number;
		y: number;
		hx: number;
		hy: number;
		ph: number;
		open: boolean;
	};
	const slipHost = opt<HTMLElement>("#dr-slips");
	const slips: Slip[] = [];
	if (slipHost) {
		for (const [i, phrase] of PHRASES.entries()) {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "dr-slip";
			b.textContent = phrase;
			b.setAttribute("aria-pressed", "false");
			b.setAttribute("aria-label", `字帖：${phrase}，点一下展开或折起`);
			b.style.opacity = "0";
			const s: Slip = {
				el: b,
				x: 0,
				y: 0,
				hx: 0,
				hy: 0,
				ph: i * 1.7,
				open: false,
			};
			b.addEventListener("click", (ev) => {
				ev.stopPropagation();
				s.open = !s.open;
				b.classList.toggle("is-open", s.open);
				b.setAttribute("aria-pressed", String(s.open));
			});
			slipHost.append(b);
			slips.push(s);
		}
	}

	function placeSlips(instant: boolean) {
		for (const [i, s] of slips.entries()) {
			const a = (i / slips.length) * TAU + 0.6;
			// 四张散在一个半径上，而不是全挤在指针正上方
			s.hx = Math.cos(a) * (d.lite ? 88 : 148);
			s.hy = Math.sin(a) * (d.lite ? 60 : 94);
			if (instant) {
				s.x = view.w * 0.5;
				s.y = view.h * 0.5;
			}
		}
	}

	function updateSlips(dt: number) {
		if (!slips.length) return;
		const t = d.now / 1000;
		const inkMode = d.scene === "ink";
		// 没进水墨时只留一点点存在感（要在水墨那半边才看得见），进了水墨整片轻扬
		const alpha = inkMode ? 1 : d.scene === "cosmos" ? 0 : 0.3;
		const ry = view.river + (view.h - view.river) * 0.45;
		const fl = d.calm ? 0 : 1;
		for (const s of slips) {
			const has = d.px >= 0 && (inkMode || d.py > view.river);
			const tx = has ? d.px + s.hx : view.w * 0.5 + s.hx;
			const ty = has ? d.py + s.hy * (inkMode ? 1 : 0.5) : ry + s.hy;
			s.x = approach(s.x, tx, 2.6, dt);
			s.y = approach(s.y, ty, 2.6, dt);
			const rot = Math.sin(t * 0.52 + s.ph) * 4 * fl;
			const bob = Math.sin(t * 0.38 + s.ph * 1.3) * 5 * fl;
			s.el.style.opacity = String(alpha);
			s.el.style.pointerEvents = inkMode ? "auto" : "none";
			s.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${(s.y + bob).toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
		}
	}

	// ────────────────────────────────────────────── 按钮与读数

	const btnOpen = opt<HTMLButtonElement>("#dr-open");
	const btnBack = opt<HTMLButtonElement>("#dr-back");
	const btnReset = opt<HTMLButtonElement>("#dr-reset");
	const btnHelp = opt<HTMLButtonElement>("#dr-help-toggle");
	const helpBox = opt<HTMLElement>("#dr-help");
	const modeBox = opt<HTMLElement>("#dr-mode");
	const modeChar = opt<HTMLButtonElement>("#dr-mode-char");
	const modePaint = opt<HTMLButtonElement>("#dr-mode-paint");
	const readScene = opt<HTMLElement>("#dr-readout-scene");
	const readTime = opt<HTMLElement>("#dr-readout-time");
	const intro = opt<HTMLElement>("#dr-intro");

	function hideIntro() {
		intro?.classList.add("is-gone");
	}

	function setInkMode(m: "char" | "painting") {
		inkMode = m;
		modeChar?.setAttribute("aria-pressed", String(m === "char"));
		modePaint?.setAttribute("aria-pressed", String(m === "painting"));
	}

	function syncButtons() {
		const s = d.scene;
		if (modeBox) modeBox.hidden = s !== "ink";
		if (btnOpen) {
			btnOpen.hidden = s !== "cosmos";
			btnOpen.textContent = reelTarget > 0.5 ? "收起胶卷" : "展开胶卷";
		}
		if (btnBack) btnBack.hidden = s === "surface";
		if (btnReset) btnReset.hidden = s !== "cosmos";
		// 落在宣纸那半边的按钮换成纸底深字：深色玻璃压在纸上像贴了两层膏药
		btnBack?.classList.toggle("dr-btn-on-paper", s === "ink");
	}

	modeChar?.addEventListener("click", () => setInkMode("char"));
	modePaint?.addEventListener("click", () => setInkMode("painting"));

	btnOpen?.addEventListener("click", () => {
		if (!claim("rolling_film")) return;
		reelTarget = reelTarget > 0.5 ? 0 : 1;
		syncButtons();
	});

	btnBack?.addEventListener("click", () => {
		if (d.op === "frame_preview") {
			closeFrame();
			return;
		}
		setScene("surface");
	});

	btnReset?.addEventListener("click", () => {
		d.turns = 0;
		d.turnsV = 0;
		turnsHold = 0;
		river.disturb(view.w / 2, 0.8);
	});

	btnHelp?.addEventListener("click", () => {
		if (!helpBox) return;
		const open = helpBox.hidden;
		helpBox.hidden = !open;
		btnHelp.setAttribute("aria-expanded", String(open));
	});

	let lastSceneText = "";
	let lastTimeText = "";
	function syncReadout() {
		// 只在文本真的变了才写 DOM：每帧写一次 textContent 是白扔的
		const sc =
			d.scene === "cosmos"
				? "寰宇星空"
				: d.scene === "ink"
					? "水墨丹青"
					: "双位面对望";
		if (readScene && sc !== lastSceneText) {
			readScene.textContent = sc;
			lastSceneText = sc;
		}
		if (!readTime) return;
		const t = new Date(d.now);
		const hh = String(t.getHours()).padStart(2, "0");
		const mm = String(t.getMinutes()).padStart(2, "0");
		const ss = String(t.getSeconds()).padStart(2, "0");
		const txt =
			Math.abs(d.turns) > 0.02
				? `${hh}:${mm}:${ss} · ${d.turns > 0 ? "往回" : "往前"} ${Math.abs(d.turns).toFixed(2)} 圈`
				: `${hh}:${mm}:${ss}`;
		if (txt !== lastTimeText) {
			readTime.textContent = txt;
			lastTimeText = txt;
		}
	}

	// ────────────────────────────────────────────── 键盘

	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") {
			if (d.op === "frame_preview") {
				closeFrame();
				return;
			}
			if (helpBox && !helpBox.hidden) {
				helpBox.hidden = true;
				btnHelp?.setAttribute("aria-expanded", "false");
				return;
			}
			if (d.scene !== "surface") setScene("surface");
			return;
		}
		if (e.key === "r" || e.key === "R") {
			d.turns = 0;
			d.turnsV = 0;
			turnsHold = 0;
		}
		// M = 水墨模式切换（spec：模式切换用快捷键 / 极简悬浮开关）
		if ((e.key === "m" || e.key === "M") && d.scene === "ink") {
			setInkMode(inkMode === "char" ? "painting" : "char");
		}
	}

	// ────────────────────────────────────────────── 挂载

	const onResize = () => relayout();
	const onLeave = () => {
		d.px = -1;
		d.py = -1;
	};
	let ro: ResizeObserver | null = null;

	relayout();
	syncButtons();
	syncReadout();
	if (typeof ResizeObserver !== "undefined") {
		ro = new ResizeObserver(onResize);
		ro.observe(stage);
	}
	window.addEventListener("resize", onResize, { passive: true });
	window.addEventListener("orientationchange", onResize, { passive: true });
	stage.addEventListener("pointerdown", onDown);
	window.addEventListener("pointermove", onMove, { passive: true });
	window.addEventListener("pointerup", onUp);
	window.addEventListener("pointercancel", onUp);
	stage.addEventListener("pointerleave", onLeave);
	window.addEventListener("keydown", onKey);
	raf = requestAnimationFrame(frame);

	return {
		destroy() {
			alive = false;
			cancelAnimationFrame(raf);
			ro?.disconnect();
			window.removeEventListener("resize", onResize);
			window.removeEventListener("orientationchange", onResize);
			stage.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			stage.removeEventListener("pointerleave", onLeave);
			window.removeEventListener("keydown", onKey);
		},
	};
}
