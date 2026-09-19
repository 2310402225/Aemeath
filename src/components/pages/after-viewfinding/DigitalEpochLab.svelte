<script lang="ts">
const eras = [
	{
		label: "INK",
		title: "纸上时代",
		detail: "结构先落在纸面，版式依靠留白建立秩序。",
		accent: "#f5efe2",
		background: "#1c1712",
		filter: "sepia(0.28) contrast(0.94)",
		font: "LXGW WenKai Screen",
	},
	{
		label: "CRT",
		title: "屏幕时代",
		detail: "像素、扫描线和短促反馈开始进入网页。",
		accent: "#7cf0c4",
		background: "#071711",
		filter: "contrast(1.18) saturate(0.84)",
		font: "JetBrains Mono Variable",
	},
	{
		label: "GLASS",
		title: "玻璃时代",
		detail: "层级变得透明，内容在模糊与折射之间浮起。",
		accent: "#72e6ff",
		background: "#071521",
		filter: "contrast(1.04) saturate(1.08)",
		font: "sans-serif",
	},
	{
		label: "NEON",
		title: "霓虹时代",
		detail: "高饱和色彩让板块开始像夜间城市一样发光。",
		accent: "#ff7ca8",
		background: "#160817",
		filter: "contrast(1.12) saturate(1.35)",
		font: "JetBrains Mono Variable",
	},
	{
		label: "STAR",
		title: "星海时代",
		detail: "角色、空间和运动合成一段更完整的体验。",
		accent: "#b9a7ff",
		background: "#090b20",
		filter: "contrast(1.08) saturate(1.22)",
		font: "sans-serif",
	},
];

let progress = 0;
let active = 0;

$: era = eras[Math.round(progress)];
$: active = Math.round(progress);

function choose(index: number) {
	active = index;
	progress = index;
}
</script>

<div class="epoch-lab">
	<div
		class="epoch-stage"
		style={`--accent:${era.accent}; --epoch:${progress}; --epoch-bg:${era.background}; --epoch-filter:${era.filter}; --epoch-font:${era.font};`}
	>
		<div class="epoch-grid" aria-hidden="true"></div>
		<div class="epoch-orbit" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>

		<div class="epoch-copy">
			<div class="epoch-label">
				<span>ERA / {String(active + 1).padStart(2, "0")}</span>
				<strong>{era.label}</strong>
			</div>
			<h4>{era.title}</h4>
			<p>{era.detail}</p>
		</div>

		<div class="epoch-portrait">
			<img
				src="/assets/images/home-truncated/character-03.webp"
				alt=""
				draggable="false"
			/>
		</div>

		<div class="epoch-type" aria-hidden="true">SIX<br />PLAYABLE<br />STUDIES</div>
	</div>

	<div class="epoch-controls">
		<label>
			<span>拖动时间刻度</span>
			<input type="range" min="0" max="4" step="0.01" bind:value={progress} />
		</label>
		<div role="group" aria-label="选择时代">
			{#each eras as item, index}
				<button
					type="button"
					class:active={active === index}
					on:click={() => choose(index)}
				>
					{item.label}
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.epoch-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.epoch-stage {
		position: relative;
		min-height: 430px;
		flex: 1;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);
		border-radius: 6px;
		background: var(--epoch-bg);
		color: #f5fbff;
		transition:
			background 360ms ease,
			border-color 360ms ease;
	}

	.epoch-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(color-mix(in srgb, var(--accent) 8%, transparent) 1px, transparent 1px),
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--accent) 8%, transparent) 1px,
				transparent 1px
			);
		background-size: 26px 26px;
	}

	.epoch-orbit {
		position: absolute;
		inset: 12% 7%;
		border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
		border-radius: calc((4 - var(--epoch, 0)) * 12px + 58px);
		transform: rotate(calc((var(--epoch, 0) - 2) * 5deg));
		transition:
			border-color 300ms ease,
			transform 360ms ease;
	}

	.epoch-orbit span {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.epoch-orbit span:nth-child(1) {
		inset: 8%;
		border-radius: 50%;
	}

	.epoch-orbit span:nth-child(2) {
		top: 14%;
		right: 10%;
		width: 18%;
		aspect-ratio: 1;
		transform: rotate(45deg);
	}

	.epoch-orbit span:nth-child(3) {
		bottom: 10%;
		left: 14%;
		width: 34%;
		height: 1px;
		background: var(--accent);
	}

	.epoch-copy {
		position: absolute;
		z-index: 3;
		top: 1.5rem;
		left: 1.5rem;
		max-width: 22rem;
	}

	.epoch-label {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		color: var(--accent);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.epoch-label strong {
		font-size: 0.78rem;
	}

	.epoch-copy h4 {
		margin: 0.55rem 0 0;
		font-family: var(--epoch-font);
		font-size: clamp(2.2rem, 7vw, 4.7rem);
		line-height: 0.95;
	}

	.epoch-copy p {
		max-width: 20rem;
		margin: 0.75rem 0 0;
		color: color-mix(in srgb, var(--accent) 52%, #a7bac7);
		font-size: 0.76rem;
		line-height: 1.7;
	}

	.epoch-portrait {
		position: absolute;
		z-index: 2;
		right: 5%;
		bottom: -3%;
		width: min(52%, 360px);
		height: 92%;
	}

	.epoch-portrait img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: center bottom;
		filter: var(--epoch-filter);
		transition: filter 360ms ease;
	}

	.epoch-type {
		position: absolute;
		right: -1%;
		bottom: -0.6rem;
		color: color-mix(in srgb, var(--accent) 16%, transparent);
		font-size: clamp(3rem, 8vw, 6rem);
		font-weight: 850;
		line-height: 0.8;
		text-align: right;
		pointer-events: none;
	}

	.epoch-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.7rem;
		align-items: center;
	}

	.epoch-controls label {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.55rem;
		align-items: center;
		color: #849bab;
		font-size: 0.65rem;
	}

	.epoch-controls input {
		width: 100%;
		accent-color: var(--accent, #72e6ff);
	}

	.epoch-controls div {
		display: flex;
		gap: 0.28rem;
	}

	.epoch-controls button {
		padding: 0.4rem 0.5rem;
		border: 1px solid rgb(255 255 255 / 9%);
		border-radius: 4px;
		background: rgb(255 255 255 / 3%);
		color: #849bab;
		font: inherit;
		font-size: 0.55rem;
		cursor: pointer;
	}

	.epoch-controls button.active {
		border-color: var(--accent);
		color: var(--accent);
	}

	@media (max-width: 660px) {
		.epoch-stage {
			min-height: 480px;
		}

		.epoch-copy {
			right: 1.25rem;
			left: 1.25rem;
		}

		.epoch-portrait {
			right: -6%;
			width: 84%;
			height: 68%;
		}

		.epoch-controls {
			grid-template-columns: 1fr;
		}

		.epoch-controls div {
			flex-wrap: wrap;
		}
	}
</style>
