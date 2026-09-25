// 时间走马灯：把一份时间状态、四张画布、六支模块装成一个应用。
//
// 指针怎么分区（一屏里有四组交互，靠落点到钟心的距离分开，别抢同一个手势）：
//   d < 0.16R   圆心     双击 / 右下按钮复位
//   灯环那一段（0.42–0.74R 附近）优先级最高 —— 落在那圈上就是转灯，不是拨针
//   其余在钟内的 → 空白   点一下写一句旧话；按住拖动则是拨针
//   d > 0.86R   刻度     点一下落一颗永久墨点
//   钟外         空白     写字；悬停或长按 2.5 秒则是点亮背景里的旧物
//
// 长按有两种，各管各的，不冲突：
//   按在**灯片**上 1.5 秒 → 收藏（触屏没有右键，这是替代手势）
//   按在**钟面上**/旧物上 2.5 秒 → 点亮旧物（要求几乎没有位移，否则算拖动）

import { blip, setSound } from "./audio";
import { createBrush, LINES, type WriterOptions } from "./brush";
import { createClock, TICK_COUNT, tickAt } from "./clock";
import {
	type Couplings,
	clamp,
	eraWord,
	SPEED_MAX,
	SPEED_MIN,
	speedWord,
} from "./couplings";
import { createRing, HOLD_TO_COLLECT, PANELS } from "./lantern-ring";
import { createScenery, RELICS } from "./scenery";

export type CarouselApp = { destroy: () => void };

type Part = "center" | "tick" | "hand" | "panel" | "relic" | "blank";

const HOLD_TO_LIGHT = 2.5;
/** 抬手时超过这个位移就不算「点一下」，算拖 */
const TAP_SLOP = 9;

// ⚠️ 从前这里收一个 root 参数然后完全不用它（内部还是 document）。删掉，
// 别留一个「看着像能换挂载点、其实换不动」的形参。
/** 可缺的元件：拿不到就当它不存在，调用处自己判空。 */
function q<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

/**
 * 必需的元件：拿不到立刻抛，返回**非空**类型。
 * ⚠️ 别写成「先 `q()` 再 `if (!el) throw`」——那种收窄进不了本文件下面那些
 * **被提升的 function 声明**（ts 18047），每处引用都要报一次 possibly null。
 */
function need<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`carousel: 舞台上缺 #${id}`);
	return el as unknown as T;
}

export function createCarouselApp(): CarouselApp {
	const stage = need<HTMLElement>("tc-stage");
	const paper = need<HTMLCanvasElement>("tc-paper");
	const main = need<HTMLCanvasElement>("tc-main");
	const ringCv = need<HTMLCanvasElement>("tc-ring");
	const ink = need<HTMLCanvasElement>("tc-ink");
	const intro = q<HTMLElement>("tc-intro");
	const readTime = q<HTMLElement>("tc-readout-time");
	const readCount = q<HTMLElement>("tc-readout-count");
	const resetBtn = q<HTMLButtonElement>("tc-reset");
	const nav = q<HTMLElement>("tc-nav");
	const caption = q<HTMLElement>("tc-caption");
	const capNote = q<HTMLElement>("tc-caption-note");
	const capLatin = q<HTMLElement>("tc-caption-latin");
	const helpToggle = q<HTMLButtonElement>("tc-help-toggle");
	const helpBox = q<HTMLElement>("tc-help");
	const soundBox = q<HTMLInputElement>("tc-sound");

	const c: Couplings = {
		rewind: 0,
		dragging: false,
		speed: 1,
		wind: 0,
		focus: 0,
		clock: 0,
		still: 0,
		hint: 1,
		allCollected: false,
		calm: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	};

	const scenery = createScenery(paper, c);
	const clock = createClock(main, c);
	const ring = createRing(ringCv, c, clock.center, clock.radius);
	const brush = createBrush(ink, c);

	/** 最后一次指针位置（悬停判定每帧都要用） */
	const pointer = { x: -999, y: -999, inside: false };
	/** 指针 id → 按下时刻，长按判定用 */
	const downAt = new Map<number, number>();
	/** 双指（触屏调速） */
	const pointers = new Map<number, { x: number; y: number }>();
	let pinchFrom = 0;
	let pinchSpeed = 1;
	let lastMove = { x: 0, y: 0, t: 0 };
	/** 旧物各自亮到什么时候（performance.now 时间戳） */
	const litUntil = [0, 0, 0];
	let expandedRelic = -1;

	let raf = 0;
	let last = performance.now();
	let destroyed = false;
	let used = false;
	let hidden = false;
	let lastReadout = "";
	/** 已经落了几句旧话（只数「在空处点一下」写出来的，不含灯片题名）。 */
	let linesWritten = 0;
	/** 静思模式的目标值：写满六句题记就进，复位就出。 */
	let stillTarget = 0;
	/** 拨针上一次落在第几格，用来在过格的那一帧出声。 */
	let lastTickIdx = 0;

	/** 指针按下的那一笔的状态 */
	let active: {
		part: Part;
		slot: number;
		relic: number;
		x0: number;
		y0: number;
		moved: boolean;
		holdFired: boolean;
		pointerId: number;
	} | null = null;

	function markUsed() {
		if (used) return;
		used = true;
		intro?.classList.add("is-gone");
	}

	/** 落笔微震：纸被笔尖按了一下。
	 *
	 *  加在**整层墨**上而不是某一个字上 —— 抖的是纸，不是字；一行 CSS 都不用写，
	 *  用 Web Animations 也不会在元素上留一个 transform（那个会跟着 hover 打架）。
	 */
	function tap() {
		if (c.calm) return;
		ink.animate(
			[
				{ transform: "translateY(0)" },
				{ transform: "translateY(1.6px)" },
				{ transform: "translateY(-0.7px)" },
				{ transform: "translateY(0)" },
			],
			{ duration: 240, easing: "ease-out" },
		);
	}

	/** 写一句。三处落笔走同一个入口，于是「微震 + 那一声轻响」不会漏掉某一路。 */
	function writeLine(text: string, x: number, y: number, opt: WriterOptions) {
		brush.write(text, x, y, opt);
		tap();
		blip(300, 46, 0.03);
	}

	/** 在空处落一句旧话（语录池里随机取）。写满六句就进静思模式。 */
	function writeRandomLine(x: number, y: number, size: number, alpha: number) {
		writeLine(LINES[Math.floor(Math.random() * LINES.length)], x, y, {
			size,
			mode: "h",
			alpha,
		});
		linesWritten++;
		if (linesWritten >= LINES.length) stillTarget = 1;
	}

	// ---------------------------------------------------------------- 灯片与收藏

	function showCaption(slot: number) {
		const p = PANELS[slot];
		if (capNote) capNote.textContent = p.note;
		if (capLatin) capLatin.textContent = p.latin;
		if (!caption) return;
		caption.hidden = false;
		requestAnimationFrame(() => caption?.classList.add("is-on"));
	}

	function hideCaption() {
		if (!caption) return;
		caption.classList.remove("is-on");
		window.setTimeout(() => {
			if (caption && !caption.classList.contains("is-on"))
				caption.hidden = true;
		}, 300);
	}

	function openPanel(slot: number) {
		const next = ring.toggle(slot);
		if (next >= 0) {
			// 展开先把画面空出来：灯片占住钟心，底下的旧字留着只会打架
			brush.clear();
			showCaption(slot);
			expandedRelic = PANELS[slot].relic;
			blip(420, 68, 0.035);
			// 落位之后才写字：飞在半路上的灯片上写字会跟着一起飘
			window.setTimeout(
				() => {
					if (destroyed || ring.expanded() !== slot) return;
					const box = ring.expandedBox();
					if (!box) return;
					writeLine(PANELS[slot].title, box.x, box.y, {
						size: box.size,
						mode: "v",
						alpha: 0.94,
					});
				},
				c.calm ? 0 : 460,
			);
		} else {
			hideCaption();
			expandedRelic = -1;
			// 收起时把那张灯片现写的字抹掉，让烘好的题名重新露出来
			brush.clear();
		}
		markUsed();
	}

	function collect(slot: number) {
		if (slot < 0 || ring.collected()[slot]) return;
		ring.markCollected(slot);
		// 收藏 → 在对应刻度上落一颗金点。六张灯片、十二个刻度，正好一格隔一格。
		clock.dropMark(slot * 2, "gold", slot);
		ring.burst(slot);
		blip(760, 90, 0.05);
		markUsed();
	}

	/** 每帧把「谁该亮」算一遍：悬停的旧物与灯片、展开的灯片、还没到期的长按 */
	function updateRelics() {
		const now = performance.now();
		const want = [false, false, false];
		if (pointer.inside) {
			const r = scenery.hit(pointer.x, pointer.y);
			if (r >= 0) want[r] = true;
			const s = ring.hover(pointer.x, pointer.y);
			if (s >= 0) want[PANELS[s].relic] = true;
		} else {
			ring.hover(-1, -1);
		}
		if (expandedRelic >= 0) want[expandedRelic] = true;
		for (let i = 0; i < RELICS.length; i++) {
			if (now < litUntil[i]) want[i] = true;
			scenery.setLit(i, want[i]);
		}
	}

	function route(
		x: number,
		y: number,
	): { part: Part; slot: number; relic: number } {
		const slot = ring.hit(x, y);
		if (slot >= 0) return { part: "panel", slot, relic: -1 };
		const p = clock.partAt(x, y);
		if (p) return { part: p, slot: -1, relic: -1 };
		const r = scenery.hit(x, y);
		if (r >= 0) return { part: "relic", slot: -1, relic: r };
		return { part: "blank", slot: -1, relic: -1 };
	}

	function updateReadout() {
		const quiet = c.still > 0.5;
		const text = quiet ? "静思" : `${eraWord(c)} · ${speedWord(c)}`;
		const n = ring.collected().filter(Boolean).length;
		const key = `${text}|${n}`;
		if (key === lastReadout) return;
		lastReadout = key;
		if (readTime) readTime.textContent = text;
		if (readCount)
			readCount.textContent = n
				? `收藏 ${n} / ${PANELS.length}`
				: quiet
					? "六句已落"
					: "未收藏";
	}

	// ---------------------------------------------------------------- 主循环

	function frame(now: number) {
		if (destroyed) return;
		raf = requestAnimationFrame(frame);
		// 标签页被切走时别算：这几帧的 dt 是几分钟，一回来整页会跳一下；
		// 而 rAF 在后台本来就该停，这一句是给「切回来第一帧」垫的。
		if (hidden) {
			last = now;
			return;
		}
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		c.clock += dt;

		// 引导与静思都是「慢慢过去」的量，不瞬间切换：
		// 第一次动手之后指针就不再晃；写满六句则整页一点点静下来。
		c.hint = used ? Math.max(0, c.hint - dt * 1.2) : 1;
		c.still += (stillTarget - c.still) * Math.min(1, dt * 0.7);

		// 长按到点了就办事。⚠️ 判据是「按下到现在」，不是「最后一次移动到现在」——
		// 按着不动的人本来就不会有新的 move 事件。
		if (active && !active.moved && !active.holdFired) {
			const held = now - (downAt.get(active.pointerId) ?? now);
			if (active.part === "panel" && held >= HOLD_TO_COLLECT * 1000) {
				collect(active.slot);
				active.holdFired = true;
			} else if (held >= HOLD_TO_LIGHT * 1000) {
				const targets = active.part === "relic" ? [active.relic] : [0, 1, 2];
				for (const i of targets) litUntil[i] = now + 2600;
				active.holdFired = true;
			}
		}

		// 拨针过格的一声：齿感要听得见才算齿感（音效关着的时候这里什么都不做）
		const step = (Math.PI * 2) / TICK_COUNT;
		const tickIdx = Math.round(clock.sweep() / step);
		if (tickIdx !== lastTickIdx) {
			if (c.dragging) blip(620, 34, 0.035);
			lastTickIdx = tickIdx;
		}

		// 针被拨回「此刻」时，三件旧物一起亮一下 —— 此刻它们都还在
		const before = c.rewind;
		// 展开进度要在 clock.frame 之前写进去：针与刻度据它退到后面
		c.focus = ring.expandProgress();
		clock.frame(dt);
		if (before > 0.02 && c.rewind <= 0.02) {
			for (let i = 0; i < 3; i++) litUntil[i] = now + 1800;
		}
		c.allCollected = ring.collected().filter(Boolean).length >= PANELS.length;

		updateRelics();
		ring.frame(dt);
		scenery.frame(dt);
		brush.frame(dt);
		updateReadout();
	}

	// ---------------------------------------------------------------- 指针

	function local(e: { clientX: number; clientY: number }) {
		const r = stage.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent) {
		// 舞台上的按钮、链接、说明面板都盖在画布之上。落在它们身上的那一下不能再当成
		// 「在空处点了一下」—— 从前点一次「回到此刻」，右下角会凭空多出一行谁也没要的字
		// （按钮的 click 照旧生效，只是不再顺手写一句）。
		const hitUi = (e.target as HTMLElement | null)?.closest(
			"button, a, input, label, select, .tc-help",
		);
		if (hitUi) return;
		const { x, y } = local(e);
		pointers.set(e.pointerId, { x, y });
		downAt.set(e.pointerId, performance.now());
		lastMove = { x, y, t: performance.now() };
		if (pointers.size >= 2) {
			// 双指：不再当拖拽，转成调速
			pinchFrom = e.clientY;
			pinchSpeed = c.speed;
			ring.endDrag();
			ring.release();
			active = null;
			c.dragging = false;
			return;
		}
		const r = route(x, y);
		active = {
			part: r.part,
			slot: r.slot,
			relic: r.relic,
			x0: x,
			y0: y,
			moved: false,
			holdFired: false,
			pointerId: e.pointerId,
		};
		if (r.part === "hand") {
			// ⚠️ 只记下抓取点，**不动针**。按下的那一刻就 drag() 的话，
			// 点一下（本来只是想写句话）会把针吸到指下，时间凭空倒退一截；
			// 长按也会变成一次误操作。真正的转动等到 onMove 里确认位移之后。
			clock.beginDrag(x, y);
		} else if (r.part === "panel") {
			ring.press(x, y);
		}
		markUsed();
	}

	function onMove(e: PointerEvent) {
		const { x, y } = local(e);
		pointers.set(e.pointerId, { x, y });
		pointer.x = x;
		pointer.y = y;
		pointer.inside = true;

		if (pointers.size >= 2) {
			// 双指上下滑：改时间流速。两张手指的纵向位移取平均。
			const dy = e.clientY - pinchFrom;
			c.speed = clamp(pinchSpeed * (1 - dy / 260), SPEED_MIN, SPEED_MAX);
			return;
		}

		const now = performance.now();
		const dt = Math.max(0.001, (now - lastMove.t) / 1000);
		const px = lastMove.x;
		const py = lastMove.y;
		lastMove = { x, y, t: now };

		if (active) {
			if (!active.moved && Math.hypot(x - active.x0, y - active.y0) > TAP_SLOP)
				active.moved = true;
			if (!active.moved) return;
			if (active.part === "panel") {
				ring.drag(x, y);
			} else {
				// 真的开始拨了才停掉自动回正，之前按着不动的那一段不算拖动
				c.dragging = true;
				clock.drag(x, y);
			}
			return;
		}
		// 空手上游走：慢则墨影，快则长风扫墨
		brush.trail(x, y, Math.hypot(x - px, y - py) / dt, dt);
	}

	function onUp(e: PointerEvent) {
		const { x, y } = local(e);
		pointers.delete(e.pointerId);
		downAt.delete(e.pointerId);
		const a = active;
		active = null;
		c.dragging = false;
		clock.endDrag();
		if (a) {
			if (a.part === "panel") {
				ring.endDrag();
				ring.release();
			}
			// ⚠️ 长按已经办过事了（收藏 / 点亮旧物），抬手就**不再**当「点一下」——
			// 否则在灯片上按 1.5 秒收下了它，松手又把它展开；在钟面上按 2.5 秒
			// 点亮了旧物，松手还顺手写下一句没人要的旧话。
			if (!a.moved && !a.holdFired) {
				// 抬手：只有「几乎没动过」才算点一下
				if (a.part === "panel") {
					openPanel(a.slot);
				} else if (a.part === "tick") {
					const ctr = clock.center();
					clock.dropMark(tickAt(x, y, ctr.x, ctr.y), "ink");
				} else if (a.part === "blank" || a.part === "hand") {
					if (ring.expanded() >= 0) {
						// 展开状态下点空白 = 收起（钟内那圈也是「空白」）
						openPanel(ring.expanded());
					} else if (a.part === "blank") {
						writeRandomLine(x, y, clamp(clock.radius() * 0.105, 22, 46), 0.9);
					} else {
						// 点在钟内那片空地上也写字：别让用户去猜哪块空地才算数
						writeRandomLine(x, y, clamp(clock.radius() * 0.09, 20, 40), 0.86);
					}
				}
			}
		}
		pointer.inside = false;
	}

	function onLeave() {
		pointer.inside = false;
		pointer.x = -999;
		pointer.y = -999;
	}

	function onContext(e: MouseEvent) {
		if (
			(e.target as HTMLElement | null)?.closest(
				"button, a, input, label, select",
			)
		)
			return;
		const { x, y } = local(e);
		const slot = ring.hit(x, y);
		if (slot >= 0) {
			e.preventDefault();
			collect(slot);
			return;
		}
		// 右键空地：把最后一行字淡去
		if (clock.partAt(x, y) === null && scenery.hit(x, y) < 0) {
			e.preventDefault();
			brush.fade();
		}
	}

	/** 回到此刻。顺带把静思模式解掉、六句重新数 —— 这一下是「重新开始看」。 */
	function backToNow() {
		clock.reset();
		stillTarget = 0;
		linesWritten = 0;
		markUsed();
	}

	function onDblClick(e: MouseEvent) {
		const { x, y } = local(e);
		const part = clock.partAt(x, y);
		if (part === "center") {
			backToNow();
		} else if (part === null) {
			// 双击空地：风干最后一行字
			brush.dry();
		}
	}

	function onWheel(e: WheelEvent) {
		const { x, y } = local(e);
		// 只有落在钟盘上的滚轮才改流速；页面正文那一侧还要正常滚
		if (clock.partAt(x, y) === null && ring.hit(x, y) < 0) return;
		e.preventDefault();
		c.speed = clamp(c.speed * (1 - e.deltaY * 0.0009), SPEED_MIN, SPEED_MAX);
		markUsed();
	}

	function onKey(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName ?? "";
		if (tag === "INPUT" || tag === "TEXTAREA") return;
		if (e.key === "Backspace") {
			if (brush.undo()) e.preventDefault();
		} else if (e.key === "Escape") {
			// Esc 先收说明面板，再收展开的灯片 —— 一层一层退，别一下全关掉
			if (helpBox && !helpBox.hidden) {
				toggleHelp(false);
			} else if (ring.expanded() >= 0) {
				openPanel(ring.expanded());
			}
		}
	}

	/** 说明面板开合。按钮与面板上的 aria 一起更新，读屏才知道现在是开还是关。 */
	function toggleHelp(open: boolean) {
		if (!helpBox || !helpToggle) return;
		helpBox.hidden = !open;
		helpToggle.setAttribute("aria-expanded", open ? "true" : "false");
	}

	function onVisibility() {
		hidden = document.hidden;
	}

	// ---------------------------------------------------------------- 装配

	const ro = new ResizeObserver(() => {
		scenery.resize();
		clock.resize();
		ring.resize();
		brush.resize();
	});
	ro.observe(stage);

	stage.addEventListener("pointerdown", onDown);
	stage.addEventListener("pointermove", onMove);
	stage.addEventListener("pointerup", onUp);
	stage.addEventListener("pointercancel", onUp);
	stage.addEventListener("pointerleave", onLeave);
	stage.addEventListener("contextmenu", onContext);
	stage.addEventListener("dblclick", onDblClick);
	stage.addEventListener("wheel", onWheel, { passive: false });
	window.addEventListener("keydown", onKey);
	document.addEventListener("visibilitychange", onVisibility);
	resetBtn?.addEventListener("click", backToNow);
	helpToggle?.addEventListener("click", () =>
		toggleHelp(helpBox?.hidden ?? false),
	);
	soundBox?.addEventListener("change", () => {
		setSound(soundBox.checked);
		if (soundBox.checked) blip(560, 80, 0.05);
	});
	nav?.addEventListener("click", (e) => {
		const btn = (e.target as HTMLElement).closest("button[data-slot]");
		if (btn) openPanel(Number(btn.getAttribute("data-slot")));
	});

	// 首帧：先把尺寸量准再起循环，否则第一帧画在 1×1 的画布上
	scenery.resize();
	clock.resize();
	ring.resize();
	brush.resize();
	raf = requestAnimationFrame(frame);

	// 自测钩子：断言要读到内部真值，别靠截图像素猜
	(window as unknown as { __tc: unknown }).__tc = {
		state: c,
		clock,
		ring,
		brush,
		scenery,
		panels: PANELS,
		// 这两个是内部计数器，不露出来的话「六句之后进静思」只能靠看画面猜
		lines: () => linesWritten,
		still: () => stillTarget,
		ticks: () => lastTickIdx,
	};

	return {
		destroy() {
			destroyed = true;
			cancelAnimationFrame(raf);
			ro.disconnect();
			stage.removeEventListener("pointerdown", onDown);
			stage.removeEventListener("pointermove", onMove);
			stage.removeEventListener("pointerup", onUp);
			stage.removeEventListener("pointercancel", onUp);
			stage.removeEventListener("pointerleave", onLeave);
			stage.removeEventListener("contextmenu", onContext);
			stage.removeEventListener("dblclick", onDblClick);
			stage.removeEventListener("wheel", onWheel);
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("visibilitychange", onVisibility);
		},
	};
}
