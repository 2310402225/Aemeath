/**
 * 星核 · 三条正交发光环 + 一团彩色粒子核。
 *
 * 依旧不用 three：整场是「一个全屏柔光片元 + 几千个点精灵」，两个 program、五个 draw call，
 * 首屏只花几 KB 代码；three 那 ~170KB 留给点开才付账的 overlay 全息卡。
 *
 * 两个设计要点：
 * 1. 三个环的世界坐标在初始化时算一次 —— 「互相正交」是定死的几何，不该每帧重算；
 *    每帧只更新 uniform：每个环各有自己的「轨头角」，最亮的那一段绕着环跑。
 *    （均匀的圆环绕自身法线转是看不出来的，必须有个跑动的亮头才有"在转"的观感。）
 * 2. 粒子核的自转是刚体旋转（Rodrigues，全部粒子同一个角），涌动是各自相位的径向呼吸，
 *    两者叠加才不会看成「一坨在扭的噪点」。
 */

export interface StarFieldOptions {
	/** 色相（度）。六张卡各给一个，悬停时跟随 */
	hue: number;
	/** 0→1，悬停／展开时的强化量 */
	accent: number;
	/** 冻结时间（overlay 打开时用） */
	frozen: boolean;
}

export interface StarFieldHandle {
	/** 点一下星核：整体脉冲一次（环亮头加速冲刺 + 辉光胀开 + 粒子外扩） */
	pulse(): void;
	destroy(): void;
}

type Vec3 = readonly [number, number, number];
type Mat3 = readonly number[];

interface RingSpec {
	radius: number;
	/** 轨头角速度（弧度／秒）：有正有负才像各转各的 */
	speed: number;
	/** 相对 hue 的色相偏移（色环上的 0→1 比例） */
	hueOffset: number;
	/** 面内基向量；三个环的法线分别是 Z／X／Y，两两正交 */
	u: Vec3;
	v: Vec3;
}

/** 三个环：半径、转速、颜色都不同 —— 这是「三个半径不一样的环各转各的」的全部秘密 */
const RINGS: readonly RingSpec[] = [
	{ radius: 0.66, speed: 0.34, hueOffset: 0.0, u: [1, 0, 0], v: [0, 1, 0] },
	{ radius: 0.86, speed: -0.52, hueOffset: 0.14, u: [0, 1, 0], v: [0, 0, 1] },
	{ radius: 1.06, speed: 0.21, hueOffset: -0.12, u: [0, 0, 1], v: [1, 0, 0] },
];

/** 整束环的固定倾角：正交关系靠它保住，只把"正对镜头"这个倒霉角度转开。
 *  34°/42° 是试出来的：三个环的椭圆短长轴比落在 0.61 / 0.67 / 0.42，
 *  角度各不相同，「互相垂直」才看得出来。 */
const TILT_X = 34;
const TILT_Y = 42;

const RING_POINTS = 560;
const PARTICLE_COUNT = 800;
const CORE_RADIUS = 0.26;
/** 相机与焦距：定成让最外那个环（半径 1）投到画布半高的 ~0.7，外圈辉光还有余量 */
const CAM_Z = 3.2;
const FOCAL = 2.2;
/** 粒子核自转角速度（弧度／秒）→ 约 29 秒一圈 */
const SPIN_SPEED = 0.22;
const SPIN_AXIS: Vec3 = [0.16, 1, 0.22];

const REDUCED = "(prefers-reduced-motion: reduce)";

const VERT_QUAD = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** 全屏 pass：星核的柔和彩色辉光 + 一层极稀疏的星点（免得整块画布发空） */
const FRAG_GLOW = `
precision highp float;
uniform vec2 uRes;
uniform float uHue;
uniform float uAccent;
uniform float uPulse;

vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  float d = length(uv);
  vec3 warm = hsv2rgb(vec3(uHue / 360.0, 0.40, 1.0));
  vec3 cool = hsv2rgb(vec3(fract(uHue / 360.0 + 0.07), 0.26, 1.0));
  float r = 0.26 * (1.0 + 0.05 * uAccent + 0.16 * uPulse);
  // 辉光收紧一点：它太散会把粒子核糊成一团灰雾，颗粒感全没了
  float glow = exp(-max(d - r, 0.0) * (11.0 - 2.0 * uAccent));
  vec3 col = mix(warm, cool, 0.45) * glow * (0.16 + 0.11 * uAccent + 0.34 * uPulse);
  vec2 g = floor((gl_FragCoord.xy / uRes.y) * 210.0);
  float speck = step(0.9986, hash(vec3(g, 5.0)));
  col += cool * speck * smoothstep(0.06, 0.45, d) * 0.30;
  // 预乘输出：rgb 直接就是「要加上的亮度」，alpha 只负责压掉背后的底色。
  // 乘 2.4 是为了让 rgb ≤ alpha 成立（预乘画布的前提），否则部分实现会给出脏结果。
  float a = clamp(max(max(col.r, col.g), col.b) * 2.4, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** 环：世界坐标已烘好，这里只投影 + 按「离亮头多远」算亮度 */
const VERT_RING = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aMeta;
uniform vec2 uRes;
uniform float uCamZ;
uniform float uFocal;
uniform float uHead;
uniform float uSize;
uniform float uAlpha;
uniform float uPulse;
uniform vec3 uColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float cam = uCamZ - aPos.z;
  gl_Position = vec4(aPos.xy * (uFocal / cam), 0.0, 1.0);
  // 亮头后面拖一条指数尾，尾要够长（1.8）才读得出「整圈环」，不然就剩几段断弧
  float back = fract(aMeta.x - uHead);
  float tail = exp(-back * 1.8);
  float nose = exp(-(1.0 - back) * 22.0);
  float bright = 0.32 + tail + 0.6 * nose;
  float depth = clamp(0.5 + 0.5 * (aPos.z / 0.8), 0.0, 1.0);
  gl_PointSize = uSize * aMeta.y * (0.7 + 0.5 * tail) * (1.0 + 0.9 * uPulse)
    * (uFocal / cam) * uRes.y * 0.5;
  vColor = uColor * bright * (1.0 + 1.8 * uPulse);
  vAlpha = uAlpha * (0.40 + 0.60 * depth) * (0.55 + 0.75 * tail);
}
`;

/** 粒子核：径向呼吸（涌动）+ 切向湍流 + 整体刚体自转 */
const VERT_CORE = `
precision highp float;
attribute vec3 aPos;
attribute vec4 aSeed;
attribute float aSize;
uniform vec2 uRes;
uniform float uTime;
uniform float uCamZ;
uniform float uFocal;
uniform float uHue;
uniform float uAccent;
uniform float uPulse;
uniform float uSize;
uniform float uAlpha;
uniform float uSpin;
uniform vec3 uAxis;
varying vec3 vColor;
varying float vAlpha;

vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}
vec3 rodrigues(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(uAxis, v) * s + uAxis * dot(uAxis, v) * (1.0 - c);
}
void main() {
  float base = length(aPos);
  vec3 dir = aPos / max(base, 1e-5);
  // 两个不同频率的呼吸叠加：单频会看出「整颗一起胀缩」的机械感
  float surge = sin(uTime * (0.32 + aSeed.y) + aSeed.x * 6.2831) * 0.5
              + sin(uTime * 0.19 + aSeed.x * 12.566) * 0.28;
  vec3 p = dir * (base * (1.0 + 0.17 * surge) + 0.030 * uPulse);
  // 切向湍流：让粒子在球面上「流」起来，而不是只沿半径进出
  vec3 t = cross(dir, vec3(0.23, 0.97, 0.31));
  float tl = length(t);
  vec3 tang = tl > 1e-3 ? t / tl : vec3(0.0, 0.0, 1.0);
  p += tang * base * 0.22 * sin(uTime * (0.21 + aSeed.y * 0.6) + aSeed.x * 9.0);

  vec3 q = rodrigues(p, uSpin);
  float cam = uCamZ - q.z;
  gl_Position = vec4(q.xy * (uFocal / cam), 0.0, 1.0);
  float depth = clamp(0.5 + 0.5 * (q.z / 0.45), 0.0, 1.0);
  gl_PointSize = uSize * aSize * (1.0 + 0.30 * uPulse)
    * (uFocal / cam) * uRes.y * 0.5;
  vColor = hsv2rgb(vec3(fract(uHue / 360.0 + aSeed.z), 0.58, 1.0));
  vAlpha = uAlpha * aSeed.w * (1.0 + 0.35 * uAccent) * (0.30 + 0.70 * depth)
    * (0.55 + 0.45 * abs(surge));
}
`;

/** 点精灵的柔光贴片：环和粒子共用 */
const FRAG_POINT = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float f = exp(-d2 * 3.1) * (1.0 - smoothstep(0.72, 1.0, d2));
  if (f < 0.012) discard;
  // 预乘输出：亮度与覆盖率同源，才能被 (ONE, ONE) 直接加到一起
  float k = vAlpha * f;
  gl_FragColor = vec4(vColor * k, k);
}
`;

function rotX(deg: number): Mat3 {
	const c = Math.cos((deg * Math.PI) / 180);
	const s = Math.sin((deg * Math.PI) / 180);
	return [1, 0, 0, 0, c, -s, 0, s, c];
}

function rotY(deg: number): Mat3 {
	const c = Math.cos((deg * Math.PI) / 180);
	const s = Math.sin((deg * Math.PI) / 180);
	return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
	const out: number[] = [];
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 3; c++) {
			out.push(
				a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c],
			);
		}
	}
	return out;
}

function applyMat3(m: Mat3, p: Vec3): Vec3 {
	return [
		m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
		m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
		m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
	];
}

function hsv(hueDeg: number, sat: number, val: number): Vec3 {
	const h = (((hueDeg % 360) + 360) % 360) / 60;
	const c = val * sat;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const m = val - c;
	const t: Vec3 =
		h < 1
			? [c, x, 0]
			: h < 2
				? [x, c, 0]
				: h < 3
					? [0, c, x]
					: h < 4
						? [0, x, c]
						: h < 5
							? [x, 0, c]
							: [c, 0, x];
	return [t[0] + m, t[1] + m, t[2] + m];
}

/** 把三条环的顶点烘成世界坐标：几何是死的，只有亮头在动 */
function buildRings() {
	const tilt = mulMat3(rotY(TILT_Y), rotX(TILT_X));
	return RINGS.map((spec) => {
		const data = new Float32Array(RING_POINTS * 5);
		for (let i = 0; i < RING_POINTS; i++) {
			const a = (i / RING_POINTS) * Math.PI * 2;
			const lx = Math.cos(a) * spec.radius;
			const ly = Math.sin(a) * spec.radius;
			const local: Vec3 = [
				spec.u[0] * lx + spec.v[0] * ly,
				spec.u[1] * lx + spec.v[1] * ly,
				spec.u[2] * lx + spec.v[2] * ly,
			];
			const p = applyMat3(tilt, local);
			data[i * 5] = p[0];
			data[i * 5 + 1] = p[1];
			data[i * 5 + 2] = p[2];
			data[i * 5 + 3] = i / RING_POINTS;
			data[i * 5 + 4] = 0.82 + Math.random() * 0.36;
		}
		return { spec, data };
	});
}

function buildParticles() {
	const data = new Float32Array(PARTICLE_COUNT * 8);
	for (let i = 0; i < PARTICLE_COUNT; i++) {
		const u = Math.random() * 2 - 1;
		const phi = Math.random() * Math.PI * 2;
		const s = Math.sqrt(Math.max(0, 1 - u * u));
		// 半径偏到壳层：稀疏贴在球面上才看得到"一颗颗"，
		// 均匀填满球体的话投影后中心会糊成一片白
		const r = CORE_RADIUS * (0.76 + 0.24 * Math.sqrt(Math.random()));
		const o = i * 8;
		data[o] = s * Math.cos(phi) * r;
		data[o + 1] = u * r;
		data[o + 2] = s * Math.sin(phi) * r;
		data[o + 3] = Math.random();
		data[o + 4] = Math.random() * 0.5;
		// 色相偏移跨度约 ±45°："彩色"就是这么来的；再宽就加成一团白，整体也仍跟着卡走
		data[o + 5] = Math.random() * 0.22 - 0.09;
		// w 拿来当"这颗粒子有多亮"，aSize 才是尺寸 ——
		// 两者曾经错位一格（aSize 填了 0），结果是 gl_PointSize 恒为 0，整颗核一个点都没画出来
		data[o + 6] = 0.7 + Math.random() * 0.55;
		data[o + 7] = 0.7 + Math.random() * 0.6;
	}
	return data;
}

export function mountStarField(
	canvas: HTMLCanvasElement,
	read: () => StarFieldOptions,
): StarFieldHandle | null {
	const gl =
		(canvas.getContext("webgl", {
			alpha: true,
			antialias: false,
		}) as WebGLRenderingContext | null) ??
		(canvas.getContext("experimental-webgl", {
			alpha: true,
		}) as WebGLRenderingContext | null);
	if (!gl) return null;

	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	};

	const program = (vertSrc: string, fragSrc: string) => {
		const vs = compile(gl.VERTEX_SHADER, vertSrc);
		const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
		const p = gl.createProgram();
		if (!vs || !fs || !p) return null;
		gl.attachShader(p, vs);
		gl.attachShader(p, fs);
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
		return p;
	};

	const progGlow = program(VERT_QUAD, FRAG_GLOW);
	const progRing = program(VERT_RING, FRAG_POINT);
	const progCore = program(VERT_CORE, FRAG_POINT);
	if (!progGlow || !progRing || !progCore) return null;

	const locate = (p: WebGLProgram, names: readonly string[]) => {
		const out: Record<string, WebGLUniformLocation | null> = {};
		for (const name of names) out[name] = gl.getUniformLocation(p, name);
		return out;
	};

	const uGlow = locate(progGlow, ["uRes", "uHue", "uAccent", "uPulse"]);
	const uRing = locate(progRing, [
		"uRes",
		"uCamZ",
		"uFocal",
		"uHead",
		"uSize",
		"uAlpha",
		"uPulse",
		"uColor",
	]);
	const uCore = locate(progCore, [
		"uRes",
		"uTime",
		"uCamZ",
		"uFocal",
		"uHue",
		"uAccent",
		"uPulse",
		"uSize",
		"uAlpha",
		"uSpin",
		"uAxis",
	]);

	const quad = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, quad);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 3, -1, -1, 3]),
		gl.STATIC_DRAW,
	);

	const rings = buildRings().map((ring) => {
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, ring.data, gl.STATIC_DRAW);
		return { ...ring, buffer };
	});

	const coreBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, buildParticles(), gl.STATIC_DRAW);

	const coreSize = 0.03;
	const ringSize = 0.028;
	const coreAlpha = 0.65;
	const ringAlpha = 0.36;

	// 属性指针是全局状态（不跟着 program 走），所以每次 drawArrays 前都得重新绑一遍
	const bindAttribs = (
		p: WebGLProgram,
		stride: number,
		layout: readonly [string, number, number][],
	) => {
		for (const [name, size, offset] of layout) {
			const loc = gl.getAttribLocation(p, name);
			if (loc < 0) continue;
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
		}
	};

	const bindQuad = (p: WebGLProgram) => {
		const loc = gl.getAttribLocation(p, "aPos");
		if (loc < 0) return;
		gl.bindBuffer(gl.ARRAY_BUFFER, quad);
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
	};

	gl.enable(gl.BLEND);
	// 预乘画布 + 纯加色：着色器写出的 rgb 就是要加上的亮度。
	// 踩过的坑：premultipliedAlpha:false 配 (SRC_ALPHA, ONE) 时，画布 alpha 是按 Σa² 累积的，
	// 浏览器合成又要再乘一次 alpha → 整颗星核会暗到几乎看不见（0.24 → 0.014 那种量级）。
	gl.blendFunc(gl.ONE, gl.ONE);
	gl.disable(gl.DEPTH_TEST);
	gl.clearColor(0, 0, 0, 0);

	const reduced = window.matchMedia(REDUCED);
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	let width = 0;
	let height = 0;

	const resize = () => {
		const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
		const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
		if (w === width && h === height) return false;
		width = w;
		height = h;
		canvas.width = w;
		canvas.height = h;
		gl.viewport(0, 0, w, h);
		return true;
	};

	const heads = RINGS.map(() => Math.random());
	const axisLen = Math.hypot(SPIN_AXIS[0], SPIN_AXIS[1], SPIN_AXIS[2]);
	const axis: Vec3 = [
		SPIN_AXIS[0] / axisLen,
		SPIN_AXIS[1] / axisLen,
		SPIN_AXIS[2] / axisLen,
	];

	let innerHue = read().hue;
	let innerAccent = read().accent;
	let clock = 0;
	let spin = 0;
	/** 点击脉冲的能量与环的冲刺量，都按指数衰减回 0 */
	let energy = 0;
	let kick = 0;
	let last = 0;
	let raf = 0;

	// 用箭头函数而不是 function 声明：声明会被提升，TS 就不肯保留
	// 「if (!gl) return null」那次收窄，整个 render 里每一行都会报 gl 可能为 null。
	const render = (now: number) => {
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		resize();
		const opts = read();
		if (!opts.frozen) {
			clock += dt;
			spin += dt * SPIN_SPEED;
			for (let i = 0; i < heads.length; i++) {
				heads[i] += dt * RINGS[i].speed * (1 + 2.8 * kick);
			}
		}
		energy *= Math.exp(-dt * 3.0);
		kick *= Math.exp(-dt * 2.2);
		if (energy < 0.002) energy = 0;
		if (kick < 0.002) kick = 0;
		innerHue += (opts.hue - innerHue) * (opts.frozen ? 1 : 0.06);
		innerAccent += (opts.accent - innerAccent) * (opts.frozen ? 1 : 0.08);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const res = [width, height];
		gl.useProgram(progGlow);
		gl.uniform2f(uGlow.uRes, res[0], res[1]);
		gl.uniform1f(uGlow.uHue, innerHue);
		gl.uniform1f(uGlow.uAccent, innerAccent);
		gl.uniform1f(uGlow.uPulse, energy);
		bindQuad(progGlow);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		gl.useProgram(progCore);
		gl.uniform2f(uCore.uRes, res[0], res[1]);
		gl.uniform1f(uCore.uTime, clock);
		gl.uniform1f(uCore.uCamZ, CAM_Z);
		gl.uniform1f(uCore.uFocal, FOCAL);
		gl.uniform1f(uCore.uHue, innerHue);
		gl.uniform1f(uCore.uAccent, innerAccent);
		gl.uniform1f(uCore.uPulse, energy);
		gl.uniform1f(uCore.uSize, coreSize);
		gl.uniform1f(uCore.uAlpha, coreAlpha);
		gl.uniform1f(uCore.uSpin, spin);
		gl.uniform3f(uCore.uAxis, axis[0], axis[1], axis[2]);
		gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
		bindAttribs(progCore, 32, [
			["aPos", 3, 0],
			["aSeed", 4, 12],
			["aSize", 1, 28],
		]);
		gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);

		gl.useProgram(progRing);
		gl.uniform2f(uRing.uRes, res[0], res[1]);
		gl.uniform1f(uRing.uCamZ, CAM_Z);
		gl.uniform1f(uRing.uFocal, FOCAL);
		gl.uniform1f(uRing.uSize, ringSize);
		gl.uniform1f(uRing.uAlpha, ringAlpha);
		gl.uniform1f(uRing.uPulse, energy);
		for (let i = 0; i < rings.length; i++) {
			const color = hsv(innerHue + RINGS[i].hueOffset * 360, 0.42, 1);
			gl.uniform1f(uRing.uHead, heads[i]);
			gl.uniform3f(uRing.uColor, color[0], color[1], color[2]);
			gl.bindBuffer(gl.ARRAY_BUFFER, rings[i].buffer);
			bindAttribs(progRing, 20, [
				["aPos", 3, 0],
				["aMeta", 2, 12],
			]);
			gl.drawArrays(gl.POINTS, 0, RING_POINTS);
		}
	};

	const loop = (now: number) => {
		raf = requestAnimationFrame(loop);
		render(now);
	};

	last = performance.now();
	resize();
	gl.clear(gl.COLOR_BUFFER_BIT);
	// 一定先画一帧：reduced-motion 下不启循环，这一帧就是全部内容
	render(last);
	if (!reduced.matches) raf = requestAnimationFrame(loop);

	const onLost = (event: Event) => {
		event.preventDefault();
		cancelAnimationFrame(raf);
		raf = 0;
	};
	canvas.addEventListener("webglcontextlost", onLost);

	return {
		pulse() {
			energy = 1;
			kick = 1;
			if (raf) return; // 有循环时让循环自己衰减
			// 没有循环（reduced-motion）：用两次定时重绘把能量落回 0，做「闪一下」而不是「一直亮」
			render(performance.now());
			window.setTimeout(() => {
				energy = 0.35;
				render(performance.now());
			}, 130);
			window.setTimeout(() => {
				energy = 0;
				kick = 0;
				render(performance.now());
			}, 320);
		},
		destroy() {
			cancelAnimationFrame(raf);
			canvas.removeEventListener("webglcontextlost", onLost);
			for (const ring of rings) gl.deleteBuffer(ring.buffer);
			gl.deleteBuffer(coreBuffer);
			gl.deleteBuffer(quad);
			gl.deleteProgram(progGlow);
			gl.deleteProgram(progRing);
			gl.deleteProgram(progCore);
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		},
	};
}
