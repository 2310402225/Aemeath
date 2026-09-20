<script lang="ts">
/**
 * 轨道中心的星核。
 *
 * 故意不用 three：首屏只需要一个全屏片元着色器（约 2KB），而 three 要 ~170KB。
 * three 留给 overlay 里的真·全息卡 —— 那是点开才付的账。
 *
 * 着色器做的是 SDF 球面求交 + 两层 fbm 扰动当星云表面 + fresnel 边缘光，
 * 再用加色混合把光晕糊到页面背景上（所以 canvas 本身是透明的）。
 */
import { onMount } from "svelte";

interface Props {
	/** 色相（度）。六张卡各给一个，悬停时跟随 */
	hue?: number;
	/** 0→1，悬停／展开时的强化量 */
	accent?: number;
	/** 冻结时间，供 prefers-reduced-motion 使用 */
	frozen?: boolean;
}

let { hue = 200, accent = 0, frozen = false }: Props = $props();

let canvas: HTMLCanvasElement | undefined = $state();
let fallback = $state(false);

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uHue;
uniform float uAccent;

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
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float dist = length(uv);

  vec3 ro = vec3(0.0, 0.0, 2.6);
  vec3 rd = normalize(vec3(uv, -1.0));
  float radius = 1.0 + uAccent * 0.035;

  float b = dot(ro, rd);
  float h = b * b - (dot(ro, ro) - radius * radius);

  vec3 deep = hsv2rgb(vec3(uHue / 360.0, 0.62, 0.10));
  vec3 mid  = hsv2rgb(vec3(fract(uHue / 360.0 + 0.030), 0.55, 0.60));
  vec3 hot  = hsv2rgb(vec3(fract(uHue / 360.0 + 0.085), 0.28, 1.00));

  vec3 col = vec3(0.0);
  if (h > 0.0) {
    vec3 p = ro + rd * (-b - sqrt(h));
    vec3 n = normalize(p);
    float f1 = fbm(n * 2.4 + vec3(0.0, uTime * 0.05, uTime * 0.02));
    float f2 = fbm(n * 5.6 - vec3(uTime * 0.07));
    col = mix(deep, mid, smoothstep(0.24, 0.78, f1));
    col = mix(col, hot, smoothstep(0.60, 0.96, f2) * 0.85);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.3);
    col += hot * rim * (0.50 + uAccent * 0.85);
    col *= 1.0 - 0.28 * max(0.0, -n.y);
  }

  float halo = exp(-max(dist - radius * 0.82, 0.0) * 3.6);
  col += mix(mid, hot, 0.35) * halo * (0.30 + uAccent * 0.55);

  // 稀疏星点：只落在球体轮廓附近，免得整块画布发脏
  vec2 grid = floor(uv * 190.0);
  float speck = step(0.9975, hash(vec3(grid, 3.0)));
  col += hot * speck * smoothstep(0.05, 0.4, dist) * 0.9;

  float alpha = clamp(max(max(col.r, col.g), col.b) * 1.35, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

onMount(() => {
	const element = canvas;
	if (!element) return;

	const gl =
		(element.getContext("webgl", {
			alpha: true,
			antialias: false,
			premultipliedAlpha: false,
		}) as WebGLRenderingContext | null) ??
		(element.getContext("experimental-webgl", {
			alpha: true,
		}) as WebGLRenderingContext | null);
	if (!gl) {
		fallback = true;
		return;
	}

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

	const vertexShader = compile(gl.VERTEX_SHADER, VERT);
	const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
	const program = gl.createProgram();
	if (!vertexShader || !fragmentShader || !program) {
		fallback = true;
		return;
	}
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		fallback = true;
		return;
	}
	gl.useProgram(program);

	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 3, -1, -1, 3]),
		gl.STATIC_DRAW,
	);
	const aPos = gl.getAttribLocation(program, "aPos");
	gl.enableVertexAttribArray(aPos);
	gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

	const uRes = gl.getUniformLocation(program, "uRes");
	const uTime = gl.getUniformLocation(program, "uTime");
	const uHue = gl.getUniformLocation(program, "uHue");
	const uAccent = gl.getUniformLocation(program, "uAccent");

	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
	gl.clearColor(0, 0, 0, 0);

	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	let width = 0;
	let height = 0;

	const size = () => {
		const w = Math.max(1, Math.round(element.clientWidth * dpr));
		const h = Math.max(1, Math.round(element.clientHeight * dpr));
		if (w === width && h === height) return;
		width = w;
		height = h;
		element.width = w;
		element.height = h;
		gl.viewport(0, 0, w, h);
		gl.uniform2f(uRes, w, h);
	};

	let innerHue = hue;
	let innerAccent = accent;
	let clock = 0;
	let last = performance.now();
	let raf = 0;

	const frame = (now: number) => {
		raf = requestAnimationFrame(frame);
		const dt = Math.min((now - last) / 1000, 0.05);
		last = now;
		if (!frozen) clock += dt;
		size();
		// 悬停换色要滑过去，硬切会很跳
		innerHue += (hue - innerHue) * (frozen ? 1 : 0.06);
		innerAccent += (accent - innerAccent) * (frozen ? 1 : 0.08);
		gl.uniform1f(uTime, clock);
		gl.uniform1f(uHue, innerHue);
		gl.uniform1f(uAccent, innerAccent);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};
	raf = requestAnimationFrame(frame);

	return () => {
		cancelAnimationFrame(raf);
		gl.deleteBuffer(buffer);
		gl.deleteProgram(program);
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		const lose = gl.getExtension("WEBGL_lose_context");
		lose?.loseContext();
	};
});
</script>

<canvas
	bind:this={canvas}
	class="star-sphere"
	class:star-sphere--fallback={fallback}
	style:--sphere-hue="{hue}"
	aria-hidden="true"
></canvas>

<style>
	.star-sphere {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* 没有 WebGL 时退回一颗静态渐变球：不发光，但位置与体积一样 */
	.star-sphere--fallback {
		border-radius: 50%;
		background: radial-gradient(
			circle at 38% 34%,
			hsl(var(--sphere-hue) 30% 88% / 0.92) 0%,
			hsl(var(--sphere-hue) 42% 58% / 0.6) 38%,
			hsl(var(--sphere-hue) 55% 22% / 0.35) 68%,
			transparent 76%
		);
		filter: blur(0.4px);
	}
</style>
