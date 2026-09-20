<script lang="ts">
/**
 * overlay 里的真·全息卡。
 *
 * 只在被打开时才动态 import 观看器 —— three 是 170KB 级的账，不该让首屏替它买单，
 * 这也是方案里「渐进式加载」的落点：轨道吃缩略图，点开才拉全量（图层 + GLB）。
 */
import { onMount } from "svelte";
import { cardPoster, type HoloCardMeta, viewerConfig } from "./cards";
import type { Finish, HoloViewer } from "./holo-viewer";

interface Props {
	card: HoloCardMeta;
	onClose: () => void;
}

let { card, onClose }: Props = $props();

let stage: HTMLDivElement | undefined = $state();
let viewer: HoloViewer | undefined = $state();
let loading = $state(true);
let failed = $state("");
let flipped = $state(false);
let finish = $state<Finish>("gold");
let foil = $state(65);
let showDepth = $state(true);
let saved = $state("");

const finishes: { id: Finish; label: string }[] = [
	{ id: "pearl", label: "珠光" },
	{ id: "silver", label: "银箔" },
	{ id: "gold", label: "烫金" },
	{ id: "original", label: "原画" },
];

const depthControls = [
	{
		id: "scale" as const,
		label: "画面比例",
		min: 0.95,
		max: 1.35,
		step: 0.01,
		value: 1.25,
	},
	{
		id: "depth" as const,
		label: "画面景深",
		min: -0.45,
		max: 0.45,
		step: 0.01,
		value: 0.4,
	},
	{
		id: "fx-depth" as const,
		label: "特效景深",
		min: -0.3,
		max: 0.9,
		step: 0.01,
		value: 0.5,
	},
	{
		id: "bg-depth" as const,
		label: "底纹景深",
		min: -0.4,
		max: 0.4,
		step: 0.01,
		value: -0.25,
	},
];

let depthValues = $state<Record<string, number>>(
	Object.fromEntries(depthControls.map((c) => [c.id, c.value])),
);

onMount(() => {
	let disposed = false;
	let instance: HoloViewer | undefined;

	(async () => {
		try {
			const { createHoloViewer } = await import("./holo-viewer");
			if (disposed || !stage) return;
			instance = createHoloViewer({
				container: stage,
				config: viewerConfig(card),
				onState: (state) => {
					flipped = state.flipped;
				},
			});
			viewer = instance;
			await instance.ready;
			if (disposed) return;
			loading = false;
		} catch (error) {
			if (disposed) return;
			loading = false;
			failed = error instanceof Error ? error.message : String(error);
		}
	})();

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
		}
	};
	window.addEventListener("keydown", onKey);

	return () => {
		disposed = true;
		window.removeEventListener("keydown", onKey);
		instance?.dispose();
		viewer = undefined;
	};
});

function chooseFinish(id: Finish) {
	finish = id;
	viewer?.setFinish(id);
}

function chooseDepth(id: string, value: number) {
	depthValues = { ...depthValues, [id]: value };
	viewer?.setParam(id as "scale" | "depth" | "fx-depth" | "bg-depth", value);
}

function flash(message: string) {
	saved = message;
	setTimeout(() => {
		if (saved === message) saved = "";
	}, 2200);
}
</script>

<div class="holo-overlay" role="dialog" aria-modal="true" aria-label="{card.title} 全息卡">
	<button class="holo-scrim" type="button" aria-label="关闭" onclick={onClose}></button>

	<div class="holo-panel">
		<header class="holo-head">
			<div class="holo-id">
				<span class="holo-index">{card.edition}</span>
				<h2 class="holo-title">{card.title}</h2>
				<span class="holo-latin">{card.latin}</span>
			</div>
			<div class="holo-head-actions">
				<button class="holo-btn" type="button" onclick={() => viewer?.save() && flash("已保存卡面图")}>
					保存卡面
				</button>
				<button class="holo-btn holo-btn--ghost" type="button" onclick={onClose}>关闭</button>
			</div>
		</header>

		<div class="holo-body">
			<div
				class="holo-viewport"
				bind:this={stage}
				tabindex="0"
				role="group"
				aria-label="可拖动旋转的全息卡"
				style:--poster="url({cardPoster(card.id)})"
			>
				{#if loading}
					<div class="holo-loading" role="status"><span></span>正在装裱作品</div>
				{/if}
				{#if failed}
					<div class="holo-failed" role="alert">
						<p>卡面暂时无法显示。</p>
						<p class="holo-failed-detail">{failed}</p>
					</div>
				{/if}
			</div>

			<aside class="holo-side">
				{#if card.tagline}
					<p class="holo-quote">{card.tagline}</p>
				{/if}

				<div class="holo-row">
					<span class="holo-label">卡片朝向</span>
					<div class="holo-seg">
						<button
							type="button"
							class:active={!flipped}
							aria-pressed={!flipped}
							onclick={() => viewer?.flip(false)}>正面</button
						>
						<button
							type="button"
							class:active={flipped}
							aria-pressed={flipped}
							onclick={() => viewer?.flip(true)}>背面</button
						>
					</div>
				</div>

				<div class="holo-row">
					<span class="holo-label">卡面质感</span>
					<div class="holo-swatches">
						{#each finishes as item (item.id)}
							<button
								type="button"
								class="holo-swatch holo-swatch--{item.id}"
								class:active={finish === item.id}
								aria-pressed={finish === item.id}
								title={item.label}
								aria-label={item.label}
								onclick={() => chooseFinish(item.id)}
							></button>
						{/each}
					</div>
				</div>

				<label class="holo-range">
					<span>光泽 <em>{foil}%</em></span>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={foil}
						disabled={finish === "original"}
						oninput={(event) => {
							foil = Number(event.currentTarget.value);
							viewer?.setFoil(foil / 100);
						}}
					/>
				</label>

				<div class="holo-depth">
					<button
						class="holo-depth-toggle"
						type="button"
						aria-expanded={showDepth}
						onclick={() => (showDepth = !showDepth)}
					>
						景深调整 <i>{showDepth ? "−" : "+"}</i>
					</button>
					{#if showDepth}
						<div class="holo-depth-body">
							{#each depthControls as control (control.id)}
								<label class="holo-range">
									<span
										>{control.label}
										<em>{depthValues[control.id].toFixed(2)}</em></span
									>
									<input
										type="range"
										min={control.min}
										max={control.max}
										step={control.step}
										value={depthValues[control.id]}
										oninput={(event) => chooseDepth(control.id, Number(event.currentTarget.value))}
									/>
								</label>
							{/each}
						</div>
					{/if}
				</div>

				<div class="holo-actions">
					<button class="holo-btn holo-btn--ghost" type="button" onclick={() => viewer?.reset()}
						>复位</button
					>
					<span class="holo-hint" aria-live="polite">{saved || "拖动旋转 · 滚轮缩放 · F 翻面 · R 复位"}</span>
				</div>

				<p class="holo-credit">同人二次创作，素材版权归库洛游戏所有，仅个人收藏与展示，不商用。</p>
			</aside>
		</div>
	</div>
</div>

<style>
	.holo-overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: clamp(0.5rem, 2vw, 1.75rem);
		animation: holo-fade 220ms ease-out;
	}

	.holo-scrim {
		position: absolute;
		inset: 0;
		border: 0;
		padding: 0;
		background: radial-gradient(circle at 50% 42%, rgb(16 24 48 / 0.9), rgb(4 6 14 / 0.97));
		backdrop-filter: blur(6px);
		cursor: zoom-out;
	}

	.holo-panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(1180px, 100%);
		height: min(880px, 100%);
		border: 1px solid rgb(255 255 255 / 0.1);
		border-radius: 18px;
		background: linear-gradient(180deg, rgb(14 19 36 / 0.96), rgb(8 11 22 / 0.98));
		box-shadow: 0 30px 90px rgb(0 0 0 / 0.6);
		overflow: hidden;
		color: rgb(233 238 248 / 0.92);
	}

	.holo-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1.2rem;
		border-bottom: 1px solid rgb(255 255 255 / 0.08);
	}

	.holo-id {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		min-width: 0;
	}

	.holo-index {
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		color: rgb(255 255 255 / 0.4);
	}

	.holo-title {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.holo-latin {
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.68rem;
		letter-spacing: 0.22em;
		color: rgb(255 255 255 / 0.42);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.holo-head-actions {
		display: flex;
		gap: 0.5rem;
		flex: none;
	}

	.holo-body {
		display: flex;
		min-height: 0;
		flex: 1;
	}

	.holo-viewport {
		position: relative;
		flex: 1;
		min-width: 0;
		touch-action: none;
		cursor: grab;
		outline: none;
		background-image: var(--poster);
		background-size: contain;
		background-position: center;
		background-repeat: no-repeat;
	}

	.holo-viewport:focus-visible {
		box-shadow: inset 0 0 0 2px hsl(198 60% 60% / 0.6);
	}

	.holo-viewport.dragging {
		cursor: grabbing;
	}

	.holo-viewport :global(canvas) {
		display: block;
		/* 画布压住背景占位图：WebGL 首帧出来之前 poster 顶着，出来之后它就没用了 */
		position: absolute;
		inset: 0;
	}

	.holo-loading {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		letter-spacing: 0.16em;
		color: rgb(255 255 255 / 0.6);
		background: rgb(6 9 18 / 0.72);
	}

	.holo-loading span {
		width: 1.4rem;
		height: 1px;
		background: linear-gradient(90deg, transparent, currentColor, transparent);
		animation: holo-scan 1.3s ease-in-out infinite;
	}

	.holo-failed {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: grid;
		place-content: center;
		gap: 0.4rem;
		padding: 2rem;
		text-align: center;
		background: rgb(6 9 18 / 0.9);
	}

	.holo-failed-detail {
		font-size: 0.75rem;
		color: rgb(255 255 255 / 0.45);
	}

	.holo-side {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 268px;
		flex: none;
		padding: 1.2rem;
		border-left: 1px solid rgb(255 255 255 / 0.08);
		overflow-y: auto;
	}

	.holo-quote {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.75;
		color: rgb(255 255 255 / 0.62);
	}

	.holo-row {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.holo-label {
		font-size: 0.72rem;
		letter-spacing: 0.16em;
		color: rgb(255 255 255 / 0.45);
	}

	.holo-seg {
		display: flex;
		border: 1px solid rgb(255 255 255 / 0.14);
		border-radius: 8px;
		overflow: hidden;
	}

	.holo-seg button {
		flex: 1;
		padding: 0.4rem 0;
		border: 0;
		background: transparent;
		color: rgb(255 255 255 / 0.6);
		font-size: 0.78rem;
		cursor: pointer;
		transition: background 140ms ease, color 140ms ease;
	}

	.holo-seg button.active {
		background: rgb(255 255 255 / 0.14);
		color: #fff;
	}

	.holo-swatches {
		display: flex;
		gap: 0.5rem;
	}

	.holo-swatch {
		width: 30px;
		height: 30px;
		border: 1px solid rgb(255 255 255 / 0.2);
		border-radius: 50%;
		cursor: pointer;
		transition: transform 140ms ease, box-shadow 140ms ease;
	}

	.holo-swatch.active {
		box-shadow: 0 0 0 2px rgb(255 255 255 / 0.7);
		transform: scale(1.06);
	}

	.holo-swatch--pearl {
		background: conic-gradient(from 20deg, #e9e2f4, #cfe6ea, #f2e6c9, #d7dcf2, #e9e2f4);
	}

	.holo-swatch--silver {
		background: linear-gradient(135deg, #f2f5f7, #97a1aa);
	}

	.holo-swatch--gold {
		background: linear-gradient(135deg, #f6e0a4, #a97c2a);
	}

	.holo-swatch--original {
		background: linear-gradient(135deg, #eceeec, #c3c8c4);
	}

	.holo-range {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: rgb(255 255 255 / 0.5);
	}

	.holo-range span {
		display: flex;
		justify-content: space-between;
		letter-spacing: 0.08em;
	}

	.holo-range em {
		font-style: normal;
		font-family: var(--font-jetbrains-mono), monospace;
		color: rgb(255 255 255 / 0.75);
	}

	.holo-range input {
		width: 100%;
		accent-color: hsl(200 70% 62%);
	}

	.holo-range input:disabled {
		opacity: 0.35;
	}

	.holo-depth-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: 1px solid rgb(255 255 255 / 0.14);
		border-radius: 8px;
		background: transparent;
		color: rgb(255 255 255 / 0.65);
		font-size: 0.76rem;
		cursor: pointer;
	}

	.holo-depth-toggle i {
		font-style: normal;
		font-family: var(--font-jetbrains-mono), monospace;
	}

	.holo-depth-body {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 0.75rem;
	}

	.holo-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: auto;
	}

	.holo-btn {
		padding: 0.42rem 0.8rem;
		border: 1px solid rgb(255 255 255 / 0.2);
		border-radius: 8px;
		background: rgb(255 255 255 / 0.1);
		color: rgb(255 255 255 / 0.88);
		font-size: 0.78rem;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.holo-btn:hover {
		background: rgb(255 255 255 / 0.18);
	}

	.holo-btn--ghost {
		background: transparent;
		color: rgb(255 255 255 / 0.6);
	}

	.holo-hint {
		font-size: 0.68rem;
		line-height: 1.5;
		color: rgb(255 255 255 / 0.38);
	}

	.holo-credit {
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.6;
		color: rgb(255 255 255 / 0.32);
	}

	@keyframes holo-fade {
		from {
			opacity: 0;
		}
	}

	@keyframes holo-scan {
		0%,
		100% {
			opacity: 0.3;
			transform: scaleX(0.6);
		}
		50% {
			opacity: 1;
			transform: scaleX(1);
		}
	}

	@media (max-width: 900px) {
		.holo-body {
			flex-direction: column;
		}

		.holo-viewport {
			flex: 1 1 46%;
			min-height: 300px;
		}

		.holo-side {
			width: auto;
			border-left: 0;
			border-top: 1px solid rgb(255 255 255 / 0.08);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.holo-overlay,
		.holo-loading span {
			animation: none;
		}
	}
</style>
