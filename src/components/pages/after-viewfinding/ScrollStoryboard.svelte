<script lang="ts">
const scenes = [
	{
		id: "01",
		title: "发现",
		detail: "先留下一个坐标，不急着解释全部。",
		accent: "#72e6ff",
	},
	{
		id: "02",
		title: "拆解",
		detail: "把参考拆成空间、动作与节奏。",
		accent: "#ff7ca8",
	},
	{
		id: "03",
		title: "重写",
		detail: "只保留一个主张，再给它新的秩序。",
		accent: "#ffd166",
	},
	{
		id: "04",
		title: "验证",
		detail: "删掉动效后，内容仍然成立才算完成。",
		accent: "#7cf0c4",
	},
];

let scene = 0;
let active = scenes[0];

$: active = scenes[scene];
</script>

<div class="storyboard">
	<div class="chapter-tabs" role="group" aria-label="跳转分镜章节">
		{#each scenes as item, index}
			<button
				type="button"
				class:active={scene === index}
				on:click={() => (scene = index)}
			>
				<span>{item.id}</span>
				{item.title}
			</button>
		{/each}
	</div>

	<div class="story-stage" style={`--scene-accent: ${active.accent};`}>
		<div class="scene-rail" aria-hidden="true">
			<span style={`--position: ${scene}`}></span>
		</div>

		{#key scene}
			<div class="scene-frame">
				<div class="scene-number">{active.id}</div>
				<div class="scene-copy">
					<p>SCROLL CHAPTER</p>
					<h4>{active.title}</h4>
					<span>{active.detail}</span>
				</div>
				<div class="scene-preview" aria-hidden="true">
					<div class="preview-bar"></div>
					<div class="preview-lines">
						<i></i><i></i><i></i>
					</div>
					<div class="preview-object">
						<span></span><span></span><span></span>
					</div>
				</div>
			</div>
		{/key}
	</div>

	<label class="timeline">
		<span>拖动手柄编排分镜</span>
		<input
			type="range"
			min="0"
			max="3"
			step="1"
			bind:value={scene}
			aria-label="滚动叙事分镜进度"
		/>
	</label>
</div>

<style>
	.storyboard {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
	}

	.chapter-tabs {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
	}

	.chapter-tabs button {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 9%);
		border-radius: 5px;
		background: rgb(255 255 255 / 3%);
		color: #87a0b1;
		font: inherit;
		font-size: 0.68rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.chapter-tabs button span {
		color: #587184;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.56rem;
	}

	.chapter-tabs button.active {
		border-color: var(--scene-accent, #72e6ff);
		background: color-mix(in srgb, var(--scene-accent, #72e6ff) 12%, transparent);
		color: #f3fbff;
	}

	.story-stage {
		position: relative;
		display: flex;
		min-height: 310px;
		flex: 1;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			linear-gradient(rgb(114 230 255 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(114 230 255 / 4%) 1px, transparent 1px),
			#040c14;
		background-size: 22px 22px;
	}

	.scene-rail {
		position: absolute;
		z-index: 2;
		top: 0;
		bottom: 0;
		left: 0;
		width: 3px;
		background: rgb(255 255 255 / 8%);
	}

	.scene-rail span {
		display: block;
		width: 100%;
		height: 25%;
		background: var(--scene-accent);
		box-shadow: 0 0 16px var(--scene-accent);
		transform: translateY(calc(var(--position) * 100%));
		transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.scene-frame {
		display: grid;
		width: 100%;
		grid-template-columns: minmax(0, 0.85fr) minmax(180px, 1.15fr);
		gap: 1rem;
		align-items: center;
		padding: 1.5rem 1.5rem 1.5rem 1.75rem;
		animation: scene-in 360ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.scene-number {
		align-self: start;
		color: color-mix(in srgb, var(--scene-accent) 70%, #688192);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 2.8rem;
		font-weight: 800;
		line-height: 1;
	}

	.scene-copy {
		align-self: end;
		padding-bottom: 0.3rem;
	}

	.scene-copy p {
		margin: 0 0 0.45rem;
		color: var(--scene-accent);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.scene-copy h4 {
		margin: 0;
		color: #f4fbff;
		font-size: clamp(1.6rem, 4vw, 2.6rem);
		line-height: 1;
	}

	.scene-copy span {
		display: block;
		max-width: 26rem;
		margin-top: 0.65rem;
		color: #9eb3c2;
		font-size: 0.78rem;
		line-height: 1.65;
	}

	.scene-preview {
		position: relative;
		min-height: 220px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--scene-accent) 30%, transparent);
		border-radius: 5px;
		background: rgb(7 20 32 / 88%);
		box-shadow: 0 22px 55px rgb(0 0 0 / 34%);
	}

	.preview-bar {
		height: 1.7rem;
		border-bottom: 1px solid rgb(255 255 255 / 8%);
		background: rgb(255 255 255 / 3%);
	}

	.preview-lines {
		display: grid;
		gap: 0.38rem;
		width: 44%;
		padding: 1.2rem;
	}

	.preview-lines i {
		display: block;
		height: 0.35rem;
		background: #40596a;
	}

	.preview-lines i:first-child {
		width: 85%;
		height: 0.8rem;
		background: #e9f5fb;
	}

	.preview-lines i:last-child {
		width: 60%;
	}

	.preview-object {
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		width: 48%;
		aspect-ratio: 1;
		border: 1px solid color-mix(in srgb, var(--scene-accent) 35%, transparent);
		background: color-mix(in srgb, var(--scene-accent) 8%, transparent);
		transform: rotate(calc((var(--position) - 1.5) * 5deg));
		transition: transform 420ms ease;
	}

	.preview-object span {
		position: absolute;
		inset: 22%;
		border: 1px solid var(--scene-accent);
	}

	.preview-object span:nth-child(2) {
		inset: 35%;
		background: var(--scene-accent);
	}

	.preview-object span:nth-child(3) {
		inset: 44%;
		border-color: #ffd166;
		transform: rotate(45deg);
	}

	.timeline {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.8rem;
		align-items: center;
		color: #7e96a7;
		font-size: 0.66rem;
	}

	.timeline input {
		width: 100%;
		accent-color: var(--scene-accent, #72e6ff);
		cursor: ew-resize;
	}

	@keyframes scene-in {
		from {
			opacity: 0;
			transform: translateX(14px);
		}

		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (max-width: 620px) {
		.chapter-tabs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.scene-frame {
			grid-template-columns: 1fr;
			gap: 0.6rem;
			padding: 1.25rem 1.1rem 1.25rem 1.4rem;
		}

		.scene-number {
			position: absolute;
			top: 1.15rem;
			right: 1rem;
			font-size: 2rem;
			opacity: 0.35;
		}

		.scene-preview {
			min-height: 150px;
		}

		.timeline {
			grid-template-columns: 1fr;
			gap: 0.35rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scene-frame {
			animation: none;
		}

		.scene-rail span,
		.preview-object {
			transition: none;
		}
	}
</style>
