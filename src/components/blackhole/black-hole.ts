// 接线：状态机、事件、四层渲染、全局联动。
//
// 分工：各模块只管"把我这一层画出来"，一切共享量（指针、黑洞位置、吸积盘相位、吞噬脉冲、
// 引力波）都在这一个文件里推进，模块**只读不写**。四个读者 + 九个交互，散着写必然串台 ——
// 上一页（时间走马灯）的教训：一份状态，多个读者，这是唯一能长期不烂的写法。
//
// 状态机：idle · pressing · drag_rite
//   ⚠️ 误触阈值：按下只记"抓到了什么"，拖过 6px 才真正认领 —— 不然"在法阵上点一下"
//      也会占住 op，把同一时刻的生成/拖拽全挡掉。
//
// 两条互斥的主交互（spec §2.2）都从 `onDown` 的意向 + `onUp` 的"干净点击"判据上分流：
//   点**空白** → 生成随机法阵；点**黑洞本体** → 视界坍缩脉冲（全场法阵当场献祭）。
//   ⚠️ 判据是「按下过 ∧ 没拖动」，**不是**「op 还是 idle」—— 按下时 op 已经是 pressing 了，
//      拿 idle 判会把每一次点击都吞掉（这一页最早就是这么死的，见 `onUp`）。
//   ⚠️ 意向（`pending`）必须在 `onUp` 里**清空之前**读走，否则永远分不清点的是哪个。
//   视界脉冲**不需要新的 op**：它是瞬时的（设几个共享量就完事），没有"进行中的手势"。
//
// 🔴 **黑洞是钉死在页面中心的**（`s.hx/s.hy` 只在 `relayout` 里写一次）。它曾经可以被
//    拽着走、松手再弹回来，但那样整页的重心跟着指针跑，而引力透镜的中心是**烘在星野里**的
//    （见 hole.ts 的 `lensWarp`）—— 一拖，被掰弯的那片天就跟黑球错开，像画歪了。
//    "会动的天体"和"被扭曲的空间"这两件事，静态构图里只能选一个。

import { createHoleLayer, holeOf, hoverOf } from "./hole";
import { createRites, type Rites } from "./rites";
import {
	approach,
	BURST_DUR,
	COLLAPSE_DUR,
	createShared,
	dprCap,
	type Shared,
	STAGE_R,
	type Stage,
	stageOf,
	type View,
} from "./state";

export type BlackHoleApp = { destroy(): void };

const PHASE_TEXT: Record<string, string> = {
	idle: "虚空静默",
	generating: "成形",
	rising: "升起",
	active: "巅峰",
	dissolving: "解体",
	absorbing: "吞噬",
};

/**
 * 觉醒四阶的名字。读数里用它**代替阿拉伯数字** ——
 * spec §2.4 明令"全程不显示数字计数，层级通过形态与光点个数自然体现"，
 * 所以原来那个"已吞噬 N 座"的计数必须拆掉。名字留着是因为它对可用性有帮助
 * （"我按了半天到底在几阶"），而它并不违反"不显示数字"。
 */
const STAGE_TEXT: Record<Stage, string> = {
	1: "初醒",
	2: "荧动",
	4: "曜变",
	8: "归墟",
};

function need<T extends Element>(sel: string): T {
	const el = document.querySelector<T>(sel);
	// ⚠️ 取不到就炸，不要静默跑默认 —— "按名字取不到、于是整段从没跑过"是这一页最贵的坑。
	if (!el) throw new Error(`blackhole: 缺少必需的节点 ${sel}`);
	return el;
}
function opt<T extends Element>(sel: string): T | null {
	return document.querySelector<T>(sel);
}

export function createBlackHoleApp(): BlackHoleApp {
	const stage = need<HTMLElement>("#bh-stage");
	const elBg = need<HTMLCanvasElement>("#bh-bg");
	const elRite = need<HTMLCanvasElement>("#bh-rite");
	const elSparks = need<HTMLCanvasElement>("#bh-sparks");
	const elHole = need<HTMLCanvasElement>("#bh-hole");

	const s: Shared = createShared();
	const view: View = { w: 1, h: 1, dpr: 1, k: 0.42 };
	s.hx = view.w * 0.5;
	s.hy = view.h * 0.5;

	const c1 = elBg.getContext("2d");
	const c2 = elRite.getContext("2d");
	const c3 = elSparks.getContext("2d");
	const c4 = elHole.getContext("2d");
	// 「整站静默失效」唯一能提前抓住的哨兵：上下文没了，下面每一句都是空转。
	if (!c1 || !c2 || !c3 || !c4) throw new Error("blackhole: 拿不到 2D 上下文");
	const gBg: CanvasRenderingContext2D = c1;
	const gRite: CanvasRenderingContext2D = c2;
	const gSparks: CanvasRenderingContext2D = c3;
	const gHole: CanvasRenderingContext2D = c4;

	const bg = createHoleLayer();
	const rites: Rites = createRites();

	let alive = true;
	let raf = 0;
	let last = 0;
	let drawAcc = 0;
	let movedFar = false;
	/** 这一次按下有没有落在画布内（onUp 生成法阵前要再确认一次） */
	let downInStage = false;
	let downPos = { x: 0, y: 0 };
	/** 按下时认定要抓的东西（误触阈值见头注释） */
	let pending: { kind: "hole" } | { kind: "rite"; index: number } | null = null;
	let dragIdx = -1;

	// ────────────────────────────────────────── 尺寸

	function relayout() {
		const rect = stage.getBoundingClientRect();
		view.w = Math.max(1, rect.width);
		view.h = Math.max(1, rect.height);
		view.dpr = s.lite ? 1.25 : dprCap();
		// 俯视压缩：窄屏更"平"一点，圆环不至于挤出画面
		view.k = view.w < 760 ? 0.34 : 0.42;
		for (const [el, g] of [
			[elBg, gBg],
			[elRite, gRite],
			[elSparks, gSparks],
			[elHole, gHole],
		] as const) {
			el.width = Math.round(view.w * view.dpr);
			el.height = Math.round(view.h * view.dpr);
			el.style.width = `${view.w}px`;
			el.style.height = `${view.h}px`;
			g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		}
		// 首次布好之后才知道尺寸：把黑洞钉回中心
		s.hx = view.w * 0.5;
		s.hy = view.h * 0.5;
		// ⚠️ 背景层要拿 `s`：它烘星野时要顺手算引力透镜（透镜中心 = 黑洞静止位，见 hole.ts）
		bg.resize(view, s);
		rites.resize(view);
	}

	/** 每层开画前清干净。`setTransform` 必须重设：上一帧可能改过它。 */
	function clear(g: CanvasRenderingContext2D) {
		g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		g.clearRect(0, 0, view.w, view.h);
	}

	// ────────────────────────────────────────── 物理（所有共享量只在这里推进）

	function step(dt: number) {
		s.now = Date.now();

		// ── 觉醒四阶（spec §2.3）。阶数**只从 `swallowed` 派生**，不另存一份：
		//    过载喷发把 `swallowed` 清零，"打回 1 阶"自己就发生了。
		// ⚠️ 放在最前面：下面 `holeOf` 的半径要读它，这一帧就得是新的（晚一帧的话，
		//    换阶那一瞬间"环还在旧半径上、球已经长大了"）。
		const next = stageOf(s.swallowed);
		if (next !== s.stage) {
			s.stage = next;
			// 🔴 换阶 = 换半径 = 换引力透镜的 θE。**星野是烘出来的，透镜只在烘那一步做一次**，
			//    不重烘的话，活丝用的新 θE 与星野里的旧 θE 会分成两套几何（这一页的老坑）。
			//    ⚠️ 只在换阶那一帧做 —— 重烘是百万级像素的循环，绝不能每帧。
			bg.rebake(view, s);
		}
		// 半径**滑**到这一阶该有的大小，不跳（spec §2.4"形态过渡平滑不突兀"）。
		// ⚠️ 上面那次 `rebake` 用的是 `holeOf` 的**当时**半径 —— 过渡期间星野里的 θE
		//    会与新半径有一点点差（最多几 %），几帧内被吃掉，看不出来；
		//    但落定之后两者是一致的，这才是要紧的那条。
		s.rScale = approach(s.rScale, STAGE_R[s.stage], 3.2, dt);
		// ── 视界坍缩脉冲（spec §2.2）。整条包络（半径、亮度、符文圈）都在 state.ts 里，
		//    这里只推时间；`holeOf` 读它算出"正在收缩的"半径。
		if (s.collapse >= 0) {
			s.collapse += dt;
			if (s.collapse > COLLAPSE_DUR) s.collapse = -1;
		}
		// 8 阶过载喷发：烧完把层数打回 1 阶（spec §2.3 专属机制）
		if (s.burst >= 0) {
			s.burst += dt;
			if (s.burst > BURST_DUR) {
				s.burst = -1;
				s.swallowed = 0;
			}
		}

		const hole = holeOf(s, view);

		// 指针靠近：吸积盘提速、星尘偏转（spec §二 黑洞基础交互）
		s.hover = approach(s.hover, hoverOf(s, view, hole), 5, dt);
		// 静止基速 0.16 → 0.20：绕洞的活丝、盘上的亮点、上下细弧**都读这一个量**，
		// 提一档整页立刻"活"起来（神上一版的原话是「没有动感，太死了」）。
		s.spin += dt * (0.2 + 0.42 * s.hover) * (s.calm ? 0.4 : 1);

		// 黑洞钉死在页面中心（`relayout` 里写死）。原来这里有一步"松手后弹回中心"的弹簧，
		// 现在没有东西会把它推开，弹簧就只剩下一堆每帧的空转计算 —— 一起去掉。

		// 吞噬脉冲：叠加有上限（spec §二 吞噬反馈），随后平滑回落。
		// ⚠️ 回落速度**分阶**：8 阶"能量爆发持续更久"（spec §2.3 归墟），4 阶次之。
		s.pulse = approach(
			s.pulse,
			0,
			s.stage >= 8 ? 0.95 : s.stage >= 4 ? 1.15 : 1.5,
			dt,
		);
		if (s.wave >= 0) {
			s.wave += dt;
			if (s.wave > 1.6) s.wave = -1;
		}

		const eaten = rites.update(dt, view, hole, s);
		if (eaten > 0) {
			s.swallowed += eaten;
			s.pulse = Math.min(1.35, s.pulse + 0.42 * Math.min(2, eaten));
			s.wave = 0;
		}

		// 读数只认**最新那座法阵**（旧的正在退场，读数跟着它跳来跳去没意义）
		const top = rites.newest();
		s.focusPhase = top ? top.phase : "idle";
		s.focusName = top ? top.name : "";
	}

	/**
	 * 视界坍缩脉冲（spec §2.2）。点**黑洞本体**触发 —— 和"点空白生成法阵"是两回事，
	 * 判据在 `onDown`（按下就落在洞口里 → 记一个 `hole` 意向），`onUp` 确认是干净点击才执行。
	 *
	 * 三件事同时发生，缺一件就读不出"脉冲扫过全场"：
	 *   ① 黑洞先缩后弹 —— 由 `s.collapse` 驱动，`holeOf` 兑现（所以命中判定跟着一起变）；
	 *   ② 一圈**强力**引力波 —— `s.wave = 0` 重启，`s.pulse` 拉满让它比吞噬那圈更强更粗；
	 *   ③ 全场法阵**主动献祭** —— `forceDissolve()` 跳过停留，一起解体。
	 */
	function pulse() {
		s.collapse = 0;
		s.pulse = 1.35;
		s.wave = 0;
		rites.forceDissolve();
		// 8 阶专属「过载喷发」：这一记除了脉冲，还会**反向**甩出一波金光（见 hole.ts 的
		// `drawBurst`），烧完之后层数重置回 1 阶。
		if (s.stage >= 8) s.burst = 0;
	}

	// ────────────────────────────────────────── 渲染

	function render(dt: number) {
		const hole = holeOf(s, view);
		clear(gBg);
		bg.drawBg(gBg, s, view);
		clear(gRite);
		clear(gSparks);
		rites.draw(gRite, gSparks, view, s);
		clear(gHole);
		bg.draw(gHole, s, view, hole, dt);
	}

	function frame(now: number) {
		if (!alive) return;
		raf = requestAnimationFrame(frame);
		const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
		last = now;
		// 物理永远按 rAF 走（时间不停），降的只是"画"
		step(dt);
		// 静止降帧：没有法阵、没有手势时 24fps 足够（吸积盘那么慢，看不出来）。
		// ⚠️ 坍缩脉冲 / 过载喷发期间不许降帧 —— 那两段是全页最快的一瞬，24fps 会看出跳。
		drawAcc += dt;
		const busy =
			rites.count() > 0 ||
			s.op !== "idle" ||
			s.hover > 0.02 ||
			s.collapse >= 0 ||
			s.burst >= 0;
		if (busy || drawAcc >= 1 / 24) {
			drawAcc = 0;
			render(dt);
		}
		syncReadout();
	}

	// ────────────────────────────────────────── 指针

	function at(e: PointerEvent) {
		const r = stage.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent) {
		const el = e.target as Element | null;
		// 浮层控件（按钮、说明面板）自己处理
		if (el?.closest("button,a,input,label,select,.bh-help")) return;
		const { x, y } = at(e);
		// 越界连状态机都不进：否则 onUp 会拿着一个画布外的坐标去生成法阵
		// （画在看不见的地方，但读数照变 —— 排查时极难意识到）
		if (x < 0 || y < 0 || x > view.w || y > view.h) return;
		downInStage = true;
		s.px = x;
		s.py = y;
		hideIntro();
		if (s.op !== "idle") return;
		s.op = "pressing";
		downPos = { x, y };
		movedFar = false;
		dragIdx = -1;
		// 🔴 命中次序 = **精度优先**，不是"谁画在上面谁先判"。洞口是一个**明确的圆**
		//    （半径几十像素、位置固定），比随手一座法阵那圈稀疏的环窄得多，所以先判它 ——
		//    法阵压到洞口上时，点下去应该是"视界脉冲"，不是"把这阵拖走"。
		//    ⚠️ 半径取 `holeOf` 的实时值：脉冲收缩期间洞口真的变小了，命中区就该跟着小
		//    （这正是"把半径调制写进 holeOf"换来的好处 —— 三处读者自动一致）。
		const hole = holeOf(s, view);
		if (Math.hypot(x - hole.x, y - hole.y) < hole.r * 1.12) {
			pending = { kind: "hole" };
			return;
		}
		const i = rites.grab(x, y);
		if (i >= 0) {
			pending = { kind: "rite", index: i };
			return;
		}
		// 黑洞不参与拖拽（它钉在中心），所以按下落在它身上就是"没抓到东西" ——
		// 干净点击照旧在这一点生成法阵。
		pending = null;
	}

	function onMove(e: PointerEvent) {
		if (!alive) return;
		const { x, y } = at(e);
		if (x < 0 || y < 0 || x > view.w || y > view.h) {
			s.px = -1;
			s.py = -1;
			return;
		}
		s.px = x;
		s.py = y;
		if (s.op === "pressing") {
			if (!movedFar && Math.hypot(x - downPos.x, y - downPos.y) > 6) {
				movedFar = true;
				if (pending?.kind === "rite") {
					dragIdx = pending.index;
					s.op = "drag_rite";
				}
				pending = null;
			}
			return;
		}
		if (s.op === "drag_rite" && dragIdx >= 0) rites.drag(dragIdx, x, y);
	}

	function onUp() {
		if (!alive) return;
		const wasOp = s.op;
		// 🔴 主交互就在这里。原写法是 `if (wasOp !== "idle") { s.op = "idle"; return; }` ——
		//    而按下时 op 已经变成 "pressing"，于是**每一次干净的点击都在这一行被吞掉**：
		//    点画面永远不生成法阵，只剩右下角那个按钮能生成。
		//    正确的判据是「按下过 ∧ 没有拖动」，不是「op 还是 idle」。
		const tap = wasOp === "pressing" && !movedFar && downInStage;
		// ⚠️ 意向必须在**清空之前**读走 —— `pending` 下面几行就被置 null 了。
		const onHole = tap && pending?.kind === "hole";
		pending = null;
		downInStage = false;
		if (wasOp === "drag_rite" && dragIdx >= 0) {
			// 松手法阵：它会自己慢慢飘向黑洞，并在漂移中解体（spec §七 3）
			rites.release(dragIdx);
			dragIdx = -1;
		}
		s.op = "idle";
		if (!tap) return;
		// 点黑洞本体 = 视界坍缩脉冲；点空白 = 生成随机法阵。两条路从这里分开（spec §2.2）。
		if (onHole) pulse();
		else rites.spawn(downPos.x, downPos.y, s, view, holeOf(s, view));
	}

	function onLeave() {
		s.px = -1;
		s.py = -1;
	}

	// ────────────────────────────────────────── UI

	const readState = opt<HTMLElement>("#bh-state");
	const readTier = opt<HTMLElement>("#bh-tier");
	const intro = opt<HTMLElement>("#bh-intro");
	const helpBox = opt<HTMLElement>("#bh-help");
	const btnHelp = opt<HTMLButtonElement>("#bh-help-toggle");
	const btnMake = opt<HTMLButtonElement>("#bh-make");
	const btnPulse = opt<HTMLButtonElement>("#bh-pulse");

	function hideIntro() {
		intro?.classList.add("is-gone");
	}

	let lastState = "";
	let lastTier = "";
	function syncReadout() {
		const txt = PHASE_TEXT[s.focusPhase] ?? "虚空静默";
		// 比"拼好的整串"而不是比阶段名 —— 否则同一阶段换了一座法阵，名字不会更新
		const full = s.focusName ? `${txt} · ${s.focusName}` : txt;
		if (readState && full !== lastState) {
			readState.textContent = full;
			lastState = full;
		}
		// 🔴 这里**只给阶名，不给数字**（spec §2.4：不显示阿拉伯数字计数）。
		//    数量由洞口外围的光点个数暗示 —— 那是这一页读数的正主，文字只是个名字。
		const tier = STAGE_TEXT[s.stage];
		if (readTier && tier !== lastTier) {
			readTier.textContent = tier;
			lastTier = tier;
		}
	}

	btnMake?.addEventListener("click", () => {
		// 按钮在黑洞下方偏一点生成，别正好盖住主体
		const a = Math.random() * Math.PI * 2;
		rites.spawn(
			view.w * 0.5 + Math.cos(a) * view.w * 0.26,
			view.h * 0.5 + Math.sin(a) * view.h * 0.24,
			s,
			view,
			holeOf(s, view),
		);
		hideIntro();
	});

	// 键盘/触屏也走得到的那条明路（等价于"点黑洞本体"）
	btnPulse?.addEventListener("click", () => {
		pulse();
		hideIntro();
	});

	btnHelp?.addEventListener("click", () => {
		if (!helpBox) return;
		const open = helpBox.hidden;
		helpBox.hidden = !open;
		btnHelp.setAttribute("aria-expanded", String(open));
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") {
			if (helpBox && !helpBox.hidden) {
				helpBox.hidden = true;
				btnHelp?.setAttribute("aria-expanded", "false");
			}
			return;
		}
		// 键盘用户：光标在画面上时，回车/空格也能起一座法阵（触屏与键鼠等价）
		if (
			(e.key === "Enter" || e.key === " ") &&
			document.activeElement === stage
		) {
			e.preventDefault();
			btnMake?.click();
		}
	}

	// ────────────────────────────────────────── 挂载

	const onResize = () => relayout();
	let ro: ResizeObserver | null = null;

	relayout();
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
	bg.drawBg(gBg, s, view);

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
