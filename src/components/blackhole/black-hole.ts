// 接线：状态机、事件、四层渲染、全局联动。
//
// 分工：各模块只管"把我这一层画出来"，一切共享量（指针、黑洞位置、吸积盘相位、吞噬脉冲、
// 引力波）都在这一个文件里推进，模块**只读不写**。四个读者 + 九个交互，散着写必然串台 ——
// 上一页（时间走马灯）的教训：一份状态，多个读者，这是唯一能长期不烂的写法。
//
// 状态机：idle · pressing · drag_hole · drag_rite
//   ⚠️ 误触阈值：按下只记"抓到了什么"，拖过 6px 才真正认领 —— 不然"在法阵上点一下"
//      也会占住 op，把同一时刻的生成/拖拽全挡掉。

import { createHoleLayer, holeOf, hoverOf } from "./hole";
import { createRites, type Rites } from "./rites";
import {
	approach,
	clamp,
	createShared,
	dprCap,
	type Shared,
	spring,
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
		bg.resize(view);
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
		const hole = holeOf(s, view);

		// 指针靠近：吸积盘提速、星尘偏转（spec §二 黑洞基础交互）
		s.hover = approach(s.hover, hoverOf(s, view, hole), 5, dt);
		s.spin += dt * (0.16 + 0.42 * s.hover) * (s.calm ? 0.4 : 1);

		// 黑洞回位：松手后弹回页面中心（带速度，见 state.ts 的 spring）
		if (s.op !== "drag_hole") {
			[s.hx, s.hvx] = spring(s.hx, s.hvx, view.w * 0.5, 18, 7.4, dt);
			[s.hy, s.hvy] = spring(s.hy, s.hvy, view.h * 0.5, 18, 7.4, dt);
		}

		// 吞噬脉冲：叠加有上限（spec §二 吞噬反馈），随后 1~2 秒平滑回落
		s.pulse = approach(s.pulse, 0, 1.5, dt);
		if (s.wave >= 0) {
			s.wave += dt;
			if (s.wave > 1.6) s.wave = -1;
		}

		const eaten = rites.update(dt, view, hole);
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

	// ────────────────────────────────────────── 渲染

	function render(dt: number) {
		const hole = holeOf(s, view);
		clear(gBg);
		bg.drawBg(gBg, s, view);
		clear(gRite);
		clear(gSparks);
		rites.draw(gRite, gSparks, view);
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
		// 静止降帧：没有法阵、没有手势时 24fps 足够（吸积盘那么慢，看不出来）
		drawAcc += dt;
		const busy = rites.count() > 0 || s.op !== "idle" || s.hover > 0.02;
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
		if (x < 0 || y < 0 || x > view.w || y > view.h) return;
		s.px = x;
		s.py = y;
		hideIntro();
		if (s.op !== "idle") return;
		s.op = "pressing";
		downPos = { x, y };
		movedFar = false;
		dragIdx = -1;
		const hole = holeOf(s, view);
		// 命中次序 = **精度优先**：先问法阵（圆环窄、还在动），再问黑洞（大而稳）。
		// 反过来的话，想拖法阵会变成把黑洞拽走。
		const i = rites.grab(x, y);
		if (i >= 0) {
			pending = { kind: "rite", index: i };
			return;
		}
		if (Math.hypot(x - hole.x, y - hole.y) < hole.r * 2.6) {
			pending = { kind: "hole" };
			return;
		}
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
				if (pending?.kind === "hole") s.op = "drag_hole";
				else if (pending?.kind === "rite") {
					dragIdx = pending.index;
					s.op = "drag_rite";
				}
				pending = null;
			}
			return;
		}
		if (s.op === "drag_hole") {
			// 直接跟手（不给速度，松手才让弹簧接上）
			s.hx = clamp(x, view.w * 0.18, view.w * 0.82);
			s.hy = clamp(y, view.h * 0.2, view.h * 0.8);
			s.hvx = 0;
			s.hvy = 0;
			return;
		}
		if (s.op === "drag_rite" && dragIdx >= 0) rites.drag(dragIdx, x, y);
	}

	function onUp(e: PointerEvent) {
		if (!alive) return;
		const { x, y } = at(e);
		const wasOp = s.op;
		pending = null;
		if (wasOp === "drag_rite" && dragIdx >= 0) {
			// 松手法阵：它会自己慢慢飘向黑洞，并在漂移中解体（spec §七 3）
			rites.release(dragIdx);
			dragIdx = -1;
		}
		if (wasOp !== "idle") {
			s.op = "idle";
			return;
		}
		// 点一下 = 生成一座法阵（同一个位置连点会被 spawn 自身的冷却挡掉）
		if (!movedFar) rites.spawn(x, y, s, view, holeOf(s, view));
	}

	function onLeave() {
		s.px = -1;
		s.py = -1;
	}

	// ────────────────────────────────────────── UI

	const readState = opt<HTMLElement>("#bh-state");
	const readCount = opt<HTMLElement>("#bh-count");
	const intro = opt<HTMLElement>("#bh-intro");
	const helpBox = opt<HTMLElement>("#bh-help");
	const btnHelp = opt<HTMLButtonElement>("#bh-help-toggle");
	const btnMake = opt<HTMLButtonElement>("#bh-make");

	function hideIntro() {
		intro?.classList.add("is-gone");
	}

	let lastState = "";
	let lastCount = "";
	function syncReadout() {
		const txt = PHASE_TEXT[s.focusPhase] ?? "虚空静默";
		// 比"拼好的整串"而不是比阶段名 —— 否则同一阶段换了一座法阵，名字不会更新
		const full = s.focusName ? `${txt} · ${s.focusName}` : txt;
		if (readState && full !== lastState) {
			readState.textContent = full;
			lastState = full;
		}
		const c = String(s.swallowed);
		if (readCount && c !== lastCount) {
			readCount.textContent = c;
			lastCount = c;
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
