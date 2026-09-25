// 音效：默认关，而且只有用户真的按过那个开关之后才可能有声音。
//
// 为什么默认关、还要做成开关：这一页是「安静地看一会儿」的地方，一进来就出声是冒犯；
// 而浏览器也只允许在有用户手势之后放音 —— 那个开关本身就是那个手势，一举两得。
//
// 一共四声，全是二十毫秒级的三角波，没有一个音频文件：拨针过格一声「嗒」、
// 收藏一声「叮」、推窗一声「笃」、落笔一声极轻的「簌」。

let actx: AudioContext | null = null;
let enabled = false;

/** 开 / 关。开的时候顺手把 AudioContext 建起来（必须在用户手势里建，否则被挂起）。 */
export function setSound(next: boolean): void {
	enabled = next;
	if (!next) return;
	try {
		if (!actx) {
			const Ctor =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext })
					.webkitAudioContext;
			if (!Ctor) {
				enabled = false;
				return;
			}
			actx = new Ctor();
		}
		void actx.resume();
	} catch {
		// 拿不到音频上下文就当没这个功能，别把整页拖下去
		enabled = false;
	}
}

export function soundOn(): boolean {
	return enabled;
}

/** 一声。freq 是起始频率，ms 是长度 —— 越短越像「嗒」，越长越像「嘟」。 */
export function blip(freq: number, ms: number, gain = 0.05): void {
	if (!enabled || !actx) return;
	const t0 = actx.currentTime;
	const osc = actx.createOscillator();
	const g = actx.createGain();
	osc.type = "triangle";
	osc.frequency.setValueAtTime(freq, t0);
	osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t0 + ms / 1000);
	// ⚠️ 先 setValueAtTime 再 ramp：指数斜坡不许从 0 起步（gain 默认就是 0）
	g.gain.setValueAtTime(gain, t0);
	g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
	osc.connect(g).connect(actx.destination);
	osc.start(t0);
	osc.stop(t0 + ms / 1000 + 0.02);
}
