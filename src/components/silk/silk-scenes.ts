// 丝缕四面体 · 场景接线层
//
// 一个页面五个场景：枢纽（#hub）+ A/B/C 三张画布（#a/#b/#c）+ D 壁纸（#d）。
// 为什么不做真路由：真跳转会把 WebGL 上下文销毁重建，枢纽那套粒子状态就丢了，
// spec 要的「镜头推近再跳转」的连续感做不到。这里用 hash 深链 ——
// 既在同一场景内过渡，又能把 `#d` 这样的地址单独发给别人，还白送浏览器后退键。
//
// 需要对上的 DOM（写在 SilkTetrahedron.astro 里）：
//   #silk-stage / #silk-hub-stage / #silk-hub-canvas / #silk-ambient
//   #silk-paint-stage / #silk-paint-canvas / #silk-hint / #silk-scene-title
//   #silk-wall-stage / #silk-wall-canvas / #silk-wall-hint
//   #silk-back / #silk-dice / #silk-panel / #silk-palette / #silk-sym
//   #silk-count / #silk-glitch / #silk-glitch-row / #silk-erase / #silk-clear
//   #silk-sound / #silk-save / #silk-fade

import { createHub, FACE_ORDER, type FaceKey } from "./silk-hub";
import {
	aimPen,
	createPen,
	DEFAULT_SYMMETRY_COUNT,
	ERASE_ALPHA,
	framePen,
	MAX_SYMMETRY_COUNT,
	MIN_SYMMETRY_COUNT,
	type PaintKind,
	type Pen,
	paintStroke,
	penAlive,
	penFade,
	randomHue,
	STROKE_ALPHA,
	type Stroke,
	SYMMETRY_LABEL,
	SYMMETRY_ORDER,
	type SymmetryMode,
} from "./silk-symmetry";
import { createWall } from "./silk-wall";

type SceneName = "hub" | "a" | "b" | "c" | "d";
type PaintScene = Exclude<SceneName, "hub">;

const SCENES: Record<
	PaintScene,
	{
		face: FaceKey;
		label: string;
		kind: PaintKind;
		light: boolean;
		/** 有绘画工具面板的才是能画的那三面 */
		paint: boolean;
	}
> = {
	a: {
		face: "A",
		label: "原版 Silk · 丝缕",
		kind: "silk",
		light: true,
		paint: true,
	},
	b: {
		face: "B",
		label: "Pixel-Silk · 像素",
		kind: "pixel",
		light: true,
		paint: true,
	},
	c: {
		face: "C",
		label: "Cyber-Silk · 赛博",
		kind: "cyber",
		light: false,
		paint: true,
	},
	d: {
		face: "D",
		label: "归境 · 粒子壁纸",
		kind: "silk",
		light: false,
		paint: false,
	},
};

const FADE_MS = 250;

function q<T extends Element>(root: ParentNode, sel: string): T {
	const el = root.querySelector(sel);
	if (!el) throw new Error(`丝缕四面体：找不到 ${sel}`);
	return el as unknown as T;
}

export type SilkApp = { destroy: () => void };

// ⚠️ root 必须是**整个 document**，不能传 #silk-stage 元素本身。
// 下面所有 q() 都是全页 id 查询，而 querySelector **只搜后代、不搜自己** ——
// 传元素进来的话第一句 q(root, "#silk-stage") 就返回 null 并抛错，
// 整个应用在构造函数的第 4 行死掉，页面上只剩写死在 HTML 里的文案和骰子。
export function createSilkApp(root: ParentNode): SilkApp {
	// ------------------------------------------------------------------ DOM
	const stageEl = q<HTMLElement>(root, "#silk-stage");
	const hubStage = q<HTMLElement>(root, "#silk-hub-stage");
	const hubCanvas = q<HTMLCanvasElement>(root, "#silk-hub-canvas");
	const ambientCanvas = q<HTMLCanvasElement>(root, "#silk-ambient");
	const paintStage = q<HTMLElement>(root, "#silk-paint-stage");
	const paintCanvas = q<HTMLCanvasElement>(root, "#silk-paint-canvas");
	const wallStage = q<HTMLElement>(root, "#silk-wall-stage");
	const wallCanvas = q<HTMLCanvasElement>(root, "#silk-wall-canvas");
	const wallHint = q<HTMLElement>(root, "#silk-wall-hint");
	const hint = q<HTMLElement>(root, "#silk-hint");
	const titleEl = q<HTMLElement>(root, "#silk-scene-title");
	const panel = q<HTMLElement>(root, "#silk-panel");
	const paletteEl = q<HTMLElement>(root, "#silk-palette");
	const symEl = q<HTMLSelectElement>(root, "#silk-sym");
	const countEl = q<HTMLInputElement>(root, "#silk-count");
	const glitchRow = q<HTMLElement>(root, "#silk-glitch-row");
	const glitchEl = q<HTMLInputElement>(root, "#silk-glitch");
	const eraseEl = q<HTMLButtonElement>(root, "#silk-erase");
	const clearEl = q<HTMLButtonElement>(root, "#silk-clear");
	const soundEl = q<HTMLButtonElement>(root, "#silk-sound");
	const saveEl = q<HTMLButtonElement>(root, "#silk-save");
	const diceEl = q<HTMLButtonElement>(root, "#silk-dice");
	const backEl = q<HTMLButtonElement>(root, "#silk-back");
	const creditEl = q<HTMLElement>(root, "#silk-credit");
	const fadeEl = q<HTMLElement>(root, "#silk-fade");

	// 音效全部现场合成，不引任何音频文件（详见文件末尾 createAudio）
	const audio = createAudio();
	// 枢纽背景那层流动丝纹（和 A 面共用同一套对称与平滑几何）
	const ambient = createAmbient(ambientCanvas);
	// D 面的粒子壁纸。它是**懒装配**的：壁纸要逐像素采样、还要解一张 960 宽的图，
	// 首屏不该为它付这笔钱 —— 第一次真的进 D 面时才开始建。
	const wall = createWall(wallCanvas);

	// ------------------------------------------------------------------ 枢纽
	let scene: SceneName = "hub";
	let busy = false;
	let settleTimer = 0;

	const hub = createHub(hubCanvas, {
		onPick(face) {
			if (scene !== "hub") return;
			enterScene(face.toLowerCase() as PaintScene);
		},
		onSettle(face) {
			audio.bell(FACE_ORDER.indexOf(face));
			// 枢纽自己会把这一面亮 1.2 秒；亮完再推近，人才能看清摇到哪一面
			window.clearTimeout(settleTimer);
			settleTimer = window.setTimeout(() => {
				if (scene === "hub") enterScene(face.toLowerCase() as PaintScene);
			}, 1200);
		},
	});

	// -------------------------------------------------------------- 场景切换
	let fadeTimer = 0;

	function applyScene(next: SceneName) {
		scene = next;
		const isHub = next === "hub";
		const conf = isHub ? null : SCENES[next];
		// 只有 D 是「有场景、但不带画笔」的那一面
		const isWall = next === "d";

		hubStage.hidden = !isHub;
		paintStage.hidden = isHub || !conf?.paint;
		wallStage.hidden = !isWall;
		panel.hidden = isHub || !conf?.paint;
		glitchRow.hidden = conf?.kind !== "cyber";
		hint.hidden = !isHub;
		wallHint.hidden = !isWall;
		// 出处标注只跟三张画布走（D 面没有画布，底部中央留给那句文案）
		creditEl.hidden = isHub || !conf?.paint;
		titleEl.hidden = isHub;
		diceEl.hidden = !isHub;
		backEl.hidden = isHub;
		stageEl.classList.toggle("is-light", conf?.light === true);
		stageEl.dataset.kind = conf?.kind ?? "silk";

		hub.setRunning(isHub);
		ambient.setRunning(isHub);
		wall.setRunning(isWall);

		if (isHub) {
			audio.setAmbient(true);
			hub.reset();
			return;
		}

		audio.setAmbient(false);
		titleEl.textContent = conf?.label ?? "";
		if (!conf?.paint) return;
		// B/C 只换渲染层：对称、历史、快捷键全部共用，差别只在 paintStroke 的 kind
		paint.kind = conf?.kind ?? "silk";
		paint.resize();
	}

	function enterScene(next: PaintScene) {
		if (busy || scene === next) return;
		busy = true;
		// 先让枢纽把镜头推近，推到位再淡出换场景
		hub.flyTo(FACE_ORDER.indexOf(SCENES[next].face), () => {
			audio.whoosh();
			fadeTo(SCENES[next].light, () => {
				applyScene(next);
				setHash(next);
				busy = false;
			});
		});
	}

	function backToHub() {
		if (busy || scene === "hub") return;
		busy = true;
		audio.whoosh();
		fadeTo(false, () => {
			applyScene("hub");
			setHash("hub");
			busy = false;
		});
	}

	/** byNext 说的是「换完之后底色是深是浅」，遮罩跟着走，才不会有黑白互相闪那一下 */
	function fadeTo(byNext: boolean, mid: () => void) {
		fadeEl.classList.toggle("is-light", byNext);
		fadeEl.classList.add("is-on");
		window.clearTimeout(fadeTimer);
		fadeTimer = window.setTimeout(() => {
			mid();
			// 换完场景让浏览器先落一帧，再撤遮罩，避免闪一下空白
			requestAnimationFrame(() => fadeEl.classList.remove("is-on"));
		}, FADE_MS);
	}

	/** 用 pushState（不是 replaceState）：这样浏览器后退键能在场景之间回退 */
	function setHash(name: SceneName) {
		const next = name === "hub" ? "" : `#${name}`;
		if (location.hash === next) return;
		history.pushState(null, "", next || location.pathname);
	}

	function onHash() {
		const raw = location.hash.replace("#", "");
		const next = (raw === "" ? "hub" : raw) as SceneName;
		if (next === scene) return;
		if (next === "hub") backToHub();
		else if (SCENES[next as PaintScene]) enterScene(next as PaintScene);
	}

	// -------------------------------------------------------------- 画布 A/B/C
	const paint = createPaint({
		canvas: paintCanvas,
		stage: paintStage,
		hint,
		paletteEl,
		symEl,
		countEl,
		glitchEl,
		audio,
		onFirstStroke: () => hint.classList.add("is-gone"),
	});

	// ------------------------------------------------------------------ 输入
	diceEl.addEventListener("click", () => {
		audio.resume();
		audio.tick();
		hub.spin();
	});
	backEl.addEventListener("click", backToHub);
	saveEl.addEventListener("click", () => paint.savePng());
	// 橡皮是开关：按下进入擦除，再按回到画笔。aria-pressed 让读屏也知道当前是哪个
	eraseEl.addEventListener("click", () => {
		const on = eraseEl.getAttribute("aria-pressed") !== "true";
		eraseEl.setAttribute("aria-pressed", String(on));
		eraseEl.classList.toggle("is-active", on);
		paint.setErase(on);
		audio.tick();
	});
	clearEl.addEventListener("click", () => paint.clear());
	soundEl.addEventListener("click", () => {
		const on = audio.toggle();
		soundEl.setAttribute("aria-pressed", String(on));
		soundEl.classList.toggle("is-off", !on);
	});
	window.addEventListener("hashchange", onHash);
	window.addEventListener("keydown", (e) => {
		// 快捷键只在对应画布激活时生效 —— fullBleed 页面首屏下面就是正文，
		// 全局抢 Space 会把翻页顶掉
		if (scene === "hub" || e.target instanceof HTMLInputElement) return;
		if (e.code === "Space") {
			e.preventDefault();
			paint.clear();
		} else if (e.code === "KeyZ") {
			e.preventDefault();
			paint.undo();
		} else if (e.code === "Escape") {
			backToHub();
		}
	});

	// 首屏就带 hash 的话直接进那个场景（分享 #d 这类链接时有用）
	const initial = location.hash.replace("#", "");
	if (initial && SCENES[initial as PaintScene]) {
		applyScene(initial as PaintScene);
		audio.setAmbient(false);
	} else {
		applyScene("hub");
	}

	return {
		destroy() {
			window.clearTimeout(settleTimer);
			hub.dispose();
			ambient.dispose();
			wall.dispose();
			paint.dispose();
			audio.dispose();
			window.removeEventListener("hashchange", onHash);
		},
	};
}

// ============================================================ 绘画场景（A/B/C）

type PaintDeps = {
	canvas: HTMLCanvasElement;
	stage: HTMLElement;
	hint: HTMLElement;
	paletteEl: HTMLElement;
	symEl: HTMLSelectElement;
	countEl: HTMLInputElement;
	glitchEl: HTMLInputElement;
	audio: Audio;
	onFirstStroke: () => void;
};

function createPaint(deps: PaintDeps) {
	const canvas = deps.canvas;
	const audio = deps.audio;
	// 函数声明会被提升，TS 不会把外层守卫的收窄结果带进它们的函数体（ts(18047)），
	// 所以在守卫**之后**另绑一个非空常量，下面所有闭包都用这一个。
	const ctxOrNull = canvas.getContext("2d");
	if (!ctxOrNull) throw new Error("丝缕四面体：拿不到 2d 上下文");
	const ctx: CanvasRenderingContext2D = ctxOrNull;

	// 三张画布共用**同一份**笔画历史，kind 只决定怎么画。
	// spec 的「只换渲染层」就是这个意思：在绢面画的一笔，切到格面就是同一笔的经纬。
	// （早先给每面各存一份，结果同一个动作在三面出三种画，那就不是换皮、是三个软件了。）
	const history: Stroke[] = [];
	let kind: PaintKind = "silk";
	/** 正在长的那一笔，和它那条链。抬手之后链还会自己走半秒，走完才落进 history */
	let live: Stroke | null = null;
	let pen: Pen | null = null;
	let raf = 0;
	let started = false;
	let erasing = false;
	let hue = randomHue();

	function glitch(): number {
		return Number(deps.glitchEl.value) / 100;
	}

	function resize() {
		const r = deps.stage.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.max(1, Math.round(r.width * dpr));
		canvas.height = Math.max(1, Math.round(r.height * dpr));
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// 重绘会把画布整个清掉 —— 正在长的那一笔会跟着没。先让它收笔落进历史。
		finish();
		redrawAll();
	}

	function center() {
		const r = canvas.getBoundingClientRect();
		return { cx: r.width / 2, cy: r.height / 2 };
	}

	function pos(e: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	/**
	 * 收笔：把正在长的这一笔落进历史。
	 *
	 * 两个入口 —— 抬手之后链自己走完寿命（正常），以及「画到一半被 resize / 清空 /
	 * 又落一笔打断」（防御）。两处都必须走它：不然那一笔既不在历史里、也没人再管它，
	 * 撤销会去拿上一笔，看着像没反应。
	 */
	function finish() {
		if (live && pen) {
			// `live.snaps` **就是** pen.snaps 那个数组（故意共享，见 begin）；
			// 这里不复制，直接把它交出去 —— pen 随即置空，没人再往里写。
			// 只点了一下、一帧都没活到的那种「一笔」没有任何墨（每张快照只有 1 个点、
			// 画不出线段），别占历史。
			if (live.snaps.some((s) => s.length >= 4)) history.push(live);
		}
		live = null;
		pen = null;
	}

	/**
	 * 一帧：跑 STEPS_PER_FRAME 个子步，**每个子步之后**把刚定形的那一张快照补到画布上。
	 *
	 * 为什么不是「跑完一帧再画一遍」：丝缕的通透感与那层细密的丝理来自同一片地方
	 * 被叠了几百遍、而每一遍只差约 1 像素。一帧只画一遍的话线是断的、还发灰；
	 * 画成「每粒子自己的轨迹」则会在按住不动时冻住（见 `Pen.snaps` 那段）。
	 */
	function step() {
		const p = pen;
		const s = live;
		if (!p || !s) {
			raf = 0;
			return;
		}
		// 场景被切走了就撒手。不判这一下的话，人已经走了笔还在一直生新粒子，
		// 这条 rAF 永远停不下来（pointerup 在隐藏的页面上不一定还会来）。
		if (deps.stage.hidden) p.held = false;

		const { cx, cy } = center();
		framePen(p, cx, cy, () => {
			paintStroke(ctx, s, cx, cy, {
				only: s.snaps.length - 1,
				kind,
				glitch: glitch(),
				// 抬手之后最新那颗粒子的寿命一路往下走 → 整条链跟着淡出
				fade: penFade(p),
			});
		});

		if (p.held) {
			// 笔尖这一帧跑了多远 —— 只喂给音效，让声音跟着手的快慢走
			const th = p.snaps[p.snaps.length - 1];
			const n = th ? th.length : 0;
			audio.paint(
				n >= 4
					? Math.hypot(th[n - 2] - th[n - 4], th[n - 1] - th[n - 3]) * 5
					: 0,
				hue,
			);
		}

		if (penAlive(p) > 0) raf = requestAnimationFrame(step);
		else {
			raf = 0;
			finish();
		}
	}

	function run() {
		if (!raf) raf = requestAnimationFrame(step);
	}

	function begin(e: PointerEvent) {
		audio.resume();
		const p = pos(e);
		// 上一笔还没走完（手快连点）就让它先收笔，别把两条链搅在一起
		finish();
		const fresh = createPen(p.x, p.y);
		pen = fresh;
		live = {
			// ⚠️ 这里**故意是同一个数组对象**：笔每子步 push 一张快照进 pen.snaps，
			// 而作画中要画的正是它（`only` 渲染）。收笔时 finish() 直接把它交给历史，
			// pen 随即置空，两边不再共享任何东西。
			// 给 `[]` 的话画面上会一片空白 —— 画的是空数组，谁也没往里面写。
			snaps: fresh.snaps,
			hue,
			alpha: erasing ? ERASE_ALPHA : STROKE_ALPHA,
			erase: erasing,
			mode: deps.symEl.value as SymmetryMode,
			count: Number(deps.countEl.value),
			// 逐份拷贝错开一点色相，同一个图形才有层次
			hueStep: 6,
		};
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// 指针捕获失败不影响作画
		}
		if (!started) {
			started = true;
			deps.onFirstStroke();
		}
		run();
	}

	// ⚠️ 指针事件**只负责告诉笔「笔尖现在在哪」**，它自己一个点都不画。
	// 画多快、往哪拐、停不停，全是那条链自己的事 —— 「长按会自己抖动作画」
	// 和「拖得快会甩出优雅的长弧」都出在这儿。
	function move(e: PointerEvent) {
		if (!pen?.held) return;
		const p = pos(e);
		aimPen(pen, p.x, p.y);
	}

	function end(e: PointerEvent) {
		// 不再生新粒子，但链上那些还活着，会自己把这一笔走完再交卷
		if (pen) pen.held = false;
		try {
			canvas.releasePointerCapture(e.pointerId);
		} catch {
			// 指针没了，忽略
		}
	}

	/** 撤销 = 清空 + 全量重绘剩下的笔画。跟作画共用同一批线段，画面才不会走样 */
	function redrawAll() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const { cx, cy } = center();
		for (const s of history)
			paintStroke(ctx, s, cx, cy, { kind, glitch: glitch() });
	}

	function clear() {
		finish();
		history.length = 0;
		// 已经排出去的那一帧先撤掉：不然它可能已经拿到了「刚被丢掉的那一笔」
		cancelAnimationFrame(raf);
		raf = 0;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		audio.tick();
	}

	function undo() {
		// 正在长的那一笔先落地，否则撤销会去拿上一笔，看着像没反应
		finish();
		if (!history.length) return;
		history.pop();
		redrawAll();
		audio.tick();
	}

	function savePng() {
		// 画布本身是透明的（底色来自 CSS），导出前必须先把底色铺上，否则 PNG 全是透明
		const out = document.createElement("canvas");
		out.width = canvas.width;
		out.height = canvas.height;
		const c = out.getContext("2d");
		if (!c) return;
		c.fillStyle = deps.stage.parentElement?.classList.contains("is-light")
			? "#ffffff"
			: "#0a0a12";
		c.fillRect(0, 0, out.width, out.height);
		c.drawImage(canvas, 0, 0);
		const a = document.createElement("a");
		a.download = `silk-${kind}-${Date.now()}.png`;
		a.href = out.toDataURL("image/png");
		a.click();
		audio.tick();
	}

	// ------------------------------------------------------------ 控件
	// 对称模式下拉与份数滑块的取值范围都从 silk-symmetry 里取，别在这儿抄一遍常量
	for (const mode of SYMMETRY_ORDER) {
		const opt = document.createElement("option");
		opt.value = mode;
		opt.textContent = SYMMETRY_LABEL[mode];
		deps.symEl.appendChild(opt);
	}
	deps.symEl.value = "mirror";
	deps.countEl.min = String(MIN_SYMMETRY_COUNT);
	deps.countEl.max = String(MAX_SYMMETRY_COUNT);
	deps.countEl.value = String(DEFAULT_SYMMETRY_COUNT);

	// 调色盘：六个色块均分一圈色相，起点随机一点，免得每次刷新都一样
	const SWATCHES = 6;
	const swatchEls: HTMLButtonElement[] = [];
	const swatchHues: number[] = [];
	const base = randomHue();
	for (let i = 0; i < SWATCHES; i++) {
		swatchHues.push((base + (i * 360) / SWATCHES) % 360);
		const b = document.createElement("button");
		b.type = "button";
		b.className = "silk-swatch";
		b.style.setProperty("--h", String(swatchHues[i]));
		b.setAttribute("aria-label", `选择第 ${i + 1} 种颜色`);
		b.addEventListener("click", () => {
			hue = swatchHues[i];
			markActive(i);
			audio.tick();
		});
		swatchEls.push(b);
		deps.paletteEl.appendChild(b);
	}
	function markActive(i: number) {
		swatchEls.forEach((el, k) => {
			el.classList.toggle("is-active", k === i);
		});
	}
	markActive(0);
	hue = swatchHues[0];

	// 拖拽混色：把一个色块拖到另一个上，两者色相取圆周平均
	let dragFrom = -1;
	deps.paletteEl.addEventListener("pointerdown", (e) => {
		const el = (e.target as HTMLElement).closest<HTMLElement>(".silk-swatch");
		if (!el) return;
		dragFrom = swatchEls.indexOf(el as HTMLButtonElement);
		try {
			deps.paletteEl.setPointerCapture(e.pointerId);
		} catch {
			// 捕获失败不影响后续判定
		}
		el.classList.add("is-drag");
	});
	deps.paletteEl.addEventListener("pointerup", (e) => {
		if (dragFrom < 0) return;
		swatchEls[dragFrom]?.classList.remove("is-drag");
		const over = document
			.elementFromPoint(e.clientX, e.clientY)
			?.closest<HTMLElement>(".silk-swatch");
		const to = over ? swatchEls.indexOf(over as HTMLButtonElement) : -1;
		if (to >= 0 && to !== dragFrom) {
			swatchHues[to] = mixHue(swatchHues[dragFrom], swatchHues[to]);
			swatchEls[to].style.setProperty("--h", String(swatchHues[to]));
			swatchEls[to].classList.add("is-mixed");
			window.setTimeout(() => swatchEls[to].classList.remove("is-mixed"), 420);
			hue = swatchHues[to];
			markActive(to);
			audio.tick();
		}
		dragFrom = -1;
	});

	canvas.addEventListener("pointerdown", begin);
	canvas.addEventListener("pointermove", move);
	canvas.addEventListener("pointerup", end);
	canvas.addEventListener("pointercancel", end);

	const ro = new ResizeObserver(() => resize());
	ro.observe(deps.stage);
	resize();

	return {
		get kind(): PaintKind {
			return kind;
		},
		set kind(k: PaintKind) {
			kind = k;
			redrawAll();
		},
		/** 橡皮开关。换场景不清除 —— 三张画布共用同一个引擎，工具状态跟着走才连贯 */
		setErase(on: boolean) {
			erasing = on;
		},
		resize,
		clear,
		undo,
		savePng,
		dispose() {
			// ⚠️ 一定要真的 cancel：留着的话人已经走了它还在 60fps 空转
			cancelAnimationFrame(raf);
			raf = 0;
			ro.disconnect();
			canvas.removeEventListener("pointerdown", begin);
			canvas.removeEventListener("pointermove", move);
			canvas.removeEventListener("pointerup", end);
			canvas.removeEventListener("pointercancel", end);
		},
	};
}

/** 色相的圆周平均：两色混合要绕着色环走，直接取算术平均会在 0/360 交界处翻车 */
function mixHue(a: number, b: number): number {
	const ra = (a * Math.PI) / 180;
	const rb = (b * Math.PI) / 180;
	const x = Math.cos(ra) + Math.cos(rb);
	const y = Math.sin(ra) + Math.sin(rb);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ============================================================ 枢纽底纹

/**
 * 枢纽背景那层流动的 Silk 丝纹。
 *
 * 它跟 A 面是**同一套引擎**（同一份对称变换与平滑几何），只是「笔」自己会走：
 * 几条低频正弦叠起来当笔迹，画一段就用 destination-out 轻轻擦淡一点，
 * 于是丝纹永远在流动、又永远不会糊成一片。透明度压得很低，不许抢四面体。
 */
function createAmbient(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext("2d");
	let raf = 0;
	let running = false;
	let stroke: Stroke | null = null;
	let phase = 0;
	let drawn = 0;
	let w = 0;
	let h = 0;

	function resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		w = canvas.clientWidth || 1;
		h = canvas.clientHeight || 1;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx?.clearRect(0, 0, w, h);
		stroke = null;
	}

	function step() {
		if (!running || !ctx) return;
		raf = requestAnimationFrame(step);
		phase += 0.012;

		// 一笔画够长就换一笔（换色相），从外圈起笔往中心绕
		if (!stroke || drawn > 150) {
			stroke = {
				// 底纹不走那条「笔」的链 —— 它的笔迹是几条低频正弦叠出来的。
				// 用「每帧一张**两点**快照」表达：一张快照就是一段，
				// 正好对上原来「只有一个点在增长、只画最后一段」的语义。
				snaps: [],
				hue: randomHue(),
				alpha: 0.04,
				mode: "mirror",
				count: 5,
				hueStep: 12,
				width: 34,
			};
			drawn = 0;
		}

		const t = phase;
		const r = w * (0.16 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.23)));
		const ang = t * 0.42;
		const nx =
			w / 2 +
			Math.cos(ang) * r +
			Math.sin(t * 0.61) * w * 0.06 +
			Math.cos(t * 0.31) * w * 0.03;
		const ny =
			h / 2 + Math.sin(ang * 0.9) * r * 0.62 + Math.cos(t * 0.53) * h * 0.07;
		const prev = stroke.snaps[stroke.snaps.length - 1];
		stroke.snaps.push([prev ? prev[2] : nx, prev ? prev[3] : ny, nx, ny]);
		// 线宽慢慢呼吸，帷幕才不像一根橡皮筋
		stroke.width = 30 + Math.sin(t * 0.4) * 10;
		drawn++;
		paintStroke(ctx, stroke, w / 2, h / 2, {
			only: stroke.snaps.length - 1,
		});

		// 慢慢擦淡：加色画布只能靠 destination-out 减 alpha 才能"退"回去
		if (drawn % 6 === 0) {
			ctx.globalCompositeOperation = "destination-out";
			ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
			ctx.fillRect(0, 0, w, h);
			ctx.globalCompositeOperation = "source-over";
		}
	}

	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	return {
		setRunning(on: boolean) {
			if (on === running) return;
			running = on;
			cancelAnimationFrame(raf);
			if (on) raf = requestAnimationFrame(step);
		},
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
		},
	};
}

// ============================================================ 音效（WebAudio 合成）

export type Audio = ReturnType<typeof createAudio>;

function createAudio() {
	let ctx: AudioContext | null = null;
	let master: GainNode | null = null;
	let enabled = true;
	let ambientGain: GainNode | null = null;
	let ambientNodes: OscillatorNode[] = [];
	let lastPaint = 0;

	/** AudioContext 必须在用户手势之后才能出声，所有入口都先调它 */
	function ensure(): boolean {
		if (typeof AudioContext === "undefined") return false;
		if (!ctx) {
			ctx = new AudioContext();
			master = ctx.createGain();
			master.gain.value = 0.45;
			master.connect(ctx.destination);
		}
		if (ctx.state === "suspended") void ctx.resume();
		return true;
	}

	function blip(freq: number, dur: number, gain: number) {
		const now = ctx?.currentTime ?? 0;
		if (!enabled || !ensure() || !ctx || !master) return;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = "sine";
		o.frequency.value = freq;
		g.gain.setValueAtTime(0, now);
		g.gain.linearRampToValueAtTime(gain, now + 0.012);
		g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
		o.connect(g).connect(master);
		o.start(now);
		o.stop(now + dur + 0.02);
	}

	function noise(dur: number, from: number, to: number, gain: number) {
		if (!enabled || !ensure() || !ctx || !master) return;
		const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buf = ctx.createBuffer(1, n, ctx.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.Q.value = 1.1;
		f.frequency.setValueAtTime(from, ctx.currentTime);
		f.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
		const g = ctx.createGain();
		g.gain.value = gain;
		src.connect(f).connect(g).connect(master);
		src.start();
	}

	return {
		resume() {
			ensure();
		},
		toggle(): boolean {
			enabled = !enabled;
			if (master) master.gain.value = enabled ? 0.45 : 0;
			if (!enabled) return false;
			ensure();
			blip(660, 0.12, 0.16);
			return true;
		},
		/** 绘画：笔速越快音越高、色相也参与调音；限流到 60ms 一声，免得糊成噪声 */
		paint(speed: number, hue: number) {
			const now = performance.now();
			if (now - lastPaint < 60) return;
			lastPaint = now;
			blip(150 + (hue / 360) * 260 + Math.min(120, speed * 3.2), 0.11, 0.075);
		},
		tick() {
			blip(880, 0.09, 0.1);
		},
		/** 骰子停稳：按面号给一个上行的小三度，四面各有各的音 */
		bell(idx: number) {
			const base = 392 * 2 ** (idx / 12);
			blip(base, 0.5, 0.14);
			window.setTimeout(() => blip(base * 1.5, 0.42, 0.09), 70);
		},
		whoosh() {
			noise(0.5, 320, 2200, 0.1);
		},
		/** 枢纽环境音：两个低频正弦，音量慢慢抬起来；离开枢纽就停 */
		setAmbient(on: boolean) {
			if (!on) {
				for (const o of ambientNodes) {
					try {
						o.stop();
					} catch {
						// 已经停了
					}
				}
				ambientNodes = [];
				ambientGain = null;
				return;
			}
			if (ambientNodes.length || !ensure() || !ctx || !master) return;
			ambientGain = ctx.createGain();
			ambientGain.gain.value = 0;
			ambientGain.connect(master);
			for (const f of [55, 82.4]) {
				const o = ctx.createOscillator();
				o.type = "sine";
				o.frequency.value = f;
				o.connect(ambientGain);
				o.start();
				ambientNodes.push(o);
			}
			ambientGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2.5);
		},
		dispose() {
			for (const o of ambientNodes) {
				try {
					o.stop();
				} catch {
					// 已经停了
				}
			}
			ambientNodes = [];
			void ctx?.close();
		},
	};
}
