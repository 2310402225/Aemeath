<script lang="ts">
const characters = [
	{
		name: "白发读者",
		src: "/images/home-stickers/white-haired-reader.webp",
		accent: "#72e6ff",
	},
	{
		name: "蓝发女巫",
		src: "/images/home-stickers/blue-witch.webp",
		accent: "#86a8ff",
	},
	{
		name: "粉色猫耳",
		src: "/images/home-stickers/pink-cat.webp",
		accent: "#ff7ca8",
	},
	{
		name: "竹影少女",
		src: "/images/home-stickers/bamboo-girl.webp",
		accent: "#7cf0c4",
	},
];

let selected = 0;
let lightX = 50;
let lightY = 46;
let character = characters[0];

$: character = characters[selected];

function moveLight(event: PointerEvent) {
	if (event.pointerType !== "mouse") return;
	updateLight(event);
}

function updateLight(event: PointerEvent | MouseEvent) {
	const target = event.currentTarget as HTMLElement;
	const rect = target.getBoundingClientRect();
	lightX = ((event.clientX - rect.left) / rect.width) * 100;
	lightY = ((event.clientY - rect.top) / rect.height) * 100;
}

function moveWithKeyboard(event: KeyboardEvent) {
	const step = 5;
	if (event.key === "ArrowLeft") lightX = Math.max(6, lightX - step);
	if (event.key === "ArrowRight") lightX = Math.min(94, lightX + step);
	if (event.key === "ArrowUp") lightY = Math.max(8, lightY - step);
	if (event.key === "ArrowDown") lightY = Math.min(92, lightY + step);
	event.preventDefault();
}
</script>

<div
	class="spotlight-lab"
	style={`--accent: ${characters[selected].accent};`}
>
	<div
		class="spot-stage"
		style={`--light-x: ${lightX}%; --light-y: ${lightY}%; --accent: ${character.accent};`}
		role="application"
		tabindex="0"
		aria-label="角色聚光台，移动或点按画面改变灯光位置"
		on:pointermove={moveLight}
		on:click={updateLight}
		on:keydown={moveWithKeyboard}
	>
		<div class="spot-grid" aria-hidden="true"></div>
		<img class="character base" src={character.src} alt="" draggable="false" />
		<img class="character lit" src={character.src} alt={character.name} draggable="false" />
		<div class="focus-ring" aria-hidden="true"></div>
		<div class="spot-status">
			<span>{character.name}</span>
			<span>FOCUS / {String(selected + 1).padStart(2, "0")}</span>
		</div>
	</div>

	<div class="character-picker" role="group" aria-label="选择角色">
		{#each characters as item, index}
			<button
				type="button"
				class:active={selected === index}
				on:click={() => (selected = index)}
			>
				<span>{String(index + 1).padStart(2, "0")}</span>
				{item.name}
			</button>
		{/each}
	</div>
</div>

<style>
	.spotlight-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
	}

	.spot-stage {
		position: relative;
		display: grid;
		min-height: 340px;
		flex: 1;
		place-items: center;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background: #030a11;
		cursor: crosshair;
		outline: none;
	}

	.spot-stage:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.spot-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgb(255 255 255 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 4%) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	.character {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: center bottom;
		user-select: none;
	}

	.character.base {
		opacity: 0.2;
		filter: saturate(0.2) brightness(0.55);
		transform: scale(0.94);
	}

	.character.lit {
		clip-path: circle(
			25% at var(--light-x) var(--light-y)
		);
		transform: scale(0.94);
		filter: drop-shadow(0 0 28px color-mix(in srgb, var(--accent) 32%, transparent));
		transition: clip-path 90ms linear;
	}

	.focus-ring {
		position: absolute;
		top: var(--light-y);
		left: var(--light-x);
		width: 9rem;
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		border: 1px solid color-mix(in srgb, var(--accent) 68%, transparent);
		border-radius: 50%;
		box-shadow:
			0 0 36px color-mix(in srgb, var(--accent) 16%, transparent),
			0 0 0 9999px rgb(0 0 0 / 16%);
		pointer-events: none;
	}

	.spot-status {
		position: absolute;
		right: 0.7rem;
		bottom: 0.6rem;
		left: 0.7rem;
		display: flex;
		justify-content: space-between;
		color: #71899a;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.56rem;
		pointer-events: none;
	}

	.character-picker {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.character-picker button {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.35rem;
		padding: 0.48rem;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 5px;
		background: rgb(255 255 255 / 3%);
		color: #91a8b8;
		font: inherit;
		font-size: 0.64rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.character-picker button span {
		color: #5e788a;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.52rem;
	}

	.character-picker button.active {
		border-color: var(--accent, #72e6ff);
		background: color-mix(in srgb, var(--accent, #72e6ff) 11%, transparent);
		color: #ecf8ff;
	}

	@media (max-width: 620px) {
		.spot-stage {
			min-height: 300px;
		}

		.character-picker {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.character.lit {
			transition: none;
		}
	}
</style>
