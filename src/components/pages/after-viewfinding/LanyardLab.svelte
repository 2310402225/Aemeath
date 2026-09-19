<script lang="ts">
import { onMount } from "svelte";

let stage: HTMLDivElement;
let dragging = false;
let position = { x: 0, y: 150 };
let velocity = { x: 0, y: 0 };
let pointer = { x: 0, y: 0 };
let previousPointer = { x: 0, y: 0 };
let animationFrame = 0;
let lastTime = 0;
let width = 0;
let height = 0;
let reducedMotion = false;
let throwCount = 0;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function measure() {
	if (!stage) return;
	const rect = stage.getBoundingClientRect();
	width = rect.width;
	height = rect.height;
	position = {
		x: clamp(position.x || width / 2, 92, Math.max(92, width - 92)),
		y: clamp(position.y || 160, 92, Math.max(92, height - 92)),
	};
}

function pointerPosition(event: PointerEvent) {
	const rect = stage.getBoundingClientRect();
	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
	};
}

function startDrag(event: PointerEvent) {
	dragging = true;
	pointer = pointerPosition(event);
	previousPointer = pointer;
	velocity = { x: 0, y: 0 };
	stage.setPointerCapture(event.pointerId);
}

function drag(event: PointerEvent) {
	if (!dragging) return;
	pointer = pointerPosition(event);
	position = {
		x: clamp(pointer.x, 92, width - 92),
		y: clamp(pointer.y, 92, height - 92),
	};
	velocity = {
		x: (pointer.x - previousPointer.x) * 0.72,
		y: (pointer.y - previousPointer.y) * 0.72,
	};
	previousPointer = pointer;
}

function endDrag() {
	if (!dragging) return;
	dragging = false;
	velocity = {
		x: clamp(velocity.x, -34, 34),
		y: clamp(velocity.y, -34, 34),
	};
	throwCount += 1;
}

function reset() {
	position = { x: width / 2, y: Math.min(170, height * 0.42) };
	velocity = { x: 0, y: 0 };
	dragging = false;
}

function frame(time: number) {
	const delta = lastTime ? Math.min(2, (time - lastTime) / 16.67) : 1;
	lastTime = time;

	if (!dragging) {
		const anchor = { x: width / 2, y: 16 };
		const dx = anchor.x - position.x;
		const dy = position.y - anchor.y;
		const distance = Math.max(1, Math.hypot(dx, dy));
		const ropeLength = Math.min(165, height * 0.48);
		const stretch = Math.max(0, distance - ropeLength);

		velocity.x += (dx / distance) * stretch * 0.0017 * delta;
		velocity.y += 0.34 * delta + (-dy / distance) * stretch * 0.0012 * delta;
		velocity.x *= 0.992;
		velocity.y *= 0.992;
		position.x += velocity.x * delta;
		position.y += velocity.y * delta;

		const bounce = 0.58;
		if (position.x < 92) {
			position.x = 92;
			velocity.x = Math.abs(velocity.x) * bounce;
		}
		if (position.x > width - 92) {
			position.x = width - 92;
			velocity.x = -Math.abs(velocity.x) * bounce;
		}
		if (position.y < 92) {
			position.y = 92;
			velocity.y = Math.abs(velocity.y) * bounce;
		}
		if (position.y > height - 92) {
			position.y = height - 92;
			velocity.y = -Math.abs(velocity.y) * bounce;
		}
	}

	if (!reducedMotion) {
		animationFrame = requestAnimationFrame(frame);
	}
}

onMount(() => {
	reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	measure();
	position = { x: width / 2, y: Math.min(170, height * 0.42) };

	const observer = new ResizeObserver(measure);
	observer.observe(stage);
	if (!reducedMotion) animationFrame = requestAnimationFrame(frame);

	return () => {
		cancelAnimationFrame(animationFrame);
		observer.disconnect();
	};
});

$: ropePath = `M ${width / 2} 16 Q ${(width / 2 + position.x) / 2 + velocity.x * 2} ${
	(position.y + 16) / 2
} ${position.x} ${position.y}`;
</script>

<div class="lanyard-lab">
	<div
		class="lanyard-stage"
		bind:this={stage}
		on:pointerdown={startDrag}
		on:pointermove={drag}
		on:pointerup={endDrag}
		on:pointercancel={endDrag}
		role="application"
		tabindex="0"
		aria-label="可拖拽的 3D 工牌挂绳，按住工牌拖动或甩出"
	>
		<div class="stage-grid" aria-hidden="true"></div>
		<svg class="rope" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
			<path d={ropePath}></path>
		</svg>
		<div class="anchor" aria-hidden="true"><span></span></div>
		<div
			class="badge"
			class:dragging
			style={`left:${position.x}px; top:${position.y}px;`}
			aria-hidden="true"
		>
			<div class="badge-hole"></div>
			<img src="/images/home-stickers/pink-uniform.webp" alt="" draggable="false" />
			<div class="badge-copy">
				<span>INTERACTION PASS</span>
				<strong>千咲 / 06</strong>
				<small>HOLD · THROW · RETURN</small>
			</div>
		</div>
		<div class="lab-readout">
			<span>{dragging ? "GRABBED" : "PHYSICS IDLE"}</span>
			<span>THROWS / {String(throwCount).padStart(2, "0")}</span>
		</div>
	</div>
	<div class="lab-actions">
		<span>按住工牌拖动，松手后可抛掷</span>
		<button type="button" on:click={reset}>回到起点</button>
	</div>
</div>

<style>
	.lanyard-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.lanyard-stage {
		position: relative;
		min-height: 430px;
		flex: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			radial-gradient(circle at 50% 0%, rgb(255 124 168 / 10%), transparent 42%),
			#040c14;
		touch-action: none;
		cursor: grab;
		outline: none;
	}

	.lanyard-stage:active {
		cursor: grabbing;
	}

	.lanyard-stage:focus-visible {
		border-color: #ff7ca8;
		box-shadow: 0 0 0 2px rgb(255 124 168 / 28%);
	}

	.stage-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgb(114 230 255 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(114 230 255 / 4%) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	.rope {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	.rope path {
		fill: none;
		stroke: #ff7ca8;
		stroke-width: 2;
		filter: drop-shadow(0 0 6px rgb(255 124 168 / 54%));
	}

	.anchor {
		position: absolute;
		top: 5px;
		left: 50%;
		display: grid;
		width: 26px;
		height: 26px;
		transform: translateX(-50%);
		place-items: center;
		border: 1px solid #ff7ca8;
		border-radius: 50%;
		background: #08131d;
	}

	.anchor span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ffd166;
		box-shadow: 0 0 10px #ffd166;
	}

	.badge {
		position: absolute;
		width: 184px;
		transform: translate(-50%, -50%) rotate(calc(var(--throw, 0) * 1deg));
		border: 1px solid rgb(114 230 255 / 42%);
		border-radius: 12px 12px 7px 7px;
		background: #081722;
		box-shadow:
			0 20px 50px rgb(0 0 0 / 44%),
			0 0 24px rgb(114 230 255 / 10%);
		pointer-events: none;
		user-select: none;
	}

	.badge.dragging {
		filter: drop-shadow(0 0 18px rgb(114 230 255 / 24%));
	}

	.badge-hole {
		width: 54px;
		height: 9px;
		margin: 0.55rem auto 0.35rem;
		border: 1px solid #405969;
		border-radius: 999px;
		background: #03090f;
	}

	.badge img {
		display: block;
		width: calc(100% - 1rem);
		height: 150px;
		margin: 0 0.5rem;
		border-radius: 5px;
		object-fit: cover;
		object-position: center 16%;
		background: #0c1b27;
	}

	.badge-copy {
		display: grid;
		gap: 0.15rem;
		padding: 0.55rem 0.65rem 0.65rem;
	}

	.badge-copy span,
	.badge-copy small {
		color: #7892a4;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.5rem;
	}

	.badge-copy strong {
		color: #eef9ff;
		font-size: 0.82rem;
	}

	.lab-readout {
		position: absolute;
		right: 0.7rem;
		bottom: 0.55rem;
		left: 0.7rem;
		display: flex;
		justify-content: space-between;
		color: #6f899b;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.55rem;
		pointer-events: none;
	}

	.lab-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: #849bab;
		font-size: 0.65rem;
	}

	.lab-actions button {
		padding: 0.45rem 0.65rem;
		border: 1px solid rgb(255 124 168 / 28%);
		border-radius: 4px;
		background: rgb(255 124 168 / 8%);
		color: #ffd7e4;
		font: inherit;
		cursor: pointer;
	}

	@media (max-width: 560px) {
		.lanyard-stage {
			min-height: 390px;
		}

		.badge {
			width: 158px;
		}

		.badge img {
			height: 126px;
		}
	}
</style>
