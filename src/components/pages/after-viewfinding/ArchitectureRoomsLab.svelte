<script lang="ts">
const rooms = [
	{
		id: "01",
		title: "入口",
		label: "ENTRY",
		detail: "先把收藏变成一条可以进入的路线。",
		accent: "#72e6ff",
		image: "/images/home-stickers/dark-haired-girl.webp",
	},
	{
		id: "02",
		title: "取景",
		label: "REFERENCE",
		detail: "只保留值得复刻的交互机制。",
		accent: "#ff7ca8",
		image: "/images/home-stickers/white-haired-reader.webp",
	},
	{
		id: "03",
		title: "拆解",
		label: "DISASSEMBLE",
		detail: "把动作、反馈和节奏拆成独立零件。",
		accent: "#ffd166",
		image: "/images/home-stickers/blue-witch.webp",
	},
	{
		id: "04",
		title: "重写",
		label: "REWRITE",
		detail: "换掉内容，只留下真正值得复刻的玩法。",
		accent: "#7cf0c4",
		image: "/images/home-stickers/aqua-singer.webp",
	},
	{
		id: "05",
		title: "验证",
		label: "TEST",
		detail: "触摸、键盘和减少动效模式都要走得通。",
		accent: "#b9a7ff",
		image: "/images/home-stickers/pink-cat.webp",
	},
	{
		id: "06",
		title: "发布",
		label: "PUBLISH",
		detail: "把玩法、来源和边界一起交给读者。",
		accent: "#86a8ff",
		image: "/images/home-stickers/bamboo-girl.webp",
	},
];

let active = 0;
let dragging = false;
let pointerStartY = 0;
let startActive = 0;

$: room = rooms[active];

function clampIndex(value: number) {
	return Math.min(rooms.length - 1, Math.max(0, value));
}

function go(delta: number) {
	active = clampIndex(active + delta);
}

function startDrag(event: PointerEvent) {
	dragging = true;
	pointerStartY = event.clientY;
	startActive = active;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
	if (!dragging) return;
	const distance = pointerStartY - event.clientY;
	active = clampIndex(startActive + Math.round(distance / 70));
}

function endDrag() {
	dragging = false;
}

function handleWheel(event: WheelEvent) {
	event.preventDefault();
	go(event.deltaY > 0 ? 1 : -1);
}
</script>

<div class="rooms-lab">
	<div
		class="room-stage"
		style={`--accent:${room.accent}; --position:${active};`}
		on:pointerdown={startDrag}
		on:pointermove={moveDrag}
		on:pointerup={endDrag}
		on:pointercancel={endDrag}
		on:wheel={handleWheel}
		role="application"
		tabindex="0"
		aria-label="空间漫游，上下拖动或滚轮切换房间"
	>
		<div class="room-grid" aria-hidden="true"></div>
		<div class="room-depth" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>

		{#key active}
			<div class="room-content">
				<div class="room-copy">
					<p>{room.label} / {room.id}</p>
					<h4>{room.title}</h4>
					<span>{room.detail}</span>
				</div>
				<div class="room-figure">
					<img src={room.image} alt="" draggable="false" />
				</div>
			</div>
		{/key}

		<div class="room-index" aria-hidden="true">
			{#each rooms as item, index}
				<span class:active={active === index}>{item.id}</span>
			{/each}
		</div>
	</div>

	<div class="room-controls">
		<label>
			<span>空间进度</span>
			<input type="range" min="0" max="5" step="1" bind:value={active} />
		</label>
		<div>
			<button type="button" on:click={() => go(-1)} disabled={active === 0}>
				后退
			</button>
			<button
				type="button"
				on:click={() => go(1)}
				disabled={active === rooms.length - 1}
			>
				前进
			</button>
		</div>
	</div>
</div>

<style>
	.rooms-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.room-stage {
		position: relative;
		min-height: 420px;
		flex: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background: #030a11;
		touch-action: none;
		cursor: ns-resize;
		outline: none;
	}

	.room-stage:focus-visible {
		border-color: var(--accent);
	}

	.room-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgb(255 255 255 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 4%) 1px, transparent 1px);
		background-size: 24px 24px;
		perspective: 520px;
	}

	.room-depth {
		position: absolute;
		inset: 8% 10%;
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
		transform: rotateX(calc((var(--position) - 2.5) * 2deg));
		transition:
			border-color 260ms ease,
			transform 360ms ease;
	}

	.room-depth span {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.room-depth span:nth-child(1) {
		inset: 9%;
	}

	.room-depth span:nth-child(2) {
		inset: 20%;
	}

	.room-depth span:nth-child(3) {
		inset: 32%;
		background: color-mix(in srgb, var(--accent) 4%, transparent);
	}

	.room-content {
		position: absolute;
		z-index: 2;
		inset: 0;
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(180px, 1.1fr);
		gap: 0.8rem;
		align-items: center;
		padding: 2rem;
		animation: room-enter 420ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.room-copy p {
		margin: 0 0 0.45rem;
		color: var(--accent);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.room-copy h4 {
		margin: 0;
		color: #f5fbff;
		font-size: clamp(2.1rem, 7vw, 4.8rem);
		line-height: 0.9;
	}

	.room-copy span {
		display: block;
		max-width: 25rem;
		margin-top: 0.85rem;
		color: #9db2c1;
		font-size: 0.78rem;
		line-height: 1.7;
	}

	.room-figure {
		position: relative;
		height: 310px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
		background: color-mix(in srgb, var(--accent) 5%, #07131d);
		box-shadow: 0 24px 60px rgb(0 0 0 / 36%);
	}

	.room-figure::after {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(90deg, transparent 48%, var(--accent) 50%, transparent 52%),
			linear-gradient(transparent 48%, var(--accent) 50%, transparent 52%);
		content: "";
		opacity: 0.16;
		pointer-events: none;
	}

	.room-figure img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 14%;
		filter: saturate(0.86) contrast(1.04);
	}

	.room-index {
		position: absolute;
		z-index: 3;
		right: 0.8rem;
		bottom: 0.65rem;
		display: flex;
		gap: 0.35rem;
		color: #5f788a;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.52rem;
	}

	.room-index span.active {
		color: var(--accent);
	}

	.room-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
	}

	.room-controls label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.55rem;
		align-items: center;
		color: #849bab;
		font-size: 0.65rem;
	}

	.room-controls input {
		width: 100%;
		accent-color: var(--accent, #72e6ff);
	}

	.room-controls div {
		display: flex;
		gap: 0.35rem;
	}

	.room-controls button {
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 10%);
		border-radius: 4px;
		background: rgb(255 255 255 / 4%);
		color: #afc4d1;
		font: inherit;
		font-size: 0.62rem;
		cursor: pointer;
	}

	.room-controls button:disabled {
		opacity: 0.38;
		cursor: default;
	}

	@keyframes room-enter {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.98);
		}

		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (max-width: 620px) {
		.room-content {
			grid-template-columns: 1fr;
			padding: 1.3rem;
		}

		.room-copy h4 {
			font-size: 2.5rem;
		}

		.room-figure {
			height: 180px;
		}

		.room-controls {
			grid-template-columns: 1fr;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.room-content {
			animation: none;
		}
	}
</style>
