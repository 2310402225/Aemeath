// 枢纽首页：一整颗由发光粒子构成的正四面体（不是实体几何体）。
//
// 几个关键决定，都是推过或踩过才定的：
//
// 1. **拾取不打在粒子点云上。** Points 的 raycast 要靠 threshold 猜一个命中半径，
//    边缘会飘、还会误判。做法是另备一个「不可见的实体四面体」专门挨打，
//    intersect.faceIndex 直接给出面号。它**不加进场景**（不进 scene 就不会被渲染，
//    也绕开 object.visible / material.visible 在 Raycaster 里语义不明的坑），
//    每帧把旋转组的姿态同步过去再 updateMatrixWorld 就行。
// 2. **漂浮与呼吸放在顶点着色器里**（uTime），CPU 每帧不碰两万多个坐标。
// 3. **不开 depthTest**（加色叠加本来就这么画）。远近层次靠「背面压暗」拿回来 ——
//    按面法线与视线的夹角调亮度，否则背面的「绢」字会透过正面糊在一起。
// 4. 加色用**预乘 + blendFunc(ONE, ONE)**：片元输出 vec4(rgb*a, a)，
//    配合透明画布，浏览器按预乘合成叠到页面底色上。用 (SRC_ALPHA, ONE) 会暗一个数量级。

import * as THREE from "three";
import { SILK_GLYPHS } from "./silk-glyphs";

export type FaceKey = "A" | "B" | "C" | "D";

/** 面的顺序固定：索引 0~3 就是 A~D，和拾取到的 faceIndex 一一对应 */
export const FACE_ORDER: FaceKey[] = ["A", "B", "C", "D"];

/** 每面的主色：A 暖金 / B 青 / C 品红 / D 紫。枢纽上四面的字形也靠它区分 */
export const FACE_TINT: Record<FaceKey, [number, number, number]> = {
	A: [1.0, 0.82, 0.48],
	B: [0.43, 0.9, 1.0],
	C: [1.0, 0.35, 0.78],
	D: [0.61, 0.55, 1.0],
};

/** 外接球半径。整个枢纽都按它归一，改这一个数就能整体缩放 */
const R = 1;

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

/** 正四面体的四个顶点（归一化到球面上） */
const VERTS: THREE.Vector3[] = [
	new THREE.Vector3(1, 1, 1),
	new THREE.Vector3(1, -1, -1),
	new THREE.Vector3(-1, 1, -1),
	new THREE.Vector3(-1, -1, 1),
].map((v) => v.normalize().multiplyScalar(R));

/** 面 f 与顶点 f 相对 */
const FACE_TRIS: [number, number, number][] = [
	[1, 2, 3],
	[0, 3, 2],
	[0, 1, 3],
	[0, 2, 1],
];

type FaceFrame = {
	center: THREE.Vector3;
	normal: THREE.Vector3;
	u: THREE.Vector3;
	v: THREE.Vector3;
	tint: [number, number, number];
};

function buildFaces(): FaceFrame[] {
	return FACE_TRIS.map((tri, f) => {
		const a = VERTS[tri[0]];
		const b = VERTS[tri[1]];
		const c = VERTS[tri[2]];
		const center = new THREE.Vector3()
			.add(a)
			.add(b)
			.add(c)
			.multiplyScalar(1 / 3);
		const normal = new THREE.Vector3()
			.subVectors(b, a)
			.cross(new THREE.Vector3().subVectors(c, a))
			.normalize();
		// 外法线：一定背着原点
		if (normal.dot(center) < 0) normal.negate();
		const u = new THREE.Vector3().subVectors(a, center).normalize();
		const v = new THREE.Vector3().crossVectors(normal, u).normalize();
		return { center, normal, u, v, tint: FACE_TINT[FACE_ORDER[f]] };
	});
}

const FACES = buildFaces();

/** 字形在面上的缩放：±1 的字形坐标乘它。留了边距，别顶到三条棱 */
const GLYPH_SCALE = 0.6;

const VERT_SRC = /* glsl */ `
	uniform float uTime;
	uniform float uHover;
	uniform float uActive;
	uniform float uPixelScale;
	uniform float uMotion;
	attribute float aSeed;
	attribute float aSize;
	attribute float aFace;
	attribute vec3 aTint;
	attribute vec3 aNormal;
	varying vec3 vColor;

	void main() {
		vec3 p = position;

		// 轻微无序漂浮：每颗粒子按自己的相位在三个轴上小幅游走，永不散开
		float ph = aSeed * 6.2831853;
		vec3 drift = vec3(
			sin(uTime * 0.70 + ph),
			cos(uTime * 0.61 + ph * 1.7),
			sin(uTime * 0.53 + ph * 2.3)
		);
		p += drift * (0.010 + 0.014 * fract(aSeed * 7.13)) * uMotion;

		// 呼吸脉动：整体沿法线微胀，像在吸气
		p *= 1.0 + 0.022 * sin(uTime * 1.15) * uMotion;

		vec4 world = modelMatrix * vec4(p, 1.0);
		vec4 mv = viewMatrix * world;

		// 背面压暗：不开深度测试，体积感全靠这个
		vec3 nrm = normalize(mat3(modelMatrix) * aNormal);
		vec3 viewDir = normalize(cameraPosition - world.xyz);
		float facing = dot(nrm, viewDir);
		float vis = mix(0.13, 1.0, smoothstep(-0.4, 0.5, facing));

		// 悬停 / 高亮的某一面整体提亮（鼠标停在面上，或骰子停稳时）
		float hi = 1.0;
		if (aFace >= 0.0) {
			if (abs(aFace - uHover) < 0.5 || abs(aFace - uActive) < 0.5) hi = 2.5;
		}

		vColor = aTint * vis * hi;
		gl_PointSize = aSize * uPixelScale / max(0.05, -mv.z) * (0.88 + 0.16 * hi);
		gl_Position = projectionMatrix * mv;
	}
`;

const FRAG_SRC = /* glsl */ `
	precision highp float;
	varying vec3 vColor;

	void main() {
		// 软圆点：从中心往外衰减，得到一颗发光的点而不是硬方块
		vec2 d = gl_PointCoord - 0.5;
		float r2 = dot(d, d);
		float a = smoothstep(0.25, 0.0, r2);
		if (a <= 0.003) discard;
		// 预乘输出：配合 blendFunc(ONE, ONE)，亮度才不塌
		gl_FragColor = vec4(vColor * a, a);
	}
`;

export type HubOptions = {
	/** 轻点某一面（不是拖拽之后）。调用方负责推近 + 跳转 */
	onPick: (face: FaceKey) => void;
	/** 骰子停稳、正对镜头的那一面。枢纽还会把这一面亮 1.2 秒，调用方随后自行推近 */
	onSettle: (face: FaceKey) => void;
};

export type Hub = {
	/** 高亮某一面（-1 取消） */
	setActive: (face: number) => void;
	/** 骰子：高速翻滚 → 减速停稳 → onSettle */
	spin: () => void;
	/** 镜头推近某一面；动画结束调 done */
	flyTo: (face: number, done: () => void) => void;
	/** 镜头退回全景，并清掉所有临时状态（从子页面回来时用） */
	reset: () => void;
	/** 场景切走 / 切回时调用，省掉看不见时的空转 */
	setRunning: (on: boolean) => void;
	dispose: () => void;
};

export function createHub(canvas: HTMLCanvasElement, opts: HubOptions): Hub {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		alpha: true,
		antialias: false,
		premultipliedAlpha: true,
		powerPreference: "high-performance",
	});
	renderer.setClearColor(0x000000, 0);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
	const REST = new THREE.Vector3(0, 0, 4.1);
	camera.position.copy(REST);

	/** 旋转组：拖拽与骰子都转它；拾取用的实体四面体每帧同步它的姿态 */
	const group = new THREE.Group();
	scene.add(group);

	// 构图用的确定性伪随机：每次刷新长得一样，diff 才有意义
	const rnd = mulberry32(20260924);

	// ---------------------------------------------------------------- 点云
	// 一张点云，用 attribute 区分身份：面 / 字形 / 棱 / 顶点 / 环境尘埃。
	// 不拆成多个 Points 是省 draw call，也省得给每类各写一份材质。
	const pos: number[] = [];
	const seeds: number[] = [];
	const sizes: number[] = [];
	const faces: number[] = [];
	const tints: number[] = [];
	const normals: number[] = [];

	function push(
		p: THREE.Vector3,
		tint: [number, number, number],
		size: number,
		face: number,
		normal: THREE.Vector3,
		bright: number,
	) {
		pos.push(p.x, p.y, p.z);
		seeds.push(rnd());
		sizes.push(size);
		faces.push(face);
		tints.push(tint[0] * bright, tint[1] * bright, tint[2] * bright);
		normals.push(normal.x, normal.y, normal.z);
	}

	for (let f = 0; f < 4; f++) {
		const fr = FACES[f];
		const a = VERTS[FACE_TRIS[f][0]];
		const b = VERTS[FACE_TRIS[f][1]];
		const c = VERTS[FACE_TRIS[f][2]];

		// 面：均匀撒在三角形里（重心坐标，越界就折回来，避免往一角堆）
		for (let i = 0; i < 620; i++) {
			let s = rnd();
			let t = rnd();
			if (s + t > 1) {
				s = 1 - s;
				t = 1 - t;
			}
			const p = new THREE.Vector3()
				.addScaledVector(a, s)
				.addScaledVector(b, t)
				.addScaledVector(c, 1 - s - t);
			// 往内收一点，点云才有「壳」的厚度，而不是一层纸
			p.addScaledVector(fr.normal, -0.03 - rnd() * 0.05);
			push(p, fr.tint, 0.0075, f, fr.normal, 0.34);
		}

		// 字形：面上的标识（绢 / 格 / 霓 / 归），比面色亮，浮在面外一点
		const glyph = SILK_GLYPHS[FACE_ORDER[f]];
		for (let i = 0; i < glyph.length; i += 2) {
			const p = new THREE.Vector3()
				.copy(fr.center)
				.addScaledVector(fr.u, glyph[i] * GLYPH_SCALE)
				.addScaledVector(fr.v, glyph[i + 1] * GLYPH_SCALE)
				.addScaledVector(fr.normal, 0.035);
			push(p, fr.tint, 0.0155, f, fr.normal, 1.15);
		}
	}

	// 棱：六条边，密而亮 —— 四面体的骨架靠它读出来
	for (let i = 0; i < 4; i++) {
		for (let j = i + 1; j < 4; j++) {
			const a = VERTS[i];
			const b = VERTS[j];
			const n = new THREE.Vector3().add(a).add(b).normalize();
			for (let k = 0; k < 150; k++) {
				const p = new THREE.Vector3().lerpVectors(a, b, k / 149);
				p.addScaledVector(n, (rnd() - 0.5) * 0.02);
				push(p, [1, 1, 1], 0.0085, -1, n, 0.92);
			}
		}
	}

	// 顶点：四角各一小团，最亮
	for (let i = 0; i < 4; i++) {
		const n = VERTS[i].clone().normalize();
		for (let k = 0; k < 90; k++) {
			const p = VERTS[i].clone().addScaledVector(n, rnd() * 0.05);
			p.x += (rnd() - 0.5) * 0.06;
			p.y += (rnd() - 0.5) * 0.06;
			p.z += (rnd() - 0.5) * 0.06;
			push(p, [1, 1, 1], 0.0105, -1, n, 1.25);
		}
	}

	// 环境尘埃：外圈一层很暗的浮尘，给画面纵深
	for (let i = 0; i < 1800; i++) {
		const dir = new THREE.Vector3(
			rnd() * 2 - 1,
			rnd() * 2 - 1,
			rnd() * 2 - 1,
		).normalize();
		const p = dir.clone().multiplyScalar(R * (1.25 + rnd() * 1.5));
		push(p, [0.62, 0.7, 0.95], 0.006, -1, dir, 0.3);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
	geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
	geo.setAttribute("aFace", new THREE.Float32BufferAttribute(faces, 1));
	geo.setAttribute("aTint", new THREE.Float32BufferAttribute(tints, 3));
	geo.setAttribute("aNormal", new THREE.Float32BufferAttribute(normals, 3));

	const uniforms = {
		uTime: { value: 0 },
		uHover: { value: -1 },
		uActive: { value: -1 },
		uPixelScale: { value: 1000 },
		uMotion: { value: prefersReducedMotion() ? 0.25 : 1 },
	};

	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: VERT_SRC,
		fragmentShader: FRAG_SRC,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneFactor,
	});
	const points = new THREE.Points(geo, material);
	points.frustumCulled = false;
	group.add(points);

	// -------------------------------------------- 拾取用的隐形实体四面体
	// 四块三角形手搓（不用 TetrahedronGeometry）：faceIndex 必须和 FACES 的下标对齐，
	// 用它自带的顶点顺序就得反查，不划算。它**不进场景**，只用来挨打。
	const pickGeo = new THREE.BufferGeometry();
	const pickPos: number[] = [];
	for (const tri of FACE_TRIS) {
		for (const vi of tri) {
			const v = VERTS[vi];
			pickPos.push(v.x, v.y, v.z);
		}
	}
	pickGeo.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(pickPos, 3),
	);
	const pickMesh = new THREE.Mesh(
		pickGeo,
		new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
	);
	const raycaster = new THREE.Raycaster();

	// ---------------------------------------------------------------- 交互
	let hover = -1;
	let active = -1;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let moved = 0;
	let velX = 0;
	let velY = 0;
	let flying = false;

	// 骰子：0 空闲 / 1 自由翻滚 / 2 往对齐姿态收敛 / 3 停稳后亮一会儿
	let spinPhase = 0;
	let spinT = 0;
	let spinSpeed = 0;
	let settleFace = -1;
	const spinAxis = new THREE.Vector3(1, 0, 0);
	const settleFrom = new THREE.Quaternion();
	const settleTarget = new THREE.Quaternion();

	function setCursor(c: string) {
		canvas.style.cursor = c;
	}

	function pickAt(clientX: number, clientY: number): number {
		const r = canvas.getBoundingClientRect();
		const nx = ((clientX - r.left) / r.width) * 2 - 1;
		const ny = -((clientY - r.top) / r.height) * 2 + 1;
		raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
		// 姿态同步：拾取体不在场景里，就得自己跟上旋转组
		pickMesh.quaternion.copy(group.quaternion);
		pickMesh.updateMatrixWorld(true);
		const hits = raycaster.intersectObject(pickMesh, false);
		if (!hits.length) return -1;
		return Math.floor(hits[0].faceIndex ?? 0);
	}

	function onPointerDown(e: PointerEvent) {
		if (flying || spinPhase !== 0) return;
		dragging = true;
		moved = 0;
		lastX = e.clientX;
		lastY = e.clientY;
		velX = velY = 0;
		canvas.setPointerCapture(e.pointerId);
		setCursor("grabbing");
	}

	function onPointerMove(e: PointerEvent) {
		if (dragging) {
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			moved += Math.abs(dx) + Math.abs(dy);
			// 在世界轴上转：横向拖 → 绕 y 轴，纵向拖 → 绕相机的右方向
			group.rotateOnWorldAxis(AXIS_Y, dx * 0.0075);
			group.rotateOnWorldAxis(AXIS_X, dy * 0.0075);
			velX = dx * 0.0075;
			velY = dy * 0.0075;
			return;
		}
		const f = pickAt(e.clientX, e.clientY);
		if (f !== hover) {
			hover = f;
			setCursor(f >= 0 ? "pointer" : "grab");
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		setCursor("grab");
		try {
			canvas.releasePointerCapture(e.pointerId);
		} catch {
			// 指针已经没了，忽略
		}
		// 轻点（而不是拖过）才算选中某一面
		if (moved < 6 && spinPhase === 0 && !flying) {
			const f = pickAt(e.clientX, e.clientY);
			if (f >= 0) opts.onPick(FACE_ORDER[f]);
		}
	}

	function onPointerLeave() {
		if (!dragging && hover !== -1) {
			hover = -1;
			setCursor("grab");
		}
	}

	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);
	canvas.addEventListener("pointerleave", onPointerLeave);
	setCursor("grab");

	// ---------------------------------------------------------------- 尺寸
	function resize() {
		const w = canvas.clientWidth || 1;
		const h = canvas.clientHeight || 1;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		renderer.setPixelRatio(dpr);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		// 一个世界单位在屏幕上占多少像素 —— 点大小的换算基准
		uniforms.uPixelScale.value =
			(h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	// ---------------------------------------------------------------- 循环
	// 从 false 起步：谁需要它谁调 setRunning(true)（applyScene 进枢纽时会调），
	// 这样循环的启停只有一个入口，不会出现「构造完自己偷偷跑着」的情况。
	let running = false;
	let raf = 0;
	let prev = performance.now();
	const clockStart = performance.now();

	function easeInOutCubic(t: number) {
		return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
	}
	function easeOutCubic(t: number) {
		return 1 - (1 - t) ** 3;
	}

	/** 把某一面转到正对镜头所需要的姿态 */
	function quatFacingCamera(face: number): THREE.Quaternion {
		const n = FACES[face].normal.clone().normalize();
		return new THREE.Quaternion().setFromUnitVectors(
			n,
			camera.position.clone().normalize(),
		);
	}

	function frame(now: number) {
		// 停用之后不再排下一帧 —— 上一版是无条件重排、进函数再 return，
		// 于是人已经在别的场景里了，这个 60fps 的空循环还在一直把主线程叫醒。
		if (!running) return;
		raf = requestAnimationFrame(frame);
		const dt = Math.min(0.05, (now - prev) / 1000);
		prev = now;

		uniforms.uTime.value = (now - clockStart) / 1000;

		// 拖拽松手后的余速慢慢衰减 —— 没有它手感是"死"的
		if (!dragging && spinPhase === 0 && !flying) {
			if (Math.abs(velX) > 1e-4 || Math.abs(velY) > 1e-4) {
				group.rotateOnWorldAxis(AXIS_Y, velX);
				group.rotateOnWorldAxis(AXIS_X, velY);
				velX *= 0.94;
				velY *= 0.94;
			}
		}

		if (spinPhase === 1) {
			// 高速翻滚，速度指数衰减（"逐步减速"）
			spinT += dt;
			group.rotateOnWorldAxis(spinAxis, spinSpeed * dt);
			spinSpeed *= 1 - Math.min(0.9, dt * 1.35);
			if (spinT > 0.72) {
				spinPhase = 2;
				spinT = 0;
				// 收敛目标从「当前姿态」算起，省得记初始姿态
				settleFrom.copy(group.quaternion);
				settleTarget.copy(quatFacingCamera(settleFace));
			}
		} else if (spinPhase === 2) {
			spinT += dt;
			const t = Math.min(1, spinT / 0.95);
			group.quaternion.slerpQuaternions(
				settleFrom,
				settleTarget,
				easeOutCubic(t),
			);
			if (t >= 1) {
				spinPhase = 3;
				spinT = 0;
				active = settleFace;
				uniforms.uActive.value = settleFace;
				opts.onSettle(FACE_ORDER[settleFace]);
			}
		} else if (spinPhase === 3) {
			// 停稳后按住 1.2 秒让人看清是哪一面，再放出去走跳转
			spinT += dt;
			if (spinT > 1.2) spinPhase = 0;
		}

		uniforms.uHover.value = hover;
		if (spinPhase !== 3) uniforms.uActive.value = active;

		renderer.render(scene, camera);
	}

	return {
		setActive(face: number) {
			active = face;
			uniforms.uActive.value = face;
		},
		spin() {
			if (flying || spinPhase !== 0) return;
			active = -1;
			uniforms.uActive.value = -1;
			// 骰子用真随机（构图才用确定性随机）
			settleFace = Math.floor(Math.random() * 4);
			spinAxis
				.set(
					Math.random() * 2 - 1,
					Math.random() * 2 - 1,
					Math.random() * 2 - 1,
				)
				.normalize();
			spinSpeed = 13 + Math.random() * 5;
			spinT = 0;
			spinPhase = 1;
		},
		flyTo(face: number, done: () => void) {
			if (flying) return;
			flying = true;
			const from = camera.position.clone();
			const to = FACES[face].center
				.clone()
				.normalize()
				.multiplyScalar(camera.position.length() * 0.32);
			const target = quatFacingCamera(face);
			const t0 = performance.now();
			const step = () => {
				const t = Math.min(1, (performance.now() - t0) / 900);
				const e = easeInOutCubic(t);
				camera.position.lerpVectors(from, to, e);
				// 推近的同时把这一面转正 —— 镜头才像"撞上那面"，而不是绕过去
				group.quaternion.slerp(target, e * 0.55);
				if (t < 1) {
					requestAnimationFrame(step);
					return;
				}
				// 落位后必须自己把 flying 放掉：早先只有 reset()（进枢纽时）才清它，
				// 于是「从 A 面直接切到 B 面」这条件 —— 导航链接、浏览器后退都走它 ——
				// 会让下一次 flyTo 永远提前 return，busy 卡在 true，整个页面就不动了。
				flying = false;
				done();
			};
			requestAnimationFrame(step);
		},
		reset() {
			flying = false;
			camera.position.copy(REST);
			active = -1;
			uniforms.uActive.value = -1;
			velX = velY = 0;
			spinPhase = 0;
		},
		setRunning(on: boolean) {
			if (on === running) return;
			running = on;
			prev = performance.now();
			cancelAnimationFrame(raf);
			// 首屏由 createSilkApp 立刻调 applyScene("hub") 打开，所以这里从 false 起步
			if (on) raf = requestAnimationFrame(frame);
		},
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUp);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			geo.dispose();
			pickGeo.dispose();
			material.dispose();
			(pickMesh.material as THREE.Material).dispose();
			renderer.dispose();
		},
	};
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** 确定性伪随机（mulberry32） */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
