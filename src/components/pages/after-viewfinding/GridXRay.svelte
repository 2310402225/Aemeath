<script lang="ts">
type Viewport = "desktop" | "tablet" | "mobile";

let viewport: Viewport = "desktop";
let showGrid = true;
let pointerX = 50;
let pointerY = 50;

const viewports: Array<{ id: Viewport; label: string; width: string }> = [
	{ id: "desktop", label: "桌面", width: "1440" },
	{ id: "tablet", label: "平板", width: "768" },
	{ id: "mobile", label: "手机", width: "390" },
];

function updatePointer(event: PointerEvent) {
	const target = event.currentTarget as HTMLElement;
	const rect = target.getBoundingClientRect();
	pointerX = ((event.clientX - rect.left) / rect.width) * 100;
	pointerY = ((event.clientY - rect.top) / rect.height) * 100;
}
</script>

<div class="grid-lab">
	<div class="lab-toolbar">
		<div class="segmented" role="group" aria-label="切换预览宽度">
			{#each viewports as item}
				<button
					type="button"
					class:active={viewport === item.id}
					on:click={() => (viewport = item.id)}
				>
					<span>{item.label}</span>
					<small>{item.width}</small>
				</button>
			{/each}
		</div>

		<button
			type="button"
			class="utility"
			aria-pressed={showGrid}
			on:click={() => (showGrid = !showGrid)}
		>
			{showGrid ? "隐藏栅格" : "显示栅格"}
		</button>
	</div>

	<div
		class="viewport"
		class:desktop={viewport === "desktop"}
		class:tablet={viewport === "tablet"}
		class:mobile={viewport === "mobile"}
		style={`--pointer-x: ${pointerX}%; --pointer-y: ${pointerY}%;`}
		on:pointermove={updatePointer}
		on:pointerleave={() => {
			pointerX = 50;
			pointerY = 50;
		}}
	>
		<div class="grid-overlay" class:visible={showGrid} aria-hidden="true">
			{#each Array(12) as _, index}
				<span style={`--column: ${index}`}></span>
			{/each}
		</div>

		<div class="mock-page">
			<nav>
				<strong>FIELD / 06</strong>
				<div><span></span><span></span><span></span></div>
			</nav>

			<section class="mock-hero">
				<div>
					<p>INTERACTION STUDY</p>
					<h4>让参考站<br />变成可玩的方法</h4>
					<button type="button">开始查看</button>
				</div>
				<div class="mock-visual" aria-hidden="true">
					<span></span>
					<span></span>
					<span></span>
				</div>
			</section>

			<div class="mock-cards">
				<article><span>01</span><strong>空间</strong><i></i></article>
				<article><span>02</span><strong>反馈</strong><i></i></article>
				<article><span>03</span><strong>叙事</strong><i></i></article>
			</div>
		</div>

		<div class="ruler" aria-hidden="true">
			<span>0</span>
			<span>{viewports.find((item) => item.id === viewport)?.width}px</span>
		</div>
	</div>
</div>

<style>
	.grid-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
	}

	.lab-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.segmented {
		display: flex;
		padding: 0.2rem;
		border: 1px solid rgb(114 230 255 / 20%);
		border-radius: 6px;
		background: rgb(3 13 22 / 76%);
	}

	.segmented button,
	.utility {
		border: 0;
		color: #9db3c2;
		font: inherit;
		cursor: pointer;
	}

	.segmented button {
		display: grid;
		min-width: 4.6rem;
		gap: 0.05rem;
		padding: 0.45rem 0.65rem;
		border-radius: 4px;
		background: transparent;
		font-size: 0.72rem;
		line-height: 1.15;
	}

	.segmented button small {
		color: #60798a;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.segmented button.active {
		background: #72e6ff;
		color: #06111b;
	}

	.segmented button.active small {
		color: #143541;
	}

	.utility {
		padding: 0.48rem 0.72rem;
		border: 1px solid rgb(255 255 255 / 10%);
		border-radius: 5px;
		background: rgb(255 255 255 / 4%);
		font-size: 0.7rem;
	}

	.utility:hover,
	.utility:focus-visible {
		border-color: #72e6ff;
		color: #eafcff;
	}

	.viewport {
		position: relative;
		display: flex;
		min-height: 348px;
		flex: 1;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			linear-gradient(rgb(114 230 255 / 5%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(114 230 255 / 5%) 1px, transparent 1px),
			#040c14;
		background-size: 22px 22px;
	}

	.grid-overlay {
		position: absolute;
		z-index: 2;
		inset: 0;
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 0.35rem;
		padding: 0.5rem;
		opacity: 0;
		pointer-events: none;
		transition: opacity 180ms ease;
	}

	.grid-overlay.visible {
		opacity: 1;
	}

	.grid-overlay span {
		border-inline: 1px solid rgb(255 124 168 / 28%);
		background: rgb(255 124 168 / 4%);
	}

	.grid-overlay span:nth-child(4n + 1) {
		border-color: rgb(114 230 255 / 52%);
		background: rgb(114 230 255 / 6%);
	}

	.mock-page {
		position: relative;
		z-index: 1;
		width: min(92%, 720px);
		min-height: 280px;
		padding: 0.8rem;
		transition:
			width 420ms cubic-bezier(0.22, 1, 0.36, 1),
			padding 420ms ease;
		border: 1px solid rgb(114 230 255 / 20%);
		border-radius: 5px;
		background: rgb(8 21 33 / 93%);
		box-shadow: 0 24px 60px rgb(0 0 0 / 40%);
	}

	.viewport.tablet .mock-page {
		width: min(68%, 520px);
	}

	.viewport.mobile .mock-page {
		width: min(37%, 250px);
		min-height: 290px;
		padding: 0.6rem;
	}

	.mock-page nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 0.7rem;
		border-bottom: 1px solid rgb(255 255 255 / 8%);
		color: #72e6ff;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.mock-page nav div {
		display: flex;
		gap: 0.32rem;
	}

	.mock-page nav span {
		width: 1.4rem;
		height: 0.22rem;
		border-radius: 2px;
		background: #405a6b;
	}

	.mock-hero {
		display: grid;
		grid-template-columns: 1.1fr 0.9fr;
		gap: 0.8rem;
		padding: 1.05rem 0 0.8rem;
	}

	.viewport.tablet .mock-hero,
	.viewport.mobile .mock-hero {
		grid-template-columns: 1fr;
	}

	.mock-hero p {
		margin: 0 0 0.38rem;
		color: #ff7ca8;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.52rem;
	}

	.mock-hero h4 {
		margin: 0;
		color: #f3fbff;
		font-size: clamp(1rem, 3.2vw, 2rem);
		line-height: 1.08;
	}

	.viewport.mobile .mock-hero h4 {
		font-size: 0.78rem;
	}

	.mock-hero button {
		margin-top: 0.8rem;
		padding: 0.38rem 0.6rem;
		border: 0;
		border-radius: 3px;
		background: #ffd166;
		color: #17130a;
		font-size: 0.6rem;
		font-weight: 700;
	}

	.mock-visual {
		position: relative;
		min-height: 86px;
		overflow: hidden;
		border: 1px solid rgb(114 230 255 / 22%);
		border-radius: 4px;
		background:
			linear-gradient(135deg, rgb(114 230 255 / 8%), transparent),
			#071522;
	}

	.mock-visual span {
		position: absolute;
		width: 56%;
		height: 1px;
		background: #72e6ff;
		transform-origin: left;
	}

	.mock-visual span:nth-child(1) {
		top: 34%;
		left: 18%;
		transform: rotate(24deg);
	}

	.mock-visual span:nth-child(2) {
		top: 58%;
		left: 28%;
		background: #ff7ca8;
		transform: rotate(-18deg);
	}

	.mock-visual span:nth-child(3) {
		top: 45%;
		left: 45%;
		width: 18%;
		height: 18%;
		border: 1px solid #ffd166;
		background: transparent;
		transform: rotate(45deg);
	}

	.mock-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.45rem;
	}

	.viewport.tablet .mock-cards {
		grid-template-columns: repeat(2, 1fr);
	}

	.viewport.mobile .mock-cards {
		grid-template-columns: 1fr;
	}

	.mock-cards article {
		position: relative;
		min-height: 54px;
		padding: 0.48rem;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 4px;
		background: rgb(255 255 255 / 3%);
	}

	.mock-cards span {
		color: #6d8798;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.48rem;
	}

	.mock-cards strong {
		display: block;
		margin-top: 0.2rem;
		color: #d9e7ef;
		font-size: 0.64rem;
	}

	.mock-cards i {
		position: absolute;
		right: 0.45rem;
		bottom: 0.45rem;
		width: 1.8rem;
		height: 0.22rem;
		background: #344d5e;
	}

	.ruler {
		position: absolute;
		right: 0.45rem;
		bottom: 0.42rem;
		left: 0.45rem;
		display: flex;
		justify-content: space-between;
		color: #6d8798;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.54rem;
	}

	@media (max-width: 520px) {
		.segmented {
			width: 100%;
		}

		.segmented button {
			min-width: 0;
			flex: 1;
			padding-inline: 0.35rem;
		}

		.utility {
			width: 100%;
		}
	}
</style>
