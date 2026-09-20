/**
 * 全息卡观看器 —— 从 RuiC-card-skill 生成的独立观看器移植而来。
 *
 * 与原版的区别：原版直接抓 document 里的一堆 id 做控件，这里只负责「把卡渲染进
 * 一个容器」，控制权交回 Svelte。除此之外着色器、分层、材质、交互参数逐行保留，
 * 因为那套数值是逐张卡调出来的，改一个数就糊。
 *
 * 五层深度必须互不相同（同深度两层会糊成一块平面，这是卡片「看着平」的头号原因）：
 *   subject 0.4 / effects 0.5 / background −0.25 / lineart 跟随主体 / text 0（无视差）
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type Finish = "pearl" | "silver" | "gold" | "original";

export interface HoloViewerAssets {
	model: string;
	subject: string;
	background: string;
	text: string;
	lineart?: string;
	effects?: string;
	/** 卡背整图（1024×1536，已印好系列名与版次）。缺省时退成一张素背面 */
	back?: string;
}

export interface HoloViewerConfig {
	title?: string;
	subtitle?: string;
	technique?: string;
	edition?: string;
	collection?: string;
	description?: string;
	model?: string;
	assets: HoloViewerAssets;
	parameters?: {
		subjectScale?: number;
		subjectDepth?: number;
		backgroundDepth?: number;
		effectsDepth?: number;
		foil?: number;
	};
	safeArea?: { scale?: number; offset?: [number, number] };
	appearance?: { background?: string; finish?: Finish };
	/** "relief" 走分层实体；缺省即参考图模式（全部在正面着色器里合成） */
	sourceMode?: string;
}

export interface HoloViewer {
	/** 首次渲染完成即 resolve；加载失败会 reject，由调用方接住 */
	readonly ready: Promise<void>;
	flip(value?: boolean): void;
	reset(): void;
	setFinish(finish: Finish): void;
	setFoil(value: number): void;
	setParam(name: ParamName, value: number): void;
	save(): boolean;
	isReady(): boolean;
	isFlipped(): boolean;
	dispose(): void;
}

export type ParamName = "scale" | "depth" | "fx-depth" | "bg-depth";

const FINISH_CODE: Record<Finish, number> = {
	pearl: 0,
	silver: 1,
	original: 2,
	gold: 3,
};

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMMON = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uFoil, uScale, uDepth, uBgDepth, uFinish, uHasLine, uRelief, uSafeScale, uFxDepth, uHasFx;
uniform vec2 uFit, uSafeOffset;
uniform vec3 uView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float inside(vec2 p) { return step(0.,p.x)*step(0.,p.y)*step(p.x,1.)*step(p.y,1.); }
vec2 parallax(vec2 uv, float depth) {
  return uv + uView.xy / max(abs(uView.z), .4) * depth * .10;
}
vec3 spectrum(float phase) {
  return .66 + .25 * cos(6.28318 * (phase + vec3(0., .33, .67)));
}
// Only "original" (uFinish ~ 2) disables the foil; pearl/silver/gold all use it.
float strength() { return abs(uFinish - 2.0) < 0.05 ? 0. : uFoil; }
vec3 film(vec2 uv) {
  float phase = uv.x * .85 + uv.y * .55 + uView.x * 1.5 - uView.y * .9;
  if (uFinish > 2.5) {
    // 烫金 (gold foil): warm gold laminate that shifts with the viewing angle.
    float hi = 0.5 + 0.5 * sin(phase * 6.28318);
    float glint = 0.5 + 0.5 * cos((phase + 0.25) * 6.28318);
    vec3 deep = vec3(.72, .50, .20);
    vec3 bright = vec3(1.00, .90, .60);
    return mix(deep, bright, hi * .7 + glint * .3);
  }
  vec3 color = spectrum(phase);
  return mix(color, vec3(dot(color,vec3(.2126,.7152,.0722))), step(.5,uFinish));
}
float sweep(vec2 uv) {
  return pow(.5+.5*sin((uv.x*.72+uv.y*.45+uView.x*1.2+uView.y*.6)*6.283),10.);
}
`;

const FRONT_FRAGMENT = `${COMMON}
uniform sampler2D tSubject, tBackground, tText, tLine, tEffects;
void main() {
  vec2 uv = vUv;
  vec2 su = ((parallax(uv,uDepth)-.5)*uScale/uFit+.5)*uSafeScale+uSafeOffset;
  vec2 bu = parallax(uv,uBgDepth);
  vec4 subject = texture2D(tSubject,clamp(su,0.,1.));
  subject.a *= inside(su)*(1.-uRelief);
  vec3 bg = texture2D(tBackground,clamp(bu,0.,1.)).rgb;
  vec3 col = mix(bg,subject.rgb,subject.a);
  if (uFinish > 2.5) col = col * vec3(1.02, .95, .78) + vec3(.05, .012, 0.0);
  // Effects layer floats between the subject and the text: above the character,
  // below the typography, with its own mid-depth parallax.
  vec2 eu = parallax(uv,uFxDepth);
  vec4 fx = texture2D(tEffects,clamp(eu,0.,1.));
  col = mix(col,fx.rgb,fx.a*(1.-uRelief)*uHasFx);
  vec3 foil = film(uv);
  float amount = strength();
  float luminance = dot(col,vec3(.2126,.7152,.0722));
  float band = sweep(uv);
  // Laminate changes with the card-local viewing direction; black print stays readable.
  float goldBoost = uFinish > 2.5 ? 1.7 : 1.0;
  col *= 1. - amount * .21 * (1.-foil) * (.2 + band*.8);
  col += foil * amount * band * goldBoost * (.065 + .11*(1.-luminance));
  float edge = 1.-smoothstep(.015,.06,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
  col = mix(col,foil*.75+.21,edge*amount*(uFinish > 2.5 ? .42 : .3));
  vec2 cell = floor(uv*vec2(480.,720.));
  float flake = step(.994,hash(cell))*pow(.5+.5*sin(hash(cell+8.)*30.+uView.x*20.+uTime*.6),10.);
  col += foil*flake*amount*.13;
  float line = (1.-smoothstep(.06,.25,texture2D(tLine,clamp(su,0.,1.)).r))*uHasLine;
  col += line*inside(su)*subject.a*band*amount*.055;
  vec4 text = texture2D(tText,uv);
  col = mix(col,text.rgb,text.a*(1.-uRelief));
  gl_FragColor = vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;

const EDGE_FRAGMENT = `${COMMON}
void main() {
  vec3 col = mix(vec3(.66,.69,.67),film(vUv)*.6+.35,strength()*.7);
  gl_FragColor=vec4(pow(col,vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;

// 卡背 = 第二张官方视觉图裁好的整图（见 tools/build_backs.py），
// 箔材照样在它上面叠一层，只是幅度压得比正面低，画才不会脏。
const BACK_FRAGMENT = `${COMMON}
uniform sampler2D tBack;
void main() {
  vec2 uv=vec2(1.-vUv.x,vUv.y);
  vec4 art=texture2D(tBack,uv);
  vec3 foil=film(vUv);
  float amount=strength();
  float band=sweep(vUv);
  vec3 col=art.rgb;
  col*=1.-amount*.14*(1.-foil);
  col+=foil*band*amount*.12;
  float edge=1.-smoothstep(.012,.05,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
  col=mix(col,foil*.8+.2,edge*amount*.28);
  vec2 cell=floor(vUv*vec2(420.,630.));
  float flake=step(.995,hash(cell))*pow(.5+.5*sin(hash(cell+3.)*30.+uView.x*18.+uTime*.5),10.);
  col+=foil*flake*amount*.10;
  gl_FragColor=vec4(pow(clamp(col,0.,1.),vec3(2.2)),1.);
  #include <colorspace_fragment>
}
`;

function textureOf(canvas: HTMLCanvasElement): THREE.CanvasTexture {
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.NoColorSpace;
	return texture;
}

/** 卡片背后的柔和投影，翻到背面时收窄，暗示卡片在转 */
function shadowTexture(): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 256;
	c.height = 256;
	const ctx = c.getContext("2d");
	if (ctx) {
		const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
		grad.addColorStop(0, "rgba(29,35,25,0.13)");
		grad.addColorStop(0.4, "rgba(29,35,25,0.055)");
		grad.addColorStop(1, "rgba(29,35,25,0)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 256, 256);
	}
	return textureOf(c);
}

interface ReliefLayers {
	subject: THREE.Object3D[];
	effects: THREE.Object3D[];
	text: THREE.Object3D[];
}

interface BaseTransform {
	basePosition: THREE.Vector3;
	baseScale: THREE.Vector3;
}

/** relief 模式每层错开的步长（卡片半高约 5.45） */
const RELIEF_STEP = 0.22;

export function createHoloViewer(options: {
	container: HTMLElement;
	config: HoloViewerConfig;
	onState?: (state: { flipped: boolean }) => void;
}): HoloViewer {
	const { container, config } = options;
	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

	const relief: ReliefLayers = { subject: [], effects: [], text: [] };
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
	camera.position.set(0, 0, 20);
	const inverse = new THREE.Matrix4();

	let renderer: THREE.WebGLRenderer | null = null;
	let root: THREE.Group | null = null;
	let shadow: THREE.Mesh | null = null;
	let uniforms: Record<string, THREE.IUniform> = {};
	let ready = false;
	let disposed = false;
	let lastTime = 0;
	let elapsed = 0;
	let auto = false;
	let flipped = false;
	let dragging = false;
	let zoom = 1;
	let targetX = -0.035;
	let targetY = -0.15;
	let lastPointer = { x: 0, y: 0 };
	let resizeObserver: ResizeObserver | null = null;

	function resize(): void {
		if (!renderer || !root) return;
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (!width || !height) return;
		const aspect = width / height;
		const halfHeight =
			Math.max(config.sourceMode === "relief" ? 6.25 : 5.45, 4.5 / aspect) /
			zoom;
		camera.left = -halfHeight * aspect;
		camera.right = halfHeight * aspect;
		camera.top = halfHeight;
		camera.bottom = -halfHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
	}

	function layoutRelief(): void {
		const scale = uniforms.uScale.value as number;
		const depth = uniforms.uDepth.value as number;
		const invScale = 1 / (scale || 1);
		const place = (objects: THREE.Object3D[], dz: number) => {
			for (const object of objects) {
				const data = object.userData as BaseTransform;
				object.position.z = depth + dz;
				object.scale.copy(data.baseScale).multiplyScalar(invScale);
			}
		};
		place(relief.subject, 0);
		place(relief.effects, RELIEF_STEP);
		place(relief.text, RELIEF_STEP * 2);
	}

	function animate(now: number): void {
		const dt = Math.min((now - lastTime) / 1000, 0.06) || 0;
		lastTime = now;
		if (document.hidden || disposed) return;
		if (!reduceMotion.matches || auto) elapsed += dt;
		if (auto) {
			targetY = Math.sin(elapsed * 0.42) * 0.23 - 0.055;
			targetX = Math.sin(elapsed * 0.53) * 0.055 - 0.018;
		}
		if (!root || !renderer) return;
		const ease = reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 8);
		root.rotation.x += (targetX - root.rotation.x) * ease;
		root.rotation.y += (targetY - root.rotation.y) * ease;
		root.updateMatrixWorld(true);
		const view = uniforms.uView.value as THREE.Vector3;
		view
			.copy(camera.position)
			.applyMatrix4(inverse.copy(root.matrixWorld).invert())
			.normalize();
		uniforms.uTime.value = reduceMotion.matches && !auto ? 0 : elapsed;
		if (shadow) shadow.scale.x = 1 - Math.abs(Math.sin(root.rotation.y)) * 0.14;
		renderer.render(scene, camera);
	}

	function release(): void {
		dragging = false;
		container.classList.remove("dragging");
	}

	function setAuto(value: boolean): void {
		auto = value;
	}

	function face(): void {
		options.onState?.({ flipped });
	}

	function flip(value = !flipped): void {
		flipped = value;
		lastTime = performance.now();
		setAuto(false);
		targetY = flipped ? Math.PI : 0;
		targetX = 0;
		face();
	}

	function reset(): void {
		targetX = -0.035;
		targetY = -0.15;
		zoom = 1;
		flipped = false;
		setAuto(false);
		uniforms.uFoil.value = config.parameters?.foil ?? 0.52;
		uniforms.uScale.value = config.parameters?.subjectScale ?? 1;
		uniforms.uDepth.value = config.parameters?.subjectDepth ?? 0.32;
		uniforms.uFxDepth.value = config.parameters?.effectsDepth ?? 0.14;
		uniforms.uBgDepth.value = config.parameters?.backgroundDepth ?? -0.18;
		uniforms.uFinish.value = FINISH_CODE[config.appearance?.finish ?? "pearl"];
		if (config.sourceMode === "relief") layoutRelief();
		face();
		resize();
	}

	function bindControls(): void {
		container.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			dragging = true;
			setAuto(false);
			lastPointer = { x: event.clientX, y: event.clientY };
			container.setPointerCapture(event.pointerId);
			container.classList.add("dragging");
			container.focus({ preventScroll: true });
		});
		container.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			const base = flipped ? Math.PI : 0;
			targetY = THREE.MathUtils.clamp(
				targetY + (event.clientX - lastPointer.x) * 0.006,
				base - 0.65,
				base + 0.65,
			);
			targetX = THREE.MathUtils.clamp(
				targetX + (event.clientY - lastPointer.y) * 0.004,
				-0.36,
				0.36,
			);
			lastPointer = { x: event.clientX, y: event.clientY };
		});
		for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
			container.addEventListener(type, release);
		}
		container.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				zoom = THREE.MathUtils.clamp(zoom - event.deltaY * 0.001, 0.82, 1.05);
				resize();
			},
			{ passive: false },
		);
		container.addEventListener("keydown", (event) => {
			const keys = [
				"ArrowLeft",
				"ArrowRight",
				"ArrowUp",
				"ArrowDown",
				"f",
				"F",
				"r",
				"R",
				" ",
			];
			if (!keys.includes(event.key)) return;
			event.preventDefault();
			if (event.key === " ") {
				setAuto(!auto);
				return;
			}
			if (event.key.toLowerCase() === "f") {
				flip();
				return;
			}
			if (event.key.toLowerCase() === "r") {
				reset();
				return;
			}
			setAuto(false);
			const base = flipped ? Math.PI : 0;
			if (event.key === "ArrowLeft") targetY -= 0.08;
			if (event.key === "ArrowRight") targetY += 0.08;
			if (event.key === "ArrowUp") targetX -= 0.06;
			if (event.key === "ArrowDown") targetX += 0.06;
			targetY = THREE.MathUtils.clamp(targetY, base - 0.65, base + 0.65);
			targetX = THREE.MathUtils.clamp(targetX, -0.36, 0.36);
		});
	}

	async function init(): Promise<void> {
		renderer = new THREE.WebGLRenderer({
			antialias: true,
			alpha: false,
			preserveDrawingBuffer: true,
			powerPreference: "high-performance",
		});
		renderer.setClearColor(config.appearance?.background || "#0b1020", 1);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.NoToneMapping;
		container.append(renderer.domElement);
		renderer.domElement.setAttribute("aria-hidden", "true");

		const loader = new THREE.TextureLoader();
		const [subject, background, text] = await Promise.all([
			loader.loadAsync(config.assets.subject),
			loader.loadAsync(config.assets.background),
			loader.loadAsync(config.assets.text),
		]);
		const line = config.assets.lineart
			? await loader.loadAsync(config.assets.lineart)
			: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
		line.needsUpdate = true;
		const hasFx = Boolean(config.assets.effects);
		const effects = hasFx
			? await loader.loadAsync(config.assets.effects as string)
			: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
		effects.colorSpace = THREE.NoColorSpace;
		if (!hasFx) effects.needsUpdate = true;
		// 卡背是第一梯队资源，但缺了也不该整卡崩掉：给一张素背面顶着
		const back = config.assets.back
			? await loader.loadAsync(config.assets.back)
			: new THREE.DataTexture(new Uint8Array([240, 242, 238, 255]), 1, 1);
		if (!config.assets.back) back.needsUpdate = true;
		for (const texture of [subject, background, text, line, effects, back]) {
			texture.colorSpace = THREE.NoColorSpace;
			texture.anisotropy = Math.min(
				8,
				renderer.capabilities.getMaxAnisotropy(),
			);
		}

		const params = config.parameters ?? {};
		const image = subject.image as { width: number; height: number };
		const imageAspect = image.width / image.height;
		const fit: [number, number] =
			config.sourceMode === "reference"
				? [
						Math.min(0.87, (0.87 * imageAspect) / (2 / 3)),
						Math.min(0.87, (0.87 * (2 / 3)) / imageAspect),
					]
				: [1, 1];

		uniforms = {
			tSubject: { value: subject },
			tBackground: { value: background },
			tText: { value: text },
			tLine: { value: line },
			tEffects: { value: effects },
			tBack: { value: back },
			uTime: { value: 0 },
			uView: { value: new THREE.Vector3(0, 0, 1) },
			uFit: { value: new THREE.Vector2(...fit) },
			uFoil: { value: params.foil ?? 0.52 },
			uScale: { value: params.subjectScale ?? 1 },
			uDepth: { value: params.subjectDepth ?? 0.32 },
			uBgDepth: { value: params.backgroundDepth ?? -0.18 },
			uSafeScale: { value: config.safeArea?.scale ?? 1 },
			// 着色器的 V 轴相对 Blender 的 UV 空间是翻转的，纵向安全区偏移要补一次变换（x 相同）
			uSafeOffset: {
				value: new THREE.Vector2(
					config.safeArea?.offset?.[0] ?? 0,
					1 -
						(config.safeArea?.scale ?? 1) -
						(config.safeArea?.offset?.[1] ?? 0),
				),
			},
			uFxDepth: { value: params.effectsDepth ?? 0.14 },
			uHasFx: { value: hasFx ? 1 : 0 },
			uFinish: { value: FINISH_CODE[config.appearance?.finish ?? "pearl"] },
			uHasLine: { value: config.assets.lineart ? 1 : 0 },
			uRelief: { value: config.sourceMode === "relief" ? 1 : 0 },
		};

		const makeMaterial = (fragment: string) =>
			new THREE.ShaderMaterial({
				uniforms,
				vertexShader: VERTEX,
				fragmentShader: fragment,
				side: THREE.FrontSide,
			});
		const materials: Record<string, THREE.Material> = {
			web_front: makeMaterial(FRONT_FRAGMENT),
			web_back: makeMaterial(BACK_FRAGMENT),
			web_edge: makeMaterial(EDGE_FRAGMENT),
			web_gold: new THREE.MeshBasicMaterial({ color: "#c9a24a" }),
		};

		const gltf = await new GLTFLoader().loadAsync(
			config.model ?? config.assets.model,
		);
		if (disposed) return;
		root = new THREE.Group();
		root.add(gltf.scene);
		scene.add(root);

		let faces = 0;
		gltf.scene.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh) return;
			const material = mesh.material as THREE.Material | undefined;
			const role = material?.name ?? "";
			if (role === "web_text" && config.sourceMode !== "relief") {
				mesh.visible = false;
				return;
			}
			if (role === "web_front") faces++;
			mesh.material = materials[role] ?? materials.web_edge;
			if (role === "web_subject") relief.subject.push(mesh);
			if (role === "web_effects") relief.effects.push(mesh);
			if (role === "web_text") relief.text.push(mesh);
		});
		if (!faces) {
			throw new Error("卡片模型缺少正面材质");
		}
		root.updateMatrixWorld(true);
		for (const objects of Object.values(relief)) {
			for (const object of objects) {
				root.attach(object);
				object.userData = {
					basePosition: object.position.clone(),
					baseScale: object.scale.clone(),
				} satisfies BaseTransform;
			}
		}

		shadow = new THREE.Mesh(
			new THREE.PlaneGeometry(8.8, 11.8),
			new THREE.MeshBasicMaterial({
				map: shadowTexture(),
				transparent: true,
				depthWrite: false,
			}),
		);
		shadow.position.set(0.28, -0.48, -0.5);
		scene.add(shadow);

		bindControls();
		resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(container);
		resize();
		renderer.compile(scene, camera);
		root.rotation.set(targetX, targetY, 0);
		renderer.render(scene, camera);
		setAuto(!reduceMotion.matches);
		lastTime = performance.now();
		renderer.setAnimationLoop(animate);
		ready = true;
	}

	function save(): boolean {
		if (!renderer) return false;
		try {
			const originalSize = new THREE.Vector2();
			renderer.getSize(originalSize);
			const originalRatio = renderer.getPixelRatio();
			const bounds = {
				left: camera.left,
				right: camera.right,
				top: camera.top,
				bottom: camera.bottom,
			};
			renderer.setPixelRatio(1);
			renderer.setSize(1400, 1800, false);
			const captureHeight = config.sourceMode === "relief" ? 6.4 : 5.4;
			camera.left = (-captureHeight * 1400) / 1800;
			camera.right = (captureHeight * 1400) / 1800;
			camera.top = captureHeight;
			camera.bottom = -captureHeight;
			camera.updateProjectionMatrix();
			try {
				renderer.render(scene, camera);
				const link = document.createElement("a");
				link.download = `${config.title || "holo-card"}-${flipped ? "back" : "front"}.png`;
				link.href = renderer.domElement.toDataURL("image/png");
				link.click();
			} finally {
				Object.assign(camera, bounds);
				camera.updateProjectionMatrix();
				renderer.setPixelRatio(originalRatio);
				renderer.setSize(originalSize.x, originalSize.y, false);
				renderer.render(scene, camera);
			}
			return true;
		} catch (error) {
			console.error(error);
			return false;
		}
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		resizeObserver?.disconnect();
		if (renderer) {
			renderer.setAnimationLoop(null);
			scene.traverse((object) => {
				const mesh = object as THREE.Mesh;
				if (!mesh.isMesh) return;
				mesh.geometry?.dispose();
				const material = mesh.material as
					| THREE.Material
					| THREE.Material[]
					| undefined;
				for (const item of Array.isArray(material)
					? material
					: material
						? [material]
						: []) {
					item.dispose();
				}
			});
			for (const uniform of Object.values(uniforms)) {
				const value = uniform.value as { dispose?: () => void } | undefined;
				value?.dispose?.();
			}
			renderer.dispose();
			renderer.domElement.remove();
			renderer = null;
		}
		root = null;
		shadow = null;
		ready = false;
	}

	// 加载／编译失败不能让 overlay 卡在「装裱中」：调用方只管 await，异常自己接住
	const readyPromise = init();
	return {
		ready: readyPromise,
		flip,
		reset,
		setFinish(finish: Finish) {
			uniforms.uFinish.value = FINISH_CODE[finish] ?? FINISH_CODE.gold;
		},
		setFoil(value: number) {
			uniforms.uFoil.value = value;
		},
		setParam(name: ParamName, value: number) {
			const key = {
				scale: "uScale",
				depth: "uDepth",
				"fx-depth": "uFxDepth",
				"bg-depth": "uBgDepth",
			}[name];
			uniforms[key].value = value;
			if (config.sourceMode === "relief") layoutRelief();
		},
		save,
		isReady: () => ready,
		isFlipped: () => flipped,
		dispose,
	};
}
