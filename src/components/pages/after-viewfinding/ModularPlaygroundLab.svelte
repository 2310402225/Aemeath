<script lang="ts">
import { flip } from "svelte/animate";

type Tile = {
	id: string;
	label: string;
	kind: "type" | "image" | "meter" | "grid" | "code" | "shape";
	accent: string;
};

const initialTiles: Tile[] = [
	{ id: "title", label: "标题", kind: "type", accent: "#72e6ff" },
	{
		id: "portrait",
		label: "角色",
		kind: "image",
		accent: "#ff7ca8",
	},
	{ id: "metric", label: "数据", kind: "meter", accent: "#ffd166" },
	{ id: "index", label: "索引", kind: "grid", accent: "#b9a7ff" },
	{ id: "note", label: "说明", kind: "code", accent: "#7cf0c4" },
	{ id: "motif", label: "图形", kind: "shape", accent: "#86a8ff" },
];

let tiles = [...initialTiles];
let selected: string | null = null;
let moves = 0;
let pulse = false;

function swap(targetId: string) {
	if (!selected) {
		selected = targetId;
		return;
	}
	if (selected === targetId) {
		selected = null;
		return;
	}

	const first = tiles.findIndex((tile) => tile.id === selected);
	const second = tiles.findIndex((tile) => tile.id === targetId);
	const next = [...tiles];
	[next[first], next[second]] = [next[second], next[first]];
	tiles = next;
	selected = null;
	moves += 1;
	pulse = true;
	window.setTimeout(() => (pulse = false), 240);
}

function reset() {
	tiles = [...initialTiles];
	selected = null;
	moves = 0;
}
</script>

<div class="modular-lab">
	<div class="module-board" class:pulse>
		{#each tiles as tile (tile.id)}
			<button
				type="button"
				class="module-tile"
				class:selected={selected === tile.id}
				style={`--accent:${tile.accent};`}
				animate:flip={{ duration: 260 }}
				on:click={() => swap(tile.id)}
				aria-pressed={selected === tile.id}
			>
				<div class="tile-label">
					<span>{tile.kind.toUpperCase()}</span>
					<strong>{tile.label}</strong>
				</div>

				{#if tile.kind === "type"}
					<div class="tile-type">STRUCTURE<br />FIRST</div>
				{:else if tile.kind === "image"}
					<img
						src="/images/home-stickers/blue-witch.webp"
						alt=""
						draggable="false"
					/>
				{:else if tile.kind === "meter"}
					<div class="tile-meter">
						<span style="--value: 78%"></span>
						<span style="--value: 54%"></span>
						<span style="--value: 92%"></span>
					</div>
				{:else if tile.kind === "grid"}
					<div class="tile-grid">
						{#each Array(12) as _}
							<i></i>
						{/each}
					</div>
				{:else if tile.kind === "code"}
					<code>&lt;move /&gt;<br />&lt;reply /&gt;</code>
				{:else}
					<div class="tile-shape" aria-hidden="true">
						<span></span><span></span>
					</div>
				{/if}
			</button>
		{/each}
	</div>

	<div class="module-footer">
		<span>
			{selected
				? `已选中「${tiles.find((tile) => tile.id === selected)?.label}」，再点一块完成交换`
				: "点击两块模块即可交换位置"}
		</span>
		<div>
			<strong>{moves} MOVES</strong>
			<button type="button" on:click={reset}>恢复结构</button>
		</div>
	</div>
</div>

<style>
	.modular-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.7rem;
	}

	.module-board {
		display: grid;
		min-height: 420px;
		flex: 1;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.55rem;
		padding: 0.55rem;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			linear-gradient(rgb(114 230 255 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(114 230 255 / 4%) 1px, transparent 1px),
			#040c14;
		background-size: 22px 22px;
	}

	.module-board.pulse {
		box-shadow: 0 0 0 1px rgb(114 230 255 / 32%) inset;
	}

	.module-tile {
		position: relative;
		min-width: 0;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--accent) 26%, #263a48);
		border-radius: 5px;
		background: rgb(7 20 31 / 92%);
		color: #eef9ff;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 160ms ease,
			transform 160ms ease,
			background 160ms ease;
	}

	.module-tile:hover,
	.module-tile:focus-visible {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.module-tile.selected {
		background: color-mix(in srgb, var(--accent) 13%, #07141f);
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent) inset,
			0 0 24px color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.tile-label {
		position: absolute;
		z-index: 2;
		top: 0.55rem;
		right: 0.6rem;
		left: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.tile-label span {
		color: var(--accent);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.48rem;
	}

	.tile-label strong {
		color: #a8bdca;
		font-size: 0.62rem;
	}

	.tile-type {
		display: grid;
		height: 100%;
		place-items: center;
		color: color-mix(in srgb, var(--accent) 72%, #fff);
		font-size: clamp(1.1rem, 3.2vw, 2.3rem);
		font-weight: 800;
		line-height: 0.92;
		text-align: center;
	}

	.module-tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center 12%;
	}

	.tile-meter {
		display: grid;
		align-content: center;
		gap: 0.55rem;
		height: 100%;
		padding: 1rem;
	}

	.tile-meter span {
		display: block;
		width: var(--value);
		height: 0.55rem;
		border-radius: 999px;
		background: var(--accent);
		box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.tile-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
		height: 100%;
		padding: 2rem 0.8rem 0.8rem;
	}

	.tile-grid i {
		border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
		background: color-mix(in srgb, var(--accent) 7%, transparent);
	}

	.module-tile code {
		display: grid;
		height: 100%;
		place-items: center;
		color: var(--accent);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.78rem;
		line-height: 1.8;
	}

	.tile-shape {
		position: relative;
		height: 100%;
	}

	.tile-shape span {
		position: absolute;
		inset: 24%;
		border: 1px solid var(--accent);
		transform: rotate(18deg);
	}

	.tile-shape span:nth-child(2) {
		inset: 36%;
		transform: rotate(63deg);
		background: var(--accent);
	}

	.module-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		color: #849bab;
		font-size: 0.65rem;
	}

	.module-footer div {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.module-footer strong {
		color: #c7d8e2;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.module-footer button {
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 10%);
		border-radius: 4px;
		background: rgb(255 255 255 / 4%);
		color: #afc4d1;
		font: inherit;
		cursor: pointer;
	}

	@media (max-width: 620px) {
		.module-board {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			min-height: 520px;
		}

		.module-footer {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
