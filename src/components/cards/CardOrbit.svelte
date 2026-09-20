<script lang="ts">
/**
 * 首屏：一颗星核，六张全息卡沿轨道公转。
 *
 * 轨道不用 offset-path 也不用 CSS keyframes：六张卡每帧由 rAF 写一次 transform，
 * 这样「悬停加速 / 展开停摆 / 前后分栏」都只是同一个循环里的几个判断。
 *
 * 前后分栏（.holo-orbit--back / --front）是为了让背面的卡真的被星核挡住 ——
 * 只靠缩放和透明度做不出遮挡。跨栏时直接搬 DOM，一圈才搬两次，不心疼。
 */
import { onMount } from "svelte";
import { CARDS, COLLECTION, cardThumb } from "./cards";
import HoloCard from "./HoloCard.svelte";
import StarSphere from "./StarSphere.svelte";
import type { StarFieldHandle } from "./star-field";

/** 一圈多少度／毫秒：0.0042 → 约 86 秒转一圈 */
const BASE_SPEED = 0.0042;
const SQUASH = 0.42;
const DESKTOP = "(min-width: 1024px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

let stage: HTMLElement | undefined = $state();
let orbitBack: HTMLElement | undefined = $state();
let orbitFront: HTMLElement | undefined = $state();

let hoverIndex = $state<number | null>(null);
let openIndex = $state<number | null>(null);
/** 悬停与绽开共用一条代码路径：谁在前就用谁 */
let active = $derived(openIndex ?? hoverIndex);
/** 冲击波计数：点星核与开卡各来一发，递增一次就能让 {#key} 重放动画 */
let burstKey = $state(0);
let burstFromCore = $state(false);
/** 刚被按下那张卡（只闪一下） */
let tapped = $state<number | null>(null);
let isDesktop = $state(true);
let ready = $state(false);

/** 星核的绘制句柄：点击时 pulse() 一下 */
let star: StarFieldHandle | null = null;
let tapTimer = 0;

const cardEls: (HTMLButtonElement | undefined)[] = [];
const behindFlags: boolean[] = [];

let radius = 300;
let rot = -66;
let last = 0;
let raf = 0;
const desktopQuery = () => window.matchMedia(DESKTOP);
const reducedQuery = () => window.matchMedia(REDUCED);

function measure() {
	if (!stage) return;
	const width = stage.clientWidth;
	const height = stage.clientHeight;
	radius = Math.max(150, Math.min(width * 0.36, height * 0.4));
}

function place(index: number, theta: number) {
	const element = cardEls[index];
	if (!element) return;
	const rad = (theta * Math.PI) / 180;
	const sin = Math.sin(rad);
	const t = (sin + 1) / 2;
	const x = Math.cos(rad) * radius;
	const y = sin * radius * SQUASH;
	const scale = 0.76 + 0.3 * t;

	// 窄屏整层退回文档流，卡片必须留在原容器里，否则网格顺序会被打乱
	const behind = sin < 0;
	if (isDesktop && behindFlags[index] !== behind && orbitBack && orbitFront) {
		behindFlags[index] = behind;
		(behind ? orbitBack : orbitFront).append(element);
	}
	element.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(
		1,
	)}px, 0) scale(${scale.toFixed(3)})`;
	element.style.setProperty("--depth", t.toFixed(3));
}

function relayout() {
	measure();
	for (let i = 0; i < CARDS.length; i++) place(i, rot + i * 60);
}

function frame(now: number) {
	raf = requestAnimationFrame(frame);
	const dt = Math.min(now - last, 50);
	last = now;
	if (!isDesktop || openIndex !== null) return;
	// 悬停时轨道微加速（决策 6：hover 四联动之一）
	rot += dt * BASE_SPEED * (hoverIndex === null ? 1 : 2.2);
	for (let i = 0; i < CARDS.length; i++) place(i, rot + i * 60);
}

onMount(() => {
	const desktop = desktopQuery();
	const reduced = reducedQuery();
	isDesktop = desktop.matches;

	const applyMode = () => {
		isDesktop = desktop.matches;
		// 从桌面缩回窄屏时，先前被搬进「背面」栏的卡要还给正面栏，网格才不会缺格
		if (!isDesktop && orbitFront) {
			for (const element of cardEls) {
				if (element && element.parentElement !== orbitFront)
					orbitFront.append(element);
			}
		}
		relayout();
	};

	relayout();
	ready = true;

	// reduced-motion 下不进循环：摆好一轮静态构图就停手
	if (!reduced.matches) {
		last = performance.now();
		raf = requestAnimationFrame(frame);
	}

	desktop.addEventListener("change", applyMode);
	window.addEventListener("resize", relayout);

	// 深链：#card-01-jinxi 直接开那张卡
	const hash = window.location.hash.replace(/^#card-/, "");
	const index = CARDS.findIndex((card) => card.id === hash);
	if (hash && index >= 0) open(index);

	return () => {
		cancelAnimationFrame(raf);
		clearTimeout(tapTimer);
		desktop.removeEventListener("change", applyMode);
		window.removeEventListener("resize", relayout);
		document.body.style.overflow = "";
	};
});

/** 冲击波：点星核来一发短的，开卡来一发长的 */
function burst(fromCore: boolean) {
	burstFromCore = fromCore;
	burstKey += 1;
}

/** 卡片被按下的即时反馈：比 overlay 打开早一拍，手感才不空 */
function tap(index: number) {
	tapped = index;
	clearTimeout(tapTimer);
	tapTimer = window.setTimeout(() => {
		tapped = null;
	}, 520);
}

/** 点星核本体：让它自己脉冲一下，再补一圈冲击波 */
function tapCore() {
	star?.pulse();
	burst(true);
}

function open(index: number) {
	openIndex = index;
	tap(index);
	star?.pulse();
	burst(false);
	document.body.style.overflow = "hidden";
	// 用 replaceState：返回键不该把用户丢进半开的 overlay，深链依然可分享
	history.replaceState(null, "", `#card-${CARDS[index].id}`);
}

function close() {
	openIndex = null;
	document.body.style.overflow = "";
	history.replaceState(
		null,
		"",
		window.location.pathname + window.location.search,
	);
}
</script>

<section id="holo-hero" class="holo-hero">
	<div class="holo-field" aria-hidden="true"></div>

	<div class="holo-stage" bind:this={stage}>
		<div class="holo-orbit holo-orbit--back" bind:this={orbitBack}></div>

		<div
			class="holo-sphere"
			class:is-active={active !== null}
			style:--ring-hue={active !== null ? CARDS[active].hue : 205}
		>
			<button
				type="button"
				class="holo-core"
				aria-label="触碰星核"
				onclick={tapCore}
			>
				<StarSphere
					hue={active !== null ? CARDS[active].hue : 205}
					accent={active !== null ? 1 : 0}
					frozen={openIndex !== null}
					onReady={(handle) => {
						star = handle;
					}}
				/>
			</button>

			{#if burstKey > 0}
				{#key burstKey}
					<div class="holo-ripples" class:is-core={burstFromCore}>
						{#each [0, 1, 2] as ring (ring)}
							<span class="holo-ring" style:--delay="{ring * 140}ms"></span>
						{/each}
					</div>
				{/key}
			{/if}
		</div>

		<div class="holo-orbit holo-orbit--front" bind:this={orbitFront}>
			{#each CARDS as card, index (card.id)}
				<button
					type="button"
					class="orbit-card"
					class:is-active={active === index}
					class:is-muted={active !== null && active !== index}
					class:is-tapped={tapped === index}
					style:--a={card.accent[0]}
					style:--b={card.accent[1]}
					bind:this={cardEls[index]}
					aria-label="展开 {card.title} 全息卡"
					onmouseenter={() => (hoverIndex = index)}
					onmouseleave={() => (hoverIndex = null)}
					onfocus={() => (hoverIndex = index)}
					onblur={() => (hoverIndex = null)}
					onclick={() => open(index)}
				>
					<span class="orbit-card-inner">
						<img
							src={cardThumb(card.id)}
							alt="{card.title} 卡面"
							width="432"
							height="600"
							loading="eager"
							decoding="async"
						/>
						<span class="orbit-card-foil"></span>
					</span>
					<span class="orbit-card-meta">
						<b>{card.title}</b>
						<i>{card.edition}</i>
					</span>
				</button>
			{/each}
		</div>
	</div>

	<header class="holo-hud" class:is-ready={ready}>
		<p class="holo-eyebrow">WUTHERING WAVES · HOLOGRAPHIC ARCHIVE</p>
		<h1 class="holo-headline">潮声六记</h1>
		<p class="holo-note">{COLLECTION}</p>
		<p class="holo-hint">悬停任一张 · 点击展开全息卡 · 触碰星核有回应</p>
	</header>

	<footer class="holo-foot">
		<ul class="holo-legend">
			{#each CARDS as card, index (card.id)}
				<li>
					<button
						type="button"
						class:is-active={active === index}
						class:is-tapped={tapped === index}
						onclick={() => open(index)}
						onmouseenter={() => (hoverIndex = index)}
						onmouseleave={() => (hoverIndex = null)}
					>
						<span>{card.edition.split(" / ")[0]}</span>
						{card.title}
					</button>
				</li>
			{/each}
		</ul>
		<p class="holo-scroll">向下滚动 · 这套卡片的制作说明</p>
	</footer>
</section>

{#if openIndex !== null}
	<HoloCard card={CARDS[openIndex]} onClose={close} />
{/if}

<style>
	.holo-hero {
		position: relative;
		min-height: 100svh;
		display: flex;
		flex-direction: column;
		background: radial-gradient(120% 90% at 50% 12%, #101a35 0%, #080c18 46%, #04060d 100%);
		overflow: hidden;
		isolation: isolate;
	}

	/* 星尘底纹：两层点阵错开，省得看出重复 */
	.holo-field {
		position: absolute;
		inset: 0;
		background-image:
			radial-gradient(circle, rgb(255 255 255 / 0.16) 0 1px, transparent 1px),
			radial-gradient(circle, rgb(255 255 255 / 0.09) 0 1px, transparent 1px);
		background-size: 180px 180px, 96px 96px;
		background-position: 0 0, 42px 58px;
		mask-image: radial-gradient(120% 70% at 50% 45%, #000 12%, transparent 72%);
		opacity: 0.7;
		pointer-events: none;
	}

	.holo-stage {
		position: relative;
		flex: 1;
		min-height: 100svh;
	}

	.holo-orbit {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
	}

	.holo-orbit--back {
		z-index: 1;
	}

	.holo-orbit--front {
		z-index: 3;
	}

	.holo-sphere {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 2;
		width: clamp(190px, 26vmin, 330px);
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		transition: transform 420ms cubic-bezier(0.22, 0.9, 0.3, 1);
	}

	.holo-sphere.is-active {
		transform: translate(-50%, -50%) scale(1.06);
	}

	/* 星核本体从「装饰」升级成「按钮」：画布是方的，命中区按圆切 */
	.holo-core {
		position: absolute;
		inset: 0;
		display: block;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		cursor: pointer;
		pointer-events: auto;
		-webkit-tap-highlight-color: transparent;
	}

	.holo-core:focus-visible {
		outline: 1px solid rgb(226 236 255 / 0.55);
		outline-offset: 8px;
	}

	.holo-ripples {
		position: absolute;
		inset: -30%;
		pointer-events: none;
	}

	.holo-ring {
		position: absolute;
		inset: 0;
		margin: auto;
		width: 40%;
		height: 40%;
		border: 1px solid hsl(var(--ring-hue, 205) 82% 76% / 0.5);
		border-radius: 50%;
		animation: holo-ring 1.5s cubic-bezier(0.2, 0.7, 0.3, 1) var(--delay, 0ms) 1 both;
	}

	/* 点星核来得比开卡快：一圈收得更紧、散得更快，才像"被打了一下" */
	.holo-ripples.is-core .holo-ring {
		animation-duration: 900ms;
		border-color: hsl(var(--ring-hue, 205) 88% 82% / 0.72);
	}

	.orbit-card {
		position: absolute;
		left: 0;
		top: 0;
		width: 132px;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		transform-origin: center;
		will-change: transform;
	}

	.orbit-card-inner {
		position: relative;
		display: block;
		border-radius: 10px;
		overflow: hidden;
		opacity: calc(0.62 + 0.38 * var(--depth, 1));
		box-shadow: 0 18px 40px rgb(0 0 0 / 0.55);
		transition: transform 260ms cubic-bezier(0.22, 0.9, 0.3, 1), box-shadow 260ms ease, opacity 260ms ease,
			filter 260ms ease;
	}

	.orbit-card img {
		display: block;
		width: 100%;
		height: auto;
	}

	/* 假镀膜：只做一点点斜向扫光，真镭射留给 overlay 里的着色器 */
	.orbit-card-foil {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 32%,
			color-mix(in srgb, var(--b) 55%, transparent) 46%,
			color-mix(in srgb, var(--a) 45%, transparent) 54%,
			transparent 68%
		);
		background-size: 260% 260%;
		background-position: 120% 0;
		mix-blend-mode: screen;
		opacity: 0.5;
		transition: background-position 700ms ease, opacity 300ms ease;
	}

	.orbit-card-meta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		color: rgb(238 243 255 / 0.62);
		opacity: calc(0.55 + 0.45 * var(--depth, 1));
	}

	.orbit-card-meta b {
		font-weight: 500;
	}

	.orbit-card-meta i {
		font-style: normal;
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.6rem;
		color: rgb(238 243 255 / 0.35);
	}

	.orbit-card.is-active .orbit-card-inner {
		transform: translateY(-14px) scale(1.06);
		box-shadow: 0 26px 60px rgb(0 0 0 / 0.6), 0 0 0 1px color-mix(in srgb, var(--b) 60%, transparent);
	}

	.orbit-card.is-active .orbit-card-foil {
		background-position: -20% 0;
		opacity: 0.85;
	}

	/* 悬停四联动之二：其余五张聚光降饱和 */
	.orbit-card.is-muted .orbit-card-inner {
		filter: saturate(0.3) brightness(0.6);
		opacity: 0.7;
	}

	/* 点下去那一下：卡面亮一档 + 外圈闪一道主色边。
	   刻意不碰 transform —— is-active 的抬升是用 transform 做的，两条动画抢同一个属性必然打架。 */
	.orbit-card.is-tapped .orbit-card-inner {
		animation: card-flash 560ms cubic-bezier(0.2, 0.8, 0.3, 1);
	}

	.holo-hud {
		position: absolute;
		left: 50%;
		top: clamp(3.4rem, 9vh, 5.6rem);
		z-index: 4;
		translate: -50% 0;
		width: min(760px, 88vw);
		text-align: center;
		opacity: 0;
		transition: opacity 700ms ease 120ms;
		pointer-events: none;
	}

	.holo-hud.is-ready {
		opacity: 1;
	}

	.holo-eyebrow {
		margin: 0 0 0.7rem;
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.62rem;
		letter-spacing: 0.34em;
		color: rgb(226 236 255 / 0.42);
	}

	.holo-headline {
		margin: 0;
		font-size: clamp(1.9rem, 4.4vw, 3.1rem);
		font-weight: 600;
		letter-spacing: 0.22em;
		text-indent: 0.22em;
		color: rgb(245 248 255 / 0.95);
		text-shadow: 0 0 40px hsl(205 80% 60% / 0.35);
	}

	.holo-note {
		margin: 0.85rem 0 0;
		font-size: 0.74rem;
		letter-spacing: 0.16em;
		color: rgb(226 236 255 / 0.46);
	}

	.holo-hint {
		margin: 1.5rem 0 0;
		font-size: 0.7rem;
		letter-spacing: 0.2em;
		color: rgb(226 236 255 / 0.3);
	}

	.holo-foot {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		padding: 0 1rem 1.6rem;
		pointer-events: none;
	}

	.holo-legend {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0.3rem;
		list-style: none;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 999px;
		background: rgb(8 12 24 / 0.55);
		backdrop-filter: blur(8px);
		pointer-events: auto;
	}

	.holo-legend button {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		padding: 0.34rem 0.72rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: rgb(226 236 255 / 0.55);
		font-size: 0.72rem;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease;
	}

	.holo-legend button span {
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.58rem;
		color: rgb(226 236 255 / 0.3);
	}

	.holo-legend button:hover,
	.holo-legend button.is-active {
		background: rgb(255 255 255 / 0.1);
		color: rgb(245 248 255 / 0.92);
	}

	.holo-legend button.is-tapped {
		background: rgb(255 255 255 / 0.26);
		color: rgb(255 255 255 / 0.98);
	}

	.holo-scroll {
		margin: 0;
		font-family: var(--font-jetbrains-mono), monospace;
		font-size: 0.6rem;
		letter-spacing: 0.26em;
		color: rgb(226 236 255 / 0.28);
	}

	@keyframes holo-ring {
		from {
			width: 34%;
			height: 34%;
			opacity: 0.85;
			transform: scale(0.4);
		}
		to {
			width: 34%;
			height: 34%;
			opacity: 0;
			transform: scale(3.4);
		}
	}

	@keyframes card-flash {
		0% {
			filter: brightness(1.55) saturate(1.25);
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--b) 85%, transparent), 0 20px 46px rgb(0 0 0 / 0.6);
		}
		100% {
			filter: brightness(1) saturate(1);
		}
	}

	/* 窄屏：整套轨道退回文档流，六张卡排成网格（决策 7：同一套 DOM 两套布局）。
	   两个 orbit 容器用 display:contents 抹掉自身，让卡片直接成为 stage 的网格项。 */
	@media (max-width: 1023px) {
		.holo-stage {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 1.5rem 0.9rem;
			align-content: start;
			padding: 10.5rem 1.1rem 2.6rem;
			min-height: 0;
		}

		.holo-orbit {
			position: static;
			width: auto;
			height: auto;
			display: contents;
		}

		.holo-sphere {
			position: relative;
			left: auto;
			top: auto;
			transform: none;
			grid-column: 1 / -1;
			justify-self: center;
			width: min(52vw, 230px);
		}

		.holo-sphere.is-active {
			transform: none;
		}

		.orbit-card {
			position: static;
			width: auto;
			/* 内联 transform 由 rAF 写，窄屏必须用 !important 压掉 */
			transform: none !important;
		}

		.orbit-card-inner {
			opacity: 1;
		}

		.holo-hud {
			top: 5rem;
		}

		.holo-legend {
			display: none;
		}
	}

	@media (max-width: 560px) {
		.holo-stage {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.holo-hud,
		.orbit-card-inner,
		.orbit-card-foil,
		.holo-sphere {
			transition: none;
		}

		.holo-ring {
			animation: none;
			opacity: 0;
		}

		/* 动效关了也不能没有反馈：给一个静态高亮顶替那 520ms */
		.orbit-card.is-tapped .orbit-card-inner {
			animation: none;
			filter: brightness(1.25);
			box-shadow: 0 0 0 2px color-mix(in srgb, var(--b) 85%, transparent);
		}
	}
</style>
