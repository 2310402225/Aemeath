// D 面 · 归境：鸣潮壁纸 → 一大团可扰动的光粒。
//
// 核心是「采样 → 模拟 → 弹簧归位」三段，几个关键决定：
//
// 1. **粒子直接从图里采出来**，不是贴图 + 遮罩。逐像素算亮度，按亮度分档给粒子，
//    颜色也照抄该像素 —— 所以它开场就是那张壁纸，被打散之后还能自己长回去。
// 2. **阈值全部走分位数**（亮度地板 / 梯度轮廓线），没有一个手调的绝对值。
//    换成别的图（哪怕整体偏暗或偏亮）照样成立，不用回来改数字。
// 3. **模拟放 CPU，不放 GPU。** 真正要「惯性 + 弹性回位」就必须有 position/velocity
//    两个状态，无状态的顶点着色器做不了（能用位移函数凑，但那就不是弹簧了）。
//    四万颗的定长数组循环每帧 1~3ms，比写一套 ping-pong FBO 便宜得多。
// 4. **弹簧一直开着**，交互只负责加力。于是「按住时被顶开、松手弹回原位」是同一套
//    动力学自然给出来的，不需要写第二套「归位」逻辑，也就不可能归错位。
// 5. 轮廓 / 亮部 / 暗部三档弹簧参数不同：轮廓收得快而脆，暗部又慢又黏 —— spec 里
//    「轮廓更快、背景装饰粒子更慢、带惯性」就是这三个数组。

import * as THREE from "three";

/**
 * 壁纸路径。换图只改这一行。
 *
 * ⚠️ 必须是**站内**文件：下面要用 getImageData 逐像素读，跨域图会把画布污染掉、
 * 直接抛 SecurityError（加了 crossOrigin 还得对方服务器肯发 CORS 头才行）。
 */
const WALL_SRC = `${import.meta.env.BASE_URL}assets/images/silk/wallpaper.webp`;

/** 采样宽度。素材就是 960 宽，再往上加只是白吃解码内存，粒子不会变多（预算是固定的） */
const SAMPLE_W = 960;
/**
 * 粒子预算：鼠标给足，触摸设备砍掉（小屏粒子大会糊成一团）。
 *
 * ⚠️ 这个数字是**画面清晰度的唯一杠杆**，加采样分辨率没用：
 *   有效分辨率 ≈ 采样宽 × √(粒子数 / 入选像素数)，与源图分辨率无关 ——
 *   把 SAMPLE_W 从 960 提到 1920、预算不动，点间距按 1/√ 走，两边刚好抵消。
 *   想更清只有加粒子。代价是每帧一趟 O(n) 的弹簧积分，76k 实测还留得住帧率。
 */
const BUDGET_FINE = 76000;
const BUDGET_COARSE = 26000;
/** 亮度地板取到分位数 45%，即只有最亮的 55% 像素有资格当粒子。
 *  再往下调一点能多收一层暗部结构（壁纸的暗蓝布料），但入选像素一多，
 *  同样的预算被摊薄、亮部反而变稀 —— 0.55 是两边都还看得过去的值 */
const DENSITY = 0.55;
/** 梯度最高的 6% 算轮廓；轮廓最多吃掉这么多预算 */
const EDGE_TOP = 0.06;
const EDGE_SHARE = 0.34;

/** 三档弹簧：轮廓 / 亮部 / 暗部。k 越大收得越快，d 越小越弹、余震越长 */
const K = [46, 30, 15];
const DAMP = [6.4, 5.4, 3.2];

/**
 * 点尺寸（世界单位；1 单位 = 图高）。
 *
 * ⚠️ 不能小。片元着色器用 gl_PointCoord 的软圆盘衰减，直径只有 2~3 设备像素时
 * 整个点落在圆盘外圈 —— 四个角被切掉、中心那点峰值也没了，屏幕上就是一片压不亮的
 * 灰雾（这也是「看不清」最隐蔽的一个成因：不是粒子不够，是每个粒子都没亮起来）。
 * 直径要 ≥4 设备像素，软圆盘才真正是个圆盘。
 */
const SIZE_MIN = 0.0058;
const SIZE_SPAN = 0.0056;
/** 轮廓点再大一号，线条才立得起来 */
const SIZE_EDGE = 0.0018;

/** gl_PointSize 的钳制区间，单位是 **CSS 像素**（measure 里乘 dpr 再传进去） */
const PIX_MIN = 1;
const PIX_MAX = 7;

/**
 * 提亮倍数。壁纸是暗调的（中位亮度 0.19），直接把像素颜色加色叠上去，
 * 一半以上的粒子贡献不到 0.05 —— 静置的画面几乎全黑，正是「看不清」的主因。
 *
 * 取法：把入选像素的**中位亮度**拉到 EXPOSURE。这样换一张整体偏亮或偏暗的图
 * 都不用回来改数字，跟本文件里「阈值一律走分位数」是同一套思路。
 */
const EXPOSURE = 0.95;

/** 悬停排斥 / 拖拽尾迹 / 冲击波 / 长按塌散 */
const HOVER_R = 0.11;
const HOVER_F = 6.2;
const DRAG_R = 0.14;
const DRAG_LIT = 7.5;
const SHOCK_R = 0.055;
const SHOCK_SPEED = 2.4;
const SHOCK_F = 15;
const SHOCK_LIFE = 1.15;
const SHATTER_F = 3.2;
/** 亮起来之后的衰减速度：慢一点才有「尾迹」的样子 */
const LIT_DECAY = 2.2;
const MAX_RINGS = 3;
/** 按住不动多久算长按 */
const HOLD_MS = 450;
/** 判定「动了」的位移（世界单位） */
const MOVE_EPS = 0.022;

export type Wall = {
	setRunning: (on: boolean) => void;
	resize: () => void;
	dispose: () => void;
};

const TAU = Math.PI * 2;

export function createWall(canvas: HTMLCanvasElement): Wall {
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.OrthographicCamera | null = null;
	let points: THREE.Points | null = null;
	let geo: THREE.BufferGeometry | null = null;
	let mat: THREE.ShaderMaterial | null = null;

	/** 粒子数据。count 是实际粒子数，其余数组都按它分配 */
	let count = 0;
	let pos = new Float32Array(0); // 3N，模拟直接写进去，省一次逐帧拷贝
	let vel = new Float32Array(0); // 2N
	let orig = new Float32Array(0); // 2N
	let esc = new Float32Array(0); // 2N，塌散时各自的逃逸方向
	let lit = new Float32Array(0); // N，被划亮的程度
	let seed = new Float32Array(0); // N
	let tier = new Uint8Array(0); // N
	/** 采样之前先用素材本身的比例，免得首帧按 1:1 算错相机（build 末尾会改成实测值） */
	let imgAspect = 2.38;

	let raf = 0;
	let running = false;
	let ready = false;
	let starting = false;
	let time = 0;
	let last = 0;

	/** 相机半高（世界单位）：整图按宽度装进来，纵向留 4% 边；竖屏则封顶，改成裁切 */
	let hh = 0.7;
	let viewAspect = 1;

	// 指针状态
	let pointerIn = false;
	let px = 0;
	let py = 0;
	let down = false;
	let downT = 0;
	let moved = false;
	let downX = 0;
	let downY = 0;
	let shatter = 0;
	let shatterTarget = 0;

	const rings = Array.from({ length: MAX_RINGS }, () => ({
		x: 0,
		y: 0,
		r: 0,
		life: 0,
	}));
	let ringCursor = 0;

	// ------------------------------------------------------------------ 采样

	/**
	 * 把图片采成粒子。返回 false 表示采样失败（图没了 / 跨域被污染）。
	 *
	 * 分两池取：轮廓像素全留（它们本来就不多，而且「轮廓」的意义就是连通性，
	 * 抽稀会让线条断开），剩下的预算按均匀随机从亮部池里抽 —— 均匀随机采样
	 * 天然保持原图的疏密结构，所以画面不会被抽花。
	 */
	function build(img: HTMLImageElement, budget: number): boolean {
		const w = Math.min(SAMPLE_W, img.naturalWidth || SAMPLE_W);
		const h = Math.max(
			1,
			Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)),
		);
		const off = document.createElement("canvas");
		off.width = w;
		off.height = h;
		const octx = off.getContext("2d", { willReadFrequently: true });
		if (!octx) return false;
		octx.drawImage(img, 0, 0, w, h);
		let data: Uint8ClampedArray;
		try {
			data = octx.getImageData(0, 0, w, h).data;
		} catch {
			console.error(
				`丝缕四面体 D 面：读不到 ${WALL_SRC} 的像素。逐像素采样要求图片同源，` +
					"放进 public/assets/images/silk/ 里，别用外链。",
			);
			return false;
		}

		const n = w * h;
		const lum = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const o = i * 4;
			lum[i] =
				(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) / 255;
		}
		const floor = quantile(lum, 1 - DENSITY);

		// 梯度：中心差分，边缘亮的地方就是轮廓
		const grad = new Float32Array(n);
		for (let y = 1; y < h - 1; y++) {
			const row = y * w;
			for (let x = 1; x < w - 1; x++) {
				const i = row + x;
				grad[i] =
					Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
			}
		}
		const gedge = quantile(grad, 1 - EDGE_TOP);

		const oIdx = new Int32Array(n);
		const bIdx = new Int32Array(n);
		let no = 0;
		let nb = 0;
		for (let i = 0; i < n; i++) {
			if (lum[i] < floor) continue;
			if (grad[i] >= gedge) oIdx[no++] = i;
			else bIdx[nb++] = i;
		}
		if (no + nb < 64) {
			console.error("丝缕四面体 D 面：这张图几乎全黑，采不出粒子。");
			return false;
		}

		const rnd = mulberry32(0x9e3f17);
		const outlineMax = Math.floor(budget * EDGE_SHARE);
		const outlineTake = Math.min(no, outlineMax);
		const oPick = pickPositions(no, outlineTake, rnd);
		const bPick = pickPositions(nb, Math.min(nb, budget - outlineTake), rnd);

		count = oPick.length + bPick.length;
		pos = new Float32Array(count * 3);
		vel = new Float32Array(count * 2);
		orig = new Float32Array(count * 2);
		esc = new Float32Array(count * 2);
		lit = new Float32Array(count);
		seed = new Float32Array(count);
		tier = new Uint8Array(count);
		const color = new Float32Array(count * 3);
		const size = new Float32Array(count);
		const tierAttr = new Float32Array(count);

		imgAspect = w / h;
		// 图在「世界单位」里就是 imgAspect × 1，原点在正中
		const toWorldX = (v: number) => (v - 0.5) * imgAspect;
		const toWorldY = (v: number) => (0.5 - v) * 1;

		// 先算亮部池的亮度中位数，用来把「亮部」和「暗部」分开
		const bodyLum = new Float32Array(bPick.length);
		for (let k = 0; k < bPick.length; k++) bodyLum[k] = lum[bIdx[bPick[k]]];
		bodyLum.sort();
		const median = bodyLum[bodyLum.length >> 1] ?? 0;

		let idx = 0;
		const fill = (i: number, isOutline: boolean, isBody: boolean) => {
			const cx = i % w;
			const cy = (i / w) | 0;
			// 格子内随机抖动：不打抖的话屏幕上是整齐的网格，一眼假
			const u = (cx + rnd()) / w;
			const v = (cy + rnd()) / h;
			const wx = toWorldX(u);
			const wy = toWorldY(v);
			const o = idx * 3;
			pos[o] = wx;
			pos[o + 1] = wy;
			pos[o + 2] = 0;
			orig[idx * 2] = wx;
			orig[idx * 2 + 1] = wy;
			// 逃逸方向 = 随机方向 + 一点「离中心越远越往外」的偏置，塌散才像炸开而不是膨胀
			const ang = rnd() * TAU;
			const bx = Math.cos(ang) * 0.7 + (wx / (imgAspect * 0.5)) * 0.6;
			const by = Math.sin(ang) * 0.7 + (wy / 0.5) * 0.6;
			const bl = Math.hypot(bx, by) || 1;
			esc[idx * 2] = bx / bl;
			esc[idx * 2 + 1] = by / bl;

			const L = lum[i];
			const p = i * 4;
			color[o] = data[p] / 255;
			color[o + 1] = data[p + 1] / 255;
			color[o + 2] = data[p + 2] / 255;
			seed[idx] = rnd();
			tier[idx] = isOutline ? 0 : isBody && L >= median ? 1 : 2;
			tierAttr[idx] = tier[idx];
			// 轮廓给大一号，线条才立得起来
			size[idx] = SIZE_MIN + SIZE_SPAN * L + (isOutline ? SIZE_EDGE : 0);
			idx++;
		};
		for (let k = 0; k < oPick.length; k++) fill(oIdx[oPick[k]], true, false);
		for (let k = 0; k < bPick.length; k++) {
			const i = bIdx[bPick[k]];
			fill(i, false, true);
		}

		geo = new THREE.BufferGeometry();
		const posAttr = new THREE.BufferAttribute(pos, 3);
		posAttr.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute("position", posAttr);
		geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
		geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
		geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
		geo.setAttribute("aTier", new THREE.BufferAttribute(tierAttr, 1));
		const litAttr = new THREE.BufferAttribute(lit, 1);
		litAttr.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute("aLit", litAttr);

		mat = new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uPointScale: { value: 400 },
				// 自动曝光：把入选像素的中位亮度提到 EXPOSURE。median 为 0（几乎全黑）时兜底
				uGain: { value: EXPOSURE / Math.max(0.06, median) },
				uPixMin: { value: PIX_MIN },
				uPixMax: { value: PIX_MAX },
			},
			vertexShader: VERT,
			fragmentShader: FRAG,
			transparent: true,
			depthTest: false,
			depthWrite: false,
			// 加色叠加：预乘输出 + blendFunc(ONE, ONE)（同枢纽，换成 (SRC_ALPHA, ONE) 会暗一档）
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneFactor,
		});

		points = new THREE.Points(geo, mat);
		points.frustumCulled = false;
		scene?.add(points);
		ready = true;
		measure();
		return true;
	}

	// ------------------------------------------------------------------ 视口

	/** 相机半高。整图按宽装进来（纵向留 4% 边）；竖屏把「装宽」封顶，变成居中裁切 */
	function framing(aspect: number): number {
		return Math.min(0.95, Math.max(0.53, (imgAspect * 0.52) / aspect));
	}

	function measure() {
		if (!canvas) return;
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		viewAspect = w / h;
		hh = framing(viewAspect);
		if (camera) {
			camera.left = -hh * viewAspect;
			camera.right = hh * viewAspect;
			camera.top = hh;
			camera.bottom = -hh;
			camera.updateProjectionMatrix();
		}
		if (renderer) {
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			renderer.setSize(w, h, false);
		}
		// 世界单位 → 设备像素。点尺寸全靠它，漏了这步粒子会小到看不见
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		if (mat) {
			mat.uniforms.uPointScale.value = (h * dpr) / (2 * hh);
			// ⚠️ 钳制值也得乘 dpr。写死「1~9」的话那是**设备**像素：dpr=2 的屏上
			// 点的 CSS 直径只有 dpr=1 的一半，同一份参数在视网膜屏上明显更稀更暗，
			// 而 dpr=1 时上限根本碰不到 —— 这个不一致极难在开发机上发现。
			mat.uniforms.uPixMin.value = PIX_MIN * dpr;
			mat.uniforms.uPixMax.value = PIX_MAX * dpr;
		}
		if (ready) renderFrame();
	}

	function renderFrame() {
		if (!renderer || !scene || !camera || !points) return;
		if (geo) {
			(geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
				true;
			(geo.getAttribute("aLit") as THREE.BufferAttribute).needsUpdate = true;
		}
		renderer.render(scene, camera);
	}

	// ------------------------------------------------------------------ 输入

	function toWorld(clientX: number, clientY: number) {
		const r = canvas.getBoundingClientRect();
		px = ((clientX - r.left) / r.width - 0.5) * 2 * hh * viewAspect;
		py = -((clientY - r.top) / r.height - 0.5) * 2 * hh;
	}

	function onDown(e: PointerEvent) {
		if (!running) return;
		toWorld(e.clientX, e.clientY);
		pointerIn = true;
		down = true;
		moved = false;
		downT = performance.now();
		downX = px;
		downY = py;
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// 捕获失败不影响后续
		}
	}

	function onMove(e: PointerEvent) {
		if (!running) return;
		toWorld(e.clientX, e.clientY);
		pointerIn = true;
		if (down && !moved && Math.hypot(px - downX, py - downY) > MOVE_EPS)
			moved = true;
	}

	function onUp(e: PointerEvent) {
		if (!running) return;
		try {
			canvas.releasePointerCapture(e.pointerId);
		} catch {
			// 指针没了，忽略
		}
		// 时间短、又没挪动过 → 是「点一下」，放一圈冲击波
		if (down && !moved && performance.now() - downT < HOLD_MS) {
			const r = rings[ringCursor];
			ringCursor = (ringCursor + 1) % MAX_RINGS;
			r.x = px;
			r.y = py;
			r.r = 0;
			r.life = SHOCK_LIFE;
		}
		down = false;
		moved = false;
		shatterTarget = 0;
		// 触摸抬起之后没有 hover 可言，让力场退掉，粒子才会自己收回去
		if (e.pointerType !== "mouse") pointerIn = false;
	}

	function onLeave() {
		pointerIn = false;
		down = false;
		moved = false;
		shatterTarget = 0;
	}

	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointermove", onMove);
	canvas.addEventListener("pointerup", onUp);
	canvas.addEventListener("pointercancel", onUp);
	canvas.addEventListener("pointerleave", onLeave);

	const ro = new ResizeObserver(() => measure());
	ro.observe(canvas);

	// ------------------------------------------------------------------ 每帧

	function step(dt: number) {
		// 长按蓄力：按住不动超过 HOLD_MS 才开始塌散，松手立刻泄掉
		if (down && !moved && performance.now() - downT > HOLD_MS)
			shatterTarget = 1;
		shatter +=
			(shatterTarget - shatter) *
			Math.min(1, dt * (shatterTarget > shatter ? 5 : 9));

		let ringOn = false;
		for (const r of rings) {
			if (r.life <= 0) continue;
			r.r += SHOCK_SPEED * dt;
			r.life -= dt;
			ringOn = r.life > 0;
		}

		const hoverOn = pointerIn;
		const hoverR = down && moved ? DRAG_R : HOVER_R;
		const hoverR2 = hoverR * hoverR;
		const hoverF = HOVER_F * (down && moved ? 1.5 : 1);
		const litDecay = Math.exp(-LIT_DECAY * dt);
		const shatterOn = shatter > 0.004;
		// 塌散力随蓄力叠加，最后是「越按越炸」而不是匀速膨胀
		const shatterF = SHATTER_F * (1 + 3 * shatter) * shatter;

		for (let i = 0; i < count; i++) {
			const i2 = i * 2;
			const i3 = i * 3;
			const x = pos[i3];
			const y = pos[i3 + 1];
			const ox = orig[i2];
			const oy = orig[i2 + 1];
			let fx = 0;
			let fy = 0;

			// —— 悬停排斥（带一点切向，才像涟漪而不是单纯被顶开）
			if (hoverOn) {
				const dx = x - px;
				const dy = y - py;
				const d2 = dx * dx + dy * dy;
				if (d2 < hoverR2) {
					const d = Math.sqrt(d2) || 0.0001;
					const f = 1 - d / hoverR;
					const g = f * f * hoverF;
					const ux = dx / d;
					const uy = dy / d;
					// 切向分量的正负按粒子自己的种子定 → 相邻粒子朝反方向让开，才读得出「波纹」
					const sw = seed[i] > 0.5 ? 1 : -1;
					fx += ux * g - uy * g * 0.45 * sw;
					fy += uy * g + ux * g * 0.45 * sw;
					// 拖拽时顺手把路过的粒子划亮 —— 路径在动，尾迹就自己拖出来了
					if (down && moved) lit[i] += f * f * DRAG_LIT * dt;
				}
			}

			// —— 冲击波：一圈正在外扩的窄环，环上的粒子被推出去并点亮
			if (ringOn) {
				// 这里用带下标的循环而不是 for...of：一个环活着的时候这段每帧要跑几万遍，
				// 迭代器对象会被分配几万次，GC 一抖画面就顿
				for (let k = 0; k < MAX_RINGS; k++) {
					const r = rings[k];
					if (r.life <= 0) continue;
					const dx = x - r.x;
					const dy = y - r.y;
					const d = Math.hypot(dx, dy) || 0.0001;
					const band = (d - r.r) / SHOCK_R;
					if (band < -1 || band > 1) continue;
					const w = 1 - Math.abs(band);
					const fade = Math.min(1, r.life / (SHOCK_LIFE * 0.55));
					const g = w * w * SHOCK_F * fade;
					fx += (dx / d) * g;
					fy += (dy / d) * g;
					lit[i] += w * w * fade * dt * 26;
				}
			}

			// —— 长按塌散：沿各自逃逸方向往外走，越按越远
			if (shatterOn) {
				const wob = 1 + 0.5 * Math.sin(seed[i] * TAU - time * 2.2);
				const g = shatterF * wob;
				fx += esc[i2] * g;
				fy += esc[i2 + 1] * g;
				lit[i] += shatter * 0.9 * dt;
			}

			// —— 弹簧：这一项永远在，所以「被打散」和「弹回原位」是同一套动力学
			const t = tier[i];
			fx += (ox - x) * K[t] - vel[i2] * DAMP[t];
			fy += (oy - y) * K[t] - vel[i2 + 1] * DAMP[t];

			let vx = vel[i2] + fx * dt;
			let vy = vel[i2 + 1] + fy * dt;
			// 限速：塌散那一档的力很大，不限的话数值会炸
			if (vx > 7) vx = 7;
			else if (vx < -7) vx = -7;
			if (vy > 7) vy = 7;
			else if (vy < -7) vy = -7;
			vel[i2] = vx;
			vel[i2 + 1] = vy;
			pos[i3] = x + vx * dt;
			pos[i3 + 1] = y + vy * dt;
			lit[i] *= litDecay;
		}
	}

	function frame(now: number) {
		raf = requestAnimationFrame(frame);
		const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
		last = now;
		time += dt;
		step(dt);
		if (mat) mat.uniforms.uTime.value = time;
		renderFrame();
	}

	// ------------------------------------------------------------------ 装配

	function init() {
		starting = true;
		try {
			renderer = new THREE.WebGLRenderer({
				canvas,
				alpha: true,
				premultipliedAlpha: true,
				antialias: false,
				powerPreference: "high-performance",
			});
		} catch {
			console.error("丝缕四面体 D 面：WebGL 起不来。");
			starting = false;
			return;
		}
		renderer.setClearAlpha(0);
		scene = new THREE.Scene();
		camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
		camera.position.z = 1;

		const img = new Image();
		img.decoding = "async";
		img.onload = () => {
			starting = false;
			const budget = matchMedia("(pointer: coarse)").matches
				? BUDGET_COARSE
				: BUDGET_FINE;
			if (!build(img, budget)) measure();
			if (running) startLoop();
		};
		img.onerror = () => {
			starting = false;
			console.error(`丝缕四面体 D 面：加载不到 ${WALL_SRC}。`);
		};
		img.src = WALL_SRC;
		measure();
	}

	function startLoop() {
		if (raf || !ready) return;
		last = 0;
		raf = requestAnimationFrame(frame);
	}

	/** 全部拍回原位、速度清零。离开 D 面时做一次，回来时是干净的一张图 */
	function settle() {
		for (let i = 0; i < count; i++) {
			pos[i * 3] = orig[i * 2];
			pos[i * 3 + 1] = orig[i * 2 + 1];
			vel[i * 2] = 0;
			vel[i * 2 + 1] = 0;
			lit[i] = 0;
		}
		shatter = 0;
		shatterTarget = 0;
		for (const r of rings) r.life = 0;
	}

	return {
		setRunning(on: boolean) {
			if (on === running) return;
			running = on;
			if (!on) {
				cancelAnimationFrame(raf);
				raf = 0;
				settle();
				renderFrame();
				return;
			}
			if (ready) startLoop();
			else if (!starting) init();
		},
		resize: measure,
		dispose() {
			cancelAnimationFrame(raf);
			raf = 0;
			ro.disconnect();
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
			canvas.removeEventListener("pointerleave", onLeave);
			geo?.dispose();
			mat?.dispose();
			renderer?.dispose();
			points = null;
			scene = null;
			camera = null;
			renderer = null;
			ready = false;
		},
	};
}

// ============================================================ 着色器

const VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aTier;
attribute float aLit;
uniform float uTime;
uniform float uPointScale;
uniform float uGain;
uniform float uPixMin;
uniform float uPixMax;
varying vec3 vColor;
varying float vAlpha;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // 只有明暗呼吸，不动位置 —— 「终将回到自己的位置」得是字面意义上的真话。
  // 幅度压到 0.12：0.22 的全场闪烁会把丝缕的边缘搅成噪点，读起来更"不清晰"
  float shimmer = 0.88 + 0.12 * sin(uTime * 1.7 + aSeed * 6.2831853);
  // 上限 1.5：冲击波和长按会把 aLit 叠到 1 以上，不封顶就会糊成一片白
  float L = clamp(aLit, 0.0, 1.5);
  gl_PointSize = clamp(aSize * uPointScale * (1.0 + 0.85 * L), uPixMin, uPixMax);
  vec3 c = mix(aColor, vec3(1.0), min(0.75, L * 0.75));
  // uGain 是自动曝光（见 build 里的 median）：暗调壁纸直接叠像素颜色等于全黑
  vColor = c * uGain * (1.0 + 2.2 * L) * shimmer;
  // 三档亮度：轮廓最亮，暗部最暗
  vAlpha = (1.0 - aTier * 0.3) * (0.30 + 0.34 * L) * shimmer;
}
`;

const FRAG = `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float m = smoothstep(0.5, 0.05, r);
  float a = m * vAlpha;
  // 预乘输出，配合 blendFunc(ONE, ONE) 的加色叠加
  gl_FragColor = vec4(vColor * a, a);
}
`;

// ============================================================ 小工具

/** 确定性随机。粒子位置要可复现，刷新一次换一个布局会让人以为坏了 */
function mulberry32(seed: number): () => number {
	// 种子拷进局部变量：直接改参数会让状态藏在调用者的实参里，改起来更容易出事
	let a = seed | 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 分位数（1024 桶直方图）。给 38 万个浮点排序太浪费，这个 O(n) 就够准 */
function quantile(a: Float32Array, q: number): number {
	let max = 0;
	for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
	if (max <= 0) return 0;
	const BINS = 1024;
	const bins = new Int32Array(BINS);
	const k = (BINS - 1) / max;
	for (let i = 0; i < a.length; i++) bins[(a[i] * k) | 0]++;
	const want = q * a.length;
	let acc = 0;
	for (let b = 0; b < BINS; b++) {
		acc += bins[b];
		if (acc >= want) return b / k;
	}
	return max;
}

/**
 * 从 total 个位置里均匀抽 take 个（蓄水池抽样）。
 * 不用「生成全量索引再洗牌」是因为 total 可能有几十万，而 take 只要几万。
 */
function pickPositions(
	total: number,
	take: number,
	rnd: () => number,
): Int32Array {
	const out = new Int32Array(take);
	for (let i = 0; i < take; i++) out[i] = i;
	for (let i = take; i < total; i++) {
		const j = (rnd() * (i + 1)) | 0;
		if (j < take) out[j] = i;
	}
	return out;
}
