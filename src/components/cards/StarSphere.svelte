<script lang="ts">
/**
 * 轨道中心的星核：三条正交发光环 + 一团彩色粒子核。
 *
 * 这个文件只负责「挂载 + 无 WebGL 时的静态兜底」——绘制全在 star-field.ts。
 * 之所以拆出去：那是个纯 TS 模块，离线试验台可以直接 import 同一份代码，
 * 不必把着色器复制一份出来，也就不会出现「验的那版和跑的那版不是同一版」。
 */
import { onMount } from "svelte";
import { mountStarField, type StarFieldHandle } from "./star-field";

interface Props {
	/** 色相（度）。六张卡各给一个，悬停时跟随 */
	hue?: number;
	accent?: number;
	/** 冻结时间（overlay 打开时用） */
	frozen?: boolean;
	/** 把句柄交出去，宿主就能在点击星核时 pulse() */
	onReady?: (handle: StarFieldHandle) => void;
}

let { hue = 205, accent = 0, frozen = false, onReady }: Props = $props();

let canvas: HTMLCanvasElement | undefined = $state();
let fallback = $state(false);

onMount(() => {
	const element = canvas;
	if (!element) return;
	// read() 每次现取：解构出的 props 在 Svelte 5 里是 getter，拿到的是最新值
	const handle = mountStarField(element, () => ({ hue, accent, frozen }));
	if (!handle) {
		fallback = true;
		return;
	}
	onReady?.(handle);
	return () => handle.destroy();
});
</script>

<div class="star-field" style:--core-hue="{hue}">
	<canvas bind:this={canvas} class="star-field-canvas"></canvas>

	{#if fallback}
		<div class="star-field-fallback">
			<span class="fallback-ring fallback-ring--a"></span>
			<span class="fallback-ring fallback-ring--b"></span>
			<span class="fallback-ring fallback-ring--c"></span>
			<span class="fallback-core"></span>
		</div>
	{/if}
</div>

<style>
	.star-field {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
	}

	.star-field-canvas {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* 没有 WebGL 时退回静态构图：三个倾角不同的环 + 中心一点微光。
	   不发光、不旋转，但体积与位置跟着色器那版一致，版式不会塌。 */
	.star-field-fallback {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.fallback-ring {
		position: absolute;
		border: 1px solid hsl(var(--core-hue) 55% 78% / 0.45);
		border-radius: 50%;
	}

	.fallback-ring--a {
		inset: 30% 22%;
		transform: scaleY(0.34);
	}

	.fallback-ring--b {
		inset: 24% 16%;
		transform: rotate(58deg) scaleY(0.44);
	}

	.fallback-ring--c {
		inset: 18% 10%;
		transform: rotate(-52deg) scaleY(0.48);
	}

	.fallback-core {
		position: absolute;
		inset: 40%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			hsl(var(--core-hue) 72% 88% / 0.9) 0%,
			hsl(var(--core-hue) 62% 70% / 0.45) 45%,
			transparent 72%
		);
		filter: blur(1.5px);
	}
</style>
