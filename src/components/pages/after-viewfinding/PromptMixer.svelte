<script lang="ts">
type OptionKey = "composition" | "material" | "motion" | "constraint";

const optionGroups: Array<{
	key: OptionKey;
	label: string;
	options: Array<{ label: string; value: string }>;
}> = [
	{
		key: "composition",
		label: "构图",
		options: [
			{
				label: "左右叙事",
				value: "两栏首屏，左侧负责主张，右侧保留角色主视觉",
			},
			{ label: "中心聚焦", value: "中心构图，只允许一个主标题和一个行动入口" },
			{ label: "滚动分镜", value: "四段纵向分镜，每段只改变一个信息层级" },
		],
	},
	{
		key: "material",
		label: "材质",
		options: [
			{ label: "夜间终端", value: "深色网格、细线边框、冷白文字与局部霓虹色" },
			{
				label: "日系纸张",
				value: "暖白纸张、墨色排版、低饱和图片与少量荧光标记",
			},
			{
				label: "透明面板",
				value: "半透明控制面板叠加环境网格，不使用实色大卡片",
			},
		],
	},
	{
		key: "motion",
		label: "动效",
		options: [
			{
				label: "指针跟随",
				value: "指针移动驱动 4-18px 视差，离开后 240ms 回位",
			},
			{
				label: "逐段揭示",
				value: "滚动进入时只做一次淡入与轻微上移，避免持续呼吸",
			},
			{ label: "点击脉冲", value: "点击触发局部扩散，动画结束后恢复静止" },
		],
	},
	{
		key: "constraint",
		label: "克制度",
		options: [
			{
				label: "保守",
				value: "移动端关闭指针效果，支持 reduced-motion，首屏不超过两种动画",
			},
			{
				label: "平衡",
				value: "桌面保留一条主动效，移动端只保留点击反馈与轻量转场",
			},
			{
				label: "大胆",
				value: "允许多层视差，但任一时刻只允许一个元素成为视觉焦点",
			},
		],
	},
];

let selected: Record<OptionKey, number> = {
	composition: 0,
	material: 2,
	motion: 0,
	constraint: 1,
};
let copied = false;
let prompt = "";

$: prompt = [
	`结构：${optionGroups[0].options[selected.composition].value}。`,
	`材质：${optionGroups[1].options[selected.material].value}。`,
	`动效：${optionGroups[2].options[selected.motion].value}。`,
	`限制：${optionGroups[3].options[selected.constraint].value}。`,
].join("\n");

function chooseOption(key: OptionKey, index: number) {
	selected = { ...selected, [key]: index };
	copied = false;
}

async function copyPrompt() {
	await navigator.clipboard.writeText(prompt);
	copied = true;
	window.setTimeout(() => (copied = false), 1400);
}
</script>

<div class="prompt-mixer">
	<div class="option-groups">
		{#each optionGroups as group}
			<div class="option-group">
				<div class="option-label">{group.label}</div>
				<div class="option-row">
					{#each group.options as option, index}
						<button
							type="button"
							class:active={selected[group.key] === index}
							on:click={() => chooseOption(group.key, index)}
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<div class="prompt-output">
		<div class="output-head">
			<span>GENERATED BRIEF</span>
			<button type="button" on:click={copyPrompt}>{copied ? "已复制" : "复制提示词"}</button>
		</div>
		<pre>{prompt}</pre>
	</div>
</div>

<style>
	.prompt-mixer {
		display: grid;
		min-width: 0;
		flex: 1;
		grid-template-columns: minmax(0, 1fr) minmax(220px, 0.82fr);
		gap: 0.9rem;
	}

	.option-groups {
		display: grid;
		gap: 0.62rem;
	}

	.option-group {
		display: grid;
		grid-template-columns: 3.5rem minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
	}

	.option-label {
		padding-top: 0.42rem;
		color: #6f899a;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.58rem;
	}

	.option-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.32rem;
	}

	.option-row button {
		padding: 0.42rem 0.56rem;
		border: 1px solid rgb(255 255 255 / 9%);
		border-radius: 999px;
		background: rgb(255 255 255 / 3%);
		color: #94aab9;
		font: inherit;
		font-size: 0.65rem;
		cursor: pointer;
	}

	.option-row button.active {
		border-color: #ff7ca8;
		background: rgb(255 124 168 / 12%);
		color: #fff4f8;
	}

	.prompt-output {
		display: flex;
		min-width: 0;
		min-height: 310px;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid rgb(255 209 102 / 24%);
		border-radius: 6px;
		background: #07131c;
	}

	.output-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.55rem 0.65rem;
		border-bottom: 1px solid rgb(255 255 255 / 8%);
		color: #ffd166;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.56rem;
	}

	.output-head button {
		border: 0;
		background: transparent;
		color: #a9bcc8;
		font: inherit;
		cursor: pointer;
	}

	.output-head button:hover,
	.output-head button:focus-visible {
		color: #fff;
	}

	pre {
		margin: 0;
		padding: 0.9rem;
		overflow: auto;
		color: #dceaf2;
		font-family: "LXGW WenKai Screen", "JetBrains Mono Variable", monospace;
		font-size: 0.7rem;
		line-height: 1.8;
		white-space: pre-wrap;
	}

	@media (max-width: 700px) {
		.prompt-mixer {
			grid-template-columns: 1fr;
		}

		.prompt-output {
			min-height: 230px;
		}
	}

	@media (max-width: 480px) {
		.option-group {
			grid-template-columns: 1fr;
			gap: 0.3rem;
		}
	}
</style>
