<script lang="ts">
import { onMount } from "svelte";

type Mode = "trace" | "field" | "signal";
type Particle = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	phase: number;
};

const modes: Array<{ id: Mode; label: string; hint: string }> = [
	{ id: "trace", label: "轨迹", hint: "记录经过" },
	{ id: "field", label: "磁场", hint: "形成吸引" },
	{ id: "signal", label: "信号", hint: "制造扰动" },
];

let canvas: HTMLCanvasElement;
let mode: Mode = "trace";
let speed = 1;
let force = 0.7;
let particles: Particle[] = [];
let pointer = { x: 0.5, y: 0.5, active: false };
let pulse = 0;
let animationFrame = 0;
let lastTime = 0;
let context: CanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let reducedMotion = false;

function seedParticles() {
	particles = Array.from({ length: 54 }, (_, index) => ({
		x: Math.random() * width,
		y: Math.random() * height,
		vx: (Math.random() - 0.5) * 0.5,
		vy: (Math.random() - 0.5) * 0.5,
		size: 0.7 + (index % 5) * 0.28,
		phase: Math.random() * Math.PI * 2,
	}));
}

function resizeCanvas() {
	if (!canvas) return;

	const rect = canvas.getBoundingClientRect();
	const ratio = Math.min(window.devicePixelRatio || 1, 2);
	width = Math.max(1, rect.width);
	height = Math.max(1, rect.height);
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context = canvas.getContext("2d");
	context?.setTransform(ratio, 0, 0, ratio, 0, 0);

	if (particles.length === 0) {
		seedParticles();
	}
}

function drawFrame(time: number, delta: number) {
	if (!context) return;

	const accent =
		mode === "trace" ? "#72e6ff" : mode === "field" ? "#7cf0c4" : "#ff7ca8";
	const targetX = pointer.x * width;
	const targetY = pointer.y * height;

	if (mode === "trace") {
		context.fillStyle = "rgba(4, 12, 20, 0.16)";
		context.fillRect(0, 0, width, height);
	} else {
		context.clearRect(0, 0, width, height);
	}

	for (const particle of particles) {
		const dx = targetX - particle.x;
		const dy = targetY - particle.y;
		const distance = Math.max(34, Math.hypot(dx, dy));
		const influence = pointer.active ? Math.min(1, 190 / distance) * force : 0;
		const drift = 0.028 * speed * delta;

		if (mode === "trace") {
			particle.vx += Math.cos(particle.phase + time * 0.00034) * drift;
			particle.vy += Math.sin(particle.phase + time * 0.00031) * drift;
			particle.vx += (dx / distance) * influence * 0.055 * delta;
			particle.vy += (dy / distance) * influence * 0.055 * delta;
		}

		if (mode === "field") {
			particle.vx += (dx / distance) * influence * 0.14 * delta;
			particle.vy += (dy / distance) * influence * 0.14 * delta;
			particle.vx *= 0.955;
			particle.vy *= 0.955;
		}

		if (mode === "signal") {
			particle.vx += (-dy / distance) * influence * 0.15 * delta;
			particle.vy += (dx / distance) * influence * 0.15 * delta;
			particle.vx += (dx / distance) * pulse * 0.55 * delta;
			particle.vy += (dy / distance) * pulse * 0.55 * delta;
			particle.vx *= 0.96;
			particle.vy *= 0.96;
		}

		particle.x += particle.vx * speed * delta;
		particle.y += particle.vy * speed * delta;

		if (particle.x < -20) particle.x = width + 20;
		if (particle.x > width + 20) particle.x = -20;
		if (particle.y < -20) particle.y = height + 20;
		if (particle.y > height + 20) particle.y = -20;

		context.beginPath();
		context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
		context.fillStyle = accent;
		context.globalAlpha = mode === "trace" ? 0.62 : 0.8;
		context.fill();
		context.globalAlpha = 1;
	}

	if (pointer.active) {
		context.beginPath();
		context.arc(targetX, targetY, 24 + pulse * 22, 0, Math.PI * 2);
		context.strokeStyle = accent;
		context.globalAlpha = 0.28;
		context.stroke();
		context.globalAlpha = 1;
	}

	pulse *= 0.9;
}

function animationLoop(time: number) {
	const delta = lastTime ? Math.min(2, (time - lastTime) / 16.67) : 1;
	lastTime = time;
	drawFrame(time, delta);
	animationFrame = requestAnimationFrame(animationLoop);
}

function updatePointer(event: PointerEvent) {
	const rect = canvas.getBoundingClientRect();
	pointer = {
		x: (event.clientX - rect.left) / rect.width,
		y: (event.clientY - rect.top) / rect.height,
		active: true,
	};
}

function createPulse(event: PointerEvent) {
	updatePointer(event);
	pulse = 1;
}

onMount(() => {
	reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	resizeCanvas();

	const observer = new ResizeObserver(() => {
		resizeCanvas();
		if (reducedMotion) drawFrame(0, 0);
	});
	observer.observe(canvas);

	if (!reducedMotion) {
		animationFrame = requestAnimationFrame(animationLoop);
	} else {
		drawFrame(0, 0);
	}

	return () => {
		cancelAnimationFrame(animationFrame);
		observer.disconnect();
	};
});
</script>

<div class="motion-lab">
	<div class="mode-row" role="group" aria-label="选择粒子动效模式">
		{#each modes as item}
			<button
				type="button"
				class:active={mode === item.id}
				on:click={() => (mode = item.id)}
			>
				<strong>{item.label}</strong>
				<span>{item.hint}</span>
			</button>
		{/each}
	</div>

	<div class="canvas-frame" class:trace={mode === "trace"}>
		<canvas
			bind:this={canvas}
			on:pointermove={updatePointer}
			on:pointerdown={createPulse}
			on:pointerleave={() => {
				pointer = { ...pointer, active: false };
			}}
			aria-label="粒子动效预览，移动指针改变粒子运行方向，点击产生一次脉冲"
		></canvas>
		<div class="canvas-label">
			<span>{mode.toUpperCase()}</span>
			<span>{pointer.active ? "信号已连接" : "移动指针接入"}</span>
		</div>
	</div>

	<div class="slider-row">
		<label>
			<span>速度</span>
			<input type="range" min="0.35" max="1.8" step="0.05" bind:value={speed} />
			<output>{speed.toFixed(2)}</output>
		</label>
		<label>
			<span>力度</span>
			<input type="range" min="0.1" max="1.4" step="0.05" bind:value={force} />
			<output>{force.toFixed(2)}</output>
		</label>
	</div>
</div>

<style>
	.motion-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
	}

	.mode-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.mode-row button {
		display: grid;
		gap: 0.1rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid rgb(255 255 255 / 9%);
		border-radius: 5px;
		background: rgb(255 255 255 / 3%);
		color: #91a8b8;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.mode-row button strong {
		color: #edf8ff;
		font-size: 0.78rem;
	}

	.mode-row button span {
		font-size: 0.62rem;
	}

	.mode-row button.active {
		border-color: #72e6ff;
		background: rgb(114 230 255 / 11%);
	}

	.mode-row button:nth-child(2).active {
		border-color: #7cf0c4;
		background: rgb(124 240 196 / 11%);
	}

	.mode-row button:nth-child(3).active {
		border-color: #ff7ca8;
		background: rgb(255 124 168 / 11%);
	}

	.canvas-frame {
		position: relative;
		min-height: 290px;
		flex: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			radial-gradient(circle at 50% 50%, rgb(114 230 255 / 8%), transparent 58%),
			#040c14;
	}

	.canvas-frame.trace {
		background: #040c14;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 290px;
		touch-action: pan-y;
	}

	.canvas-label {
		position: absolute;
		right: 0.7rem;
		bottom: 0.55rem;
		left: 0.7rem;
		display: flex;
		justify-content: space-between;
		color: #688192;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.56rem;
		pointer-events: none;
	}

	.slider-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.slider-row label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 2.3rem;
		gap: 0.5rem;
		align-items: center;
		color: #879fb0;
		font-size: 0.65rem;
	}

	.slider-row input {
		width: 100%;
		accent-color: #72e6ff;
	}

	.slider-row output {
		color: #d9e9f2;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.6rem;
		text-align: right;
	}

	@media (max-width: 560px) {
		.mode-row {
			grid-template-columns: 1fr;
		}

		.mode-row button {
			grid-template-columns: auto 1fr;
			gap: 0.6rem;
			align-items: baseline;
		}

		.mode-row button span {
			text-align: right;
		}

		.canvas-frame,
		canvas {
			min-height: 240px;
		}

		.slider-row {
			grid-template-columns: 1fr;
		}
	}
</style>
