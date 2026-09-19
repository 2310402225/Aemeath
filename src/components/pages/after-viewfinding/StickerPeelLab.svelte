<script lang="ts">
const stickers = [
	{
		id: "01",
		title: "物理",
		source: "LANYARD",
		image: "/images/home-stickers/pink-uniform.webp",
		accent: "#ff7ca8",
	},
	{
		id: "02",
		title: "撕纸",
		source: "STICKER PEEL",
		image: "/images/home-stickers/pink-cat.webp",
		accent: "#ffd166",
	},
	{
		id: "03",
		title: "版式",
		source: "BOC.STUDIO",
		image: "/images/home-stickers/blue-witch.webp",
		accent: "#72e6ff",
	},
	{
		id: "04",
		title: "空间",
		source: "DRIESSEN",
		image: "/images/home-stickers/white-haired-reader.webp",
		accent: "#b9a7ff",
	},
	{
		id: "05",
		title: "时间",
		source: "DIGITAL EPOCH",
		image: "/images/home-stickers/aqua-singer.webp",
		accent: "#7cf0c4",
	},
	{
		id: "06",
		title: "导航",
		source: "NOVA",
		image: "/images/home-stickers/brown-lightning.webp",
		accent: "#86a8ff",
	},
];

let progress = stickers.map(() => 0);
let peeled = stickers.map(() => false);
let draggingIndex: number | null = null;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };

$: unlocked = peeled.filter(Boolean).length;

function startPeel(index: number, event: PointerEvent) {
	draggingIndex = index;
	dragStart = { x: event.clientX, y: event.clientY };
	dragCurrent = { ...dragStart };
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function movePeel(index: number, event: PointerEvent) {
	if (draggingIndex !== index) return;
	dragCurrent = { x: event.clientX, y: event.clientY };
	const distance = Math.max(
		dragCurrent.x - dragStart.x,
		dragCurrent.y - dragStart.y,
	);
	progress[index] = Math.min(1, Math.max(0, distance / 82));
}

function finishPeel(index: number) {
	if (draggingIndex !== index) return;
	draggingIndex = null;
	progress[index] = progress[index] > 0.56 ? 1 : 0;
	peeled[index] = progress[index] === 1;
}

function togglePeel(index: number) {
	peeled[index] = !peeled[index];
	progress[index] = peeled[index] ? 1 : 0;
}

function reset() {
	progress = stickers.map(() => 0);
	peeled = stickers.map(() => false);
}
</script>

<div class="peel-lab">
	<div class="sticker-grid">
		{#each stickers as sticker, index}
			<button
				type="button"
				class="sticker"
				class:peeled={peeled[index]}
				style={`--accent:${sticker.accent}; --peel:${progress[index]};`}
				aria-label={`撕开${sticker.title}贴纸`}
				on:pointerdown={(event) => startPeel(index, event)}
				on:pointermove={(event) => movePeel(index, event)}
				on:pointerup={() => finishPeel(index)}
				on:pointercancel={() => finishPeel(index)}
				on:click={() => {
					if (draggingIndex === null && progress[index] < 0.1) togglePeel(index);
				}}
			>
				<span class="underlay">
					<strong>{sticker.title}</strong>
					<small>{sticker.source}</small>
				</span>
				<span class="skin">
					<img src={sticker.image} alt="" draggable="false" />
					<span class="skin-code">{sticker.id}</span>
				</span>
				<span class="peel-flap" aria-hidden="true"></span>
			</button>
		{/each}
	</div>
	<div class="peel-footer">
		<span>向斜下方拖动贴纸完成撕开</span>
		<div>
			<strong>{unlocked} / 6</strong>
			<button type="button" on:click={reset}>重新贴上</button>
		</div>
	</div>
</div>

<style>
	.peel-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.sticker-grid {
		display: grid;
		flex: 1;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.55rem;
	}

	.sticker {
		position: relative;
		min-height: 175px;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 9%);
		border-radius: 6px;
		background: #05101a;
		color: #eef9ff;
		font: inherit;
		touch-action: none;
		cursor: grab;
	}

	.sticker:active {
		cursor: grabbing;
	}

	.underlay,
	.skin {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

	.underlay {
		align-content: center;
		gap: 0.22rem;
		background:
			linear-gradient(rgb(0 0 0 / 20%), rgb(0 0 0 / 48%)),
			color-mix(in srgb, var(--accent) 18%, #06111b);
	}

	.underlay strong {
		font-size: 1rem;
	}

	.underlay small {
		color: color-mix(in srgb, var(--accent) 72%, #dcecf5);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.52rem;
		letter-spacing: 0.07em;
	}

	.skin {
		overflow: hidden;
		clip-path: polygon(
			0 0,
			calc(100% - var(--peel) * 82%) 0,
			100% calc(var(--peel) * 82%),
			100% 100%,
			0 100%
		);
		background: #0d1b26;
		transform-origin: top right;
		transition: clip-path 80ms linear;
	}

	.skin::after {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(135deg, transparent 45%, rgb(255 255 255 / 6%) 46%, transparent 53%),
			linear-gradient(transparent, rgb(3 10 16 / 72%));
		content: "";
	}

	.skin img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 15%;
	}

	.skin-code {
		position: absolute;
		z-index: 1;
		top: 0.55rem;
		left: 0.6rem;
		color: color-mix(in srgb, var(--accent) 80%, #fff);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.peel-flap {
		position: absolute;
		top: calc(var(--peel) * 70% - 28px);
		right: calc(var(--peel) * 70% - 28px);
		width: 58px;
		height: 58px;
		transform: rotate(45deg) scale(var(--peel));
		transform-origin: top right;
		border-radius: 6px 0 6px 0;
		background:
			linear-gradient(135deg, color-mix(in srgb, var(--accent) 75%, #fff), #eef9ff);
		box-shadow: -8px 8px 18px rgb(0 0 0 / 38%);
		opacity: calc(var(--peel) * 0.9);
		pointer-events: none;
	}

	.sticker.peeled {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
		box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.peel-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: #849bab;
		font-size: 0.65rem;
	}

	.peel-footer div {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.peel-footer strong {
		color: #eef9ff;
		font-family: "JetBrains Mono Variable", monospace;
	}

	.peel-footer button {
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 10%);
		border-radius: 4px;
		background: rgb(255 255 255 / 4%);
		color: #afc4d1;
		font: inherit;
		cursor: pointer;
	}

	@media (max-width: 640px) {
		.sticker-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.sticker {
			min-height: 145px;
		}
	}

	@media (max-width: 430px) {
		.peel-footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
