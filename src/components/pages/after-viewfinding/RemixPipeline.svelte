<script lang="ts">
const steps = [
	{
		id: "01",
		title: "参考",
		detail: "只选一个真正想研究的页面或组件，写下要取走的那一种能力。",
		output: "输入：1 个参考 + 1 个取景目标",
	},
	{
		id: "02",
		title: "拆解",
		detail: "把空间、输入、反馈和叙事拆开，不把成品当成一个不可分的整体。",
		output: "输出：可替换的机制清单",
	},
	{
		id: "03",
		title: "重写",
		detail: "替换内容和品牌，只保留一个核心机制，再补上自己的角色与场景。",
		output: "输出：原创交互草案",
	},
	{
		id: "04",
		title: "测试",
		detail:
			"检查键盘、触屏、减少动效模式和低性能设备，再决定动效是否值得保留。",
		output: "输出：边界与降级方案",
	},
	{
		id: "05",
		title: "署名",
		detail: "记录来源、许可和改写范围。代码、素材和灵感都要留下可追溯的出处。",
		output: "输出：可复用且可署名的任务单",
	},
];

let current = 0;
let completed = false;
let copied = false;

const taskBrief = `制作一个深色夜间终端风格的交互项目展示页。
结构：项目说明卡 + 可操作舞台，六个模块依次出现。
交互：只保留指针、点击或拖动中的一种主动作，并给出触屏替代。
限制：移动端可操作，支持 prefers-reduced-motion，不搬运未经授权的角色或模型素材。
验证：正文不被 Demo 挤压；关闭动效后，每个模块仍能读懂。`;

function advance() {
	if (completed) return;
	if (current === steps.length - 1) {
		completed = true;
		return;
	}
	current += 1;
}

function reset() {
	current = 0;
	completed = false;
	copied = false;
}

async function copyBrief() {
	await navigator.clipboard.writeText(taskBrief);
	copied = true;
	window.setTimeout(() => (copied = false), 1400);
}
</script>

<div class="pipeline-lab">
	<div class="pipeline-track">
		{#each steps as step, index}
			<button
				type="button"
				class:done={completed || index < current}
				class:active={!completed && index === current}
				on:click={() => {
					if (completed || index <= current) {
						current = index;
						completed = false;
					}
				}}
			>
				<span>{step.id}</span>
				<strong>{step.title}</strong>
			</button>
		{/each}
	</div>

	<div class="step-panel">
		{#if completed}
			<div class="brief-card">
				<div class="brief-head">
					<div>
						<span>FLOW COMPLETE</span>
						<strong>可复制的 Codex 任务单</strong>
					</div>
					<button type="button" on:click={copyBrief}>{copied ? "已复制" : "复制任务单"}</button>
				</div>
				<pre>{taskBrief}</pre>
			</div>
		{:else}
			<div class="step-number">{steps[current].id}</div>
			<div class="step-copy">
				<p>PIPELINE STEP</p>
				<h4>{steps[current].title}</h4>
				<span>{steps[current].detail}</span>
				<code>{steps[current].output}</code>
			</div>
		{/if}
	</div>

	<div class="pipeline-actions">
		<div class="progress" aria-label={`流程进度 ${completed ? 5 : current + 1}/5`}>
			{#each steps as _, index}
				<span class:filled={completed || index <= current}></span>
			{/each}
		</div>
		<button type="button" class="ghost" on:click={reset}>重置</button>
		<button type="button" class="primary" on:click={advance} disabled={completed}>
			{completed ? "流程完成" : current === steps.length - 1 ? "生成任务单" : "推进下一步"}
		</button>
	</div>
</div>

<style>
	.pipeline-lab {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
	}

	.pipeline-track {
		position: relative;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.3rem;
	}

	.pipeline-track::before {
		position: absolute;
		top: 0.9rem;
		right: 6%;
		left: 6%;
		height: 1px;
		background: rgb(255 255 255 / 10%);
		content: "";
	}

	.pipeline-track button {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 0.2rem;
		justify-items: center;
		padding: 0.4rem 0.2rem;
		border: 0;
		background: transparent;
		color: #617b8d;
		font: inherit;
		cursor: pointer;
	}

	.pipeline-track button span {
		display: grid;
		width: 1.75rem;
		aspect-ratio: 1;
		place-items: center;
		border: 1px solid #31495a;
		border-radius: 50%;
		background: #06111b;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.55rem;
	}

	.pipeline-track button strong {
		font-size: 0.64rem;
		font-weight: 600;
	}

	.pipeline-track button.done span {
		border-color: #7cf0c4;
		background: #7cf0c4;
		color: #06111b;
	}

	.pipeline-track button.active span {
		border-color: #72e6ff;
		box-shadow: 0 0 0 4px rgb(114 230 255 / 10%);
		color: #eafcff;
	}

	.step-panel {
		position: relative;
		display: flex;
		min-height: 260px;
		flex: 1;
		align-items: center;
		overflow: hidden;
		border: 1px solid rgb(255 255 255 / 8%);
		border-radius: 6px;
		background:
			linear-gradient(rgb(124 240 196 / 4%) 1px, transparent 1px),
			linear-gradient(90deg, rgb(124 240 196 / 4%) 1px, transparent 1px),
			#040c14;
		background-size: 22px 22px;
	}

	.step-number {
		width: 34%;
		color: rgb(124 240 196 / 28%);
		font-family: "JetBrains Mono Variable", monospace;
		font-size: clamp(4rem, 10vw, 7.5rem);
		font-weight: 800;
		line-height: 1;
		text-align: center;
	}

	.step-copy {
		max-width: 29rem;
		padding: 1rem 1.2rem 1rem 0;
	}

	.step-copy p {
		margin: 0 0 0.4rem;
		color: #7cf0c4;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.56rem;
	}

	.step-copy h4 {
		margin: 0;
		color: #f3fbff;
		font-size: clamp(1.55rem, 4vw, 2.45rem);
		line-height: 1;
	}

	.step-copy span {
		display: block;
		margin-top: 0.65rem;
		color: #9eb3c2;
		font-size: 0.78rem;
		line-height: 1.7;
	}

	.step-copy code {
		display: inline-block;
		margin-top: 0.75rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid rgb(124 240 196 / 20%);
		border-radius: 4px;
		color: #b9d8cc;
		font-size: 0.6rem;
	}

	.brief-card {
		width: 100%;
		height: 100%;
		padding: 0.85rem;
	}

	.brief-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding-bottom: 0.7rem;
		border-bottom: 1px solid rgb(255 255 255 / 8%);
	}

	.brief-head div {
		display: grid;
		gap: 0.15rem;
	}

	.brief-head span {
		color: #7cf0c4;
		font-family: "JetBrains Mono Variable", monospace;
		font-size: 0.54rem;
	}

	.brief-head strong {
		color: #f3fbff;
		font-size: 0.86rem;
	}

	.brief-head button {
		padding: 0.45rem 0.6rem;
		border: 1px solid rgb(124 240 196 / 28%);
		border-radius: 4px;
		background: rgb(124 240 196 / 8%);
		color: #c9f6e4;
		font: inherit;
		font-size: 0.62rem;
		cursor: pointer;
	}

	pre {
		margin: 0;
		padding-top: 0.7rem;
		color: #d7e8e1;
		font-family: "LXGW WenKai Screen", "JetBrains Mono Variable", monospace;
		font-size: 0.68rem;
		line-height: 1.75;
		white-space: pre-wrap;
	}

	.pipeline-actions {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 0.45rem;
		align-items: center;
	}

	.progress {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.25rem;
	}

	.progress span {
		height: 0.24rem;
		border-radius: 999px;
		background: #243948;
	}

	.progress span.filled {
		background: #7cf0c4;
	}

	.pipeline-actions button {
		padding: 0.48rem 0.7rem;
		border-radius: 4px;
		font: inherit;
		font-size: 0.65rem;
		cursor: pointer;
	}

	.pipeline-actions .ghost {
		border: 1px solid rgb(255 255 255 / 9%);
		background: rgb(255 255 255 / 3%);
		color: #91a8b8;
	}

	.pipeline-actions .primary {
		border: 1px solid #7cf0c4;
		background: #7cf0c4;
		color: #07130f;
		font-weight: 700;
	}

	.pipeline-actions .primary:disabled {
		border-color: #466c60;
		background: #35594e;
		color: #88aa9f;
		cursor: default;
	}

	@media (max-width: 640px) {
		.step-panel {
			min-height: 245px;
		}

		.step-number {
			position: absolute;
			top: 0.8rem;
			right: 1rem;
			width: auto;
			font-size: 4.2rem;
			opacity: 0.5;
		}

		.step-copy {
			padding: 1.25rem;
		}

		.pipeline-actions {
			grid-template-columns: 1fr auto;
		}

		.progress {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 480px) {
		.pipeline-track button strong {
			font-size: 0.58rem;
		}
	}
</style>
