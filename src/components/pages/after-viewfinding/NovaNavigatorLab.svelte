<script lang="ts">
import { onMount } from "svelte";

type Star = { x: number; y: number; size: number; speed: number };
type Obstacle = {
	x: number;
	y: number;
	radius: number;
	speed: number;
	passed: boolean;
};

let canvas: HTMLCanvasElement;
let context: CanvasRenderingContext2D | null = null;
let progress = 0;
let throttle = 1;
let status = "等待启动";
let hitCount = 0;
let width = 0;
let height = 0;
let ratio = 1;
let animationFrame = 0;
let lastTime = 0;
let pointerY = 0.5;
let targetY = 0.5;
let shipY = 0.5;
let shipVelocity = 0;
let stars: Star[] = [];
let obstacles: Obstacle[] = [];
let reducedMotion = false;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function seedStars() {
	stars = Array.from({ length: 72 }, () => ({
		x: Math.random() * width,
		y: Math.random() * height,
		size: 0.5 + Math.random() * 2.1,
		speed: 0.35 + Math.random() * 1.9,
	}));
}

function spawnObstacle(initial = false) {
	const radius = 13 + Math.random() * 20;
	obstacles.push({
		x: initial
			? Math.random() * width * 0.72 + width * 0.36
			: width + radius + 20,
		y: radius + Math.random() * Math.max(1, height - radius * 2),
		radius,
		speed: 0.7 + Math.random() * 0.8,
		passed: false,
	});
}

function resize() {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	ratio = Math.min(window.devicePixelRatio || 1, 2);
	width = Math.max(1, rect.width);
	height = Math.max(1, rect.height);
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	context = canvas.getContext("2d");
	context?.setTransform(ratio, 0, 0, ratio, 0, 0);
	if (stars.length === 0) seedStars();
}

function resetMission() {
	progress = 0;
	throttle = 1;
	status = "航行中";
	hitCount = 0;
	obstacles = [];
	for (let index = 0; index < 6; index += 1) spawnObstacle(true);
}

function handlePointer(event: PointerEvent) {
	const rect = canvas.getBoundingClientRect();
	pointerY = (event.clientY - rect.top) / rect.height;
	targetY = clamp(pointerY, 0.08, 0.92);
}

function handleWheel(event: WheelEvent) {
	event.preventDefault();
	throttle = clamp(throttle + (event.deltaY > 0 ? 0.12 : -0.12), 0.45, 1.8);
}

function gameLoop(time: number) {
	const delta = lastTime ? Math.min(2, (time - lastTime) / 16.67) : 1;
	lastTime = time;

	if (!context) return;
	context.clearRect(0, 0, width, height);

	context.fillStyle = "#030913";
	context.fillRect(0, 0, width, height);

	for (const star of stars) {
		star.x -= star.speed * throttle * delta * 0.72;
		if (star.x < -4) {
			star.x = width + 4;
			star.y = Math.random() * height;
		}
		context.beginPath();
		context.arc(star.x, star.y, star.size, 0, Math.PI * 2);
		context.fillStyle = `rgba(114, 230, 255, ${0.2 + star.size * 0.12})`;
		context.fill();
	}

	const acceleration = (targetY - shipY) * 0.015;
	shipVelocity = (shipVelocity + acceleration * delta) * 0.91;
	shipY = clamp(shipY + shipVelocity * delta, 0.08, 0.92);

	for (const obstacle of obstacles) {
		obstacle.x -= obstacle.speed * throttle * delta * 2.3;
		const shipX = width * 0.22;
		const dx = obstacle.x - shipX;
		const dy = obstacle.y - shipY * height;
		const hitDistance = obstacle.radius + 17;

		if (Math.hypot(dx, dy) < hitDistance) {
			progress = Math.max(0, progress - 0.1);
			hitCount += 1;
			status = "碰撞，重新校准";
			obstacle.x = width + obstacle.radius + 40;
			obstacle.y =
				obstacle.radius +
				Math.random() * Math.max(1, height - obstacle.radius * 2);
			continue;
		}

		if (!obstacle.passed && obstacle.x < shipX - obstacle.radius) {
			obstacle.passed = true;
			progress = clamp(progress + 0.035, 0, 1);
		}

		if (obstacle.x < -obstacle.radius - 20) {
			obstacle.x = width + obstacle.radius + 20;
			obstacle.y =
				obstacle.radius +
				Math.random() * Math.max(1, height - obstacle.radius * 2);
			obstacle.passed = false;
		}

		context.beginPath();
		context.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
		context.fillStyle = "rgba(255, 124, 168, 0.12)";
		context.strokeStyle = "#ff7ca8";
		context.lineWidth = 1.2;
		context.fill();
		context.stroke();
	}

	progress = clamp(progress + throttle * 0.00075 * delta, 0, 1);
	if (progress >= 1) {
		status = "已抵达 X-06";
		throttle = Math.min(throttle, 0.55);
	} else if (status !== "碰撞，重新校准") {
		status = "航行中";
	}

	const shipX = width * 0.22;
	const y = shipY * height;
	context.save();
	context.translate(shipX, y);
	context.beginPath();
	context.moveTo(24, 0);
	context.lineTo(-12, -9);
	context.lineTo(-6, 0);
	context.lineTo(-12, 9);
	context.closePath();
	context.fillStyle = "#72e6ff";
	context.shadowColor = "#72e6ff";
	context.shadowBlur = 14;
	context.fill();
	context.restore();

	context.fillStyle = "rgba(114, 230, 255, 0.16)";
	context.fillRect(width * 0.22 - 1, 0, 1, height);

	if (!reducedMotion) animationFrame = requestAnimationFrame(gameLoop);
}

onMount(() => {
	reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	resize();
	resetMission();
	status = "等待启动";

	const observer = new ResizeObserver(() => {
		resize();
		if (reducedMotion) {
			gameLoop(0);
		}
	});
	observer.observe(canvas);
	canvas.addEventListener("wheel", handleWheel, { passive: false });

	if (!reducedMotion) animationFrame = requestAnimationFrame(gameLoop);

	return () => {
		cancelAnimationFrame(animationFrame);
		observer.disconnect();
		canvas.removeEventListener("wheel", handleWheel);
	};
});
</script>

<div class="nova-lab">
	<div class="mission-head">
		<div>
			<span>MISSION / X-06</span>
			<strong>{status}</strong>
		</div>
		<div>
			<span>DISTANCE</span>
			<strong>{Math.round(progress * 100)}%</strong>
		</div>
		<div>
			<span>COLLISIONS</span>
			<strong>{String(hitCount).padStart(2, "0")}</strong>
		</div>
	</div>

	<div class="nova-stage">
		<canvas
			bind:this={canvas}
			on:pointermove={handlePointer}
			on:pointerdown={handlePointer}
			on:pointerleave={() => {
				targetY = 0.5;
			}}
			aria-label="太空导航小游戏，移动指针控制飞船高度，滚轮或滑块控制速度"
		></canvas>
		<div class="mission-progress" style={`--progress:${progress * 100}%`}>
			<span></span>
		</div>
	</div>

	<div class="nova-controls">
		<label>
			<span>推进速度</span>
			<input type="range" min="0.45" max="1.8" step="0.05" bind:value={throttle} />
			<output>{throttle.toFixed(2)}</output>
		</label>
		<button type="button" on:click={resetMission}>
			{progress >= 1 ? "再次出发" : "重新校准"}
		</button>
	</div>
</div>

<style>
	.nova-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.mission-head {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.7rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid rgb(114 230 255 / 14%);
		border-radius: 5px;
		background: rgb(6 17 27 / 78%);
	}

	.mission-head div {
		display: grid;
		gap: 0.12rem;
	}

	.mission-head span {
		color: #657f91;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.48rem;
	}

	.mission-head strong {
		color: #d9edf7;
		font-size: 0.68rem;
	}

	.mission-head div:first-child strong {
		color: #72e6ff;
	}

	.nova-stage {
		position: relative;
		min-height: 360px;
		flex: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background: #030913;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 360px;
		touch-action: none;
		cursor: crosshair;
	}

	.mission-progress {
		position: absolute;
		right: 0.8rem;
		bottom: 0.65rem;
		left: 0.8rem;
		height: 0.24rem;
		overflow: hidden;
		border-radius: 999px;
		background: #1b3343;
		pointer-events: none;
	}

	.mission-progress span {
		display: block;
		width: var(--progress);
		height: 100%;
		border-radius: inherit;
		background: #72e6ff;
		box-shadow: 0 0 12px #72e6ff;
	}

	.nova-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
	}

	.nova-controls label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 2.3rem;
		gap: 0.5rem;
		align-items: center;
		color: #849bab;
		font-size: 0.65rem;
	}

	.nova-controls input {
		width: 100%;
		accent-color: #72e6ff;
	}

	.nova-controls output {
		color: #d9e9f2;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.6rem;
	}

	.nova-controls button {
		padding: 0.45rem 0.65rem;
		border: 1px solid rgb(114 230 255 / 26%);
		border-radius: 4px;
		background: rgb(114 230 255 / 8%);
		color: #ccefff;
		font: inherit;
		font-size: 0.64rem;
		cursor: pointer;
	}

	@media (max-width: 620px) {
		.mission-head {
			grid-template-columns: 1fr auto;
		}

		.mission-head div:nth-child(2) {
			display: none;
		}

		.nova-stage,
		canvas {
			min-height: 310px;
		}

		.nova-controls {
			grid-template-columns: 1fr;
		}
	}
</style>
