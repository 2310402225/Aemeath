// 中间的分界线：时间之河。
//
// 它是这一页唯一"横着"的东西 —— 上面是寰宇、下面是水墨，河既是分割线也是两者的
// 唯一通道：手在河上过一下，一圈涟漪会同时往星空和水墨里各推一段波纹（`pulse`）。
//
// 河道本体是一条会流的银金流体：不是贴一张渐变，而是拿十几道横着走的短线
// 按相位错开画出来，于是"流动"是真的在流，而不是把渐变挪一挪。

import { clamp, type Dual, lerp, type View } from "./state";

type Ripple = { x: number; t: number; p: number };

export type River = {
	resize(view: View): void;
	draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number): void;
	/** 在 x 处扰一下（悬停/点击）。会推一圈涟漪，并把波纹送进上下两个位面。 */
	disturb(x: number, power: number): void;
};

export function createRiver(): River {
	let ripples: Ripple[] = [];
	let phase = 0;
	/** 扰动的余波：0..1，扰一次置 1，然后衰减。它同时驱动"往两侧推的波前"。 */
	let pulse = 0;
	let seed = 7771;
	const rnd = () => {
		seed = (seed * 1103515245 + 12345) >>> 0;
		return seed / 4294967296;
	};

	function resize(_view: View) {
		ripples = [];
		pulse = 0;
	}

	function disturb(x: number, power: number) {
		ripples.push({ x, t: 0, p: clamp(power, 0.2, 1) });
		if (ripples.length > 14) ripples.shift();
		pulse = Math.min(1, pulse + power);
	}

	function draw(g: CanvasRenderingContext2D, d: Dual, view: View, dt: number) {
		const { w, h } = view;
		const river = view.river;
		const calm = d.calm ? 0.3 : 1;
		// 时间越旧，河走得越慢 —— 这条是从共享态里读的，不是自己拍的
		const speed = (0.42 - 0.3 * d.age) * calm;
		phase += dt * speed;

		pulse = Math.max(0, pulse - dt * 0.55);
		const halfH = clamp(h * 0.028, 15, 46) * (1 + pulse * 0.5);
		const amp = halfH * (0.42 + pulse * 0.5) + d.wave * halfH * 0.5;

		const edge = (x: number, sign: number) =>
			river +
			sign * halfH +
			Math.sin(x * 0.0042 + phase * 2.1 + sign) * amp * 0.34 +
			Math.sin(x * 0.0113 - phase * 3.4) * amp * 0.14;

		// 河体：上边从左到右、下边从右到左
		g.beginPath();
		g.moveTo(0, edge(0, -1));
		for (let x = 0; x <= w; x += 8) g.lineTo(x, edge(x, -1));
		for (let x = w; x >= 0; x -= 8) g.lineTo(x, edge(x, 1));
		g.closePath();

		const body = g.createLinearGradient(0, 0, w, 0);
		body.addColorStop(0, "rgb(150 132 104 / 0.1)");
		body.addColorStop(
			0.16,
			`rgb(${Math.round(lerp(214, 168, d.age))} ${Math.round(lerp(198, 146, d.age))} ${Math.round(lerp(160, 108, d.age))} / 0.34)`,
		);
		body.addColorStop(
			0.5,
			`rgb(${Math.round(lerp(255, 214, d.age))} ${Math.round(lerp(246, 196, d.age))} ${Math.round(lerp(220, 164, d.age))} / 0.72)`,
		);
		body.addColorStop(
			0.84,
			`rgb(${Math.round(lerp(214, 168, d.age))} ${Math.round(lerp(198, 146, d.age))} ${Math.round(lerp(160, 108, d.age))} / 0.34)`,
		);
		body.addColorStop(1, "rgb(150 132 104 / 0.1)");
		g.globalCompositeOperation = "lighter";
		g.fillStyle = body;
		g.fill();

		// 流体：十几道横着走的短线，按相位错开，看起来才"流"
		const strands = d.lite ? 10 : 20;
		for (let i = 0; i < strands; i++) {
			const u = (i + 0.5) / strands;
			const y = river + (u - 0.5) * halfH * 1.7;
			const len = w * (0.1 + 0.26 * rnd());
			const sp = phase * (26 + 40 * u) * (i % 2 ? 1 : 1.35);
			const x = ((sp % (w + len)) + w + len) % (w + len);
			const a = (0.06 + 0.14 * Math.sin(u * Math.PI)) * (0.6 + 0.4 * pulse);
			g.strokeStyle = `rgb(${Math.round(lerp(255, 216, d.age))} ${Math.round(
				lerp(240, 198, d.age),
			)} ${Math.round(lerp(204, 156, d.age))} / ${a})`;
			g.lineWidth = 0.8 + 1.5 * Math.sin(u * Math.PI);
			g.beginPath();
			g.moveTo(x - len / 2, y);
			g.lineTo(x + len / 2, y + Math.sin(phase * 3 + i) * 1.4);
			g.stroke();
		}

		// 中央那道亮芯
		const core = g.createLinearGradient(
			0,
			river - halfH * 0.3,
			0,
			river + halfH * 0.3,
		);
		core.addColorStop(0, "rgb(255 250 236 / 0)");
		core.addColorStop(0.5, `rgb(255 252 240 / ${0.42 * (1 - 0.4 * d.age)})`);
		core.addColorStop(1, "rgb(255 250 236 / 0)");
		g.fillStyle = core;
		g.fillRect(0, river - halfH * 0.3, w, halfH * 0.6);
		g.globalCompositeOperation = "source-over";

		// 往两侧推的波前：上下去各几条，越远越淡（这就是"波纹传播"）
		const front = pulse;
		if (front > 0.01) {
			for (let k = 1; k <= 5; k++) {
				for (const sign of [-1, 1]) {
					const y = river + sign * (halfH + k * (14 + 26 * (1 - front)));
					const a = front * 0.2 * (1 - k / 6) * (sign < 0 ? 0.9 : 0.75);
					if (a <= 0.004) continue;
					g.strokeStyle =
						sign < 0 ? `rgb(226 234 255 / ${a})` : `rgb(64 52 40 / ${a})`;
					g.lineWidth = 1;
					g.beginPath();
					for (let x = 0; x <= w; x += 12) {
						g.lineTo(
							x,
							y + Math.sin(x * 0.006 + phase * 4 + k) * (3 + 5 * front),
						);
					}
					g.stroke();
				}
			}
		}

		// 涟漪：一圈一圈的扁椭圆，从扰动点摊开
		for (let i = ripples.length - 1; i >= 0; i--) {
			const r = ripples[i];
			r.t += dt;
			if (r.t > 2.2) {
				ripples.splice(i, 1);
				continue;
			}
			const u = r.t / 2.2;
			const rr = (0.06 + u * 0.5) * w;
			g.strokeStyle = `rgb(255 248 226 / ${(1 - u) * 0.22 * r.p})`;
			g.lineWidth = 1.4 - u;
			g.beginPath();
			g.ellipse(r.x, river, rr, rr * 0.14, 0, 0, Math.PI * 2);
			g.stroke();
		}

		// 水面倒映的同心环（图三里地平线下那几道）—— 河的这一侧才有，
		// 所以必须先夹到河以下：不夹的话这几道金环会飘到星空上去，像一块镜头光斑。
		g.save();
		g.beginPath();
		g.rect(0, river, w, h - river);
		g.clip();
		g.globalCompositeOperation = "lighter";
		for (let i = 1; i <= 3; i++) {
			const ry = halfH + i * h * 0.055;
			g.strokeStyle = `rgb(${Math.round(lerp(220, 168, d.age))} ${Math.round(
				lerp(180, 130, d.age),
			)} ${Math.round(lerp(112, 72, d.age))} / ${0.16 - i * 0.035})`;
			g.lineWidth = 1;
			g.beginPath();
			g.ellipse(w / 2, river, w * (0.16 + i * 0.11), ry, 0, 0, Math.PI * 2);
			g.stroke();
		}
		g.restore();
		g.globalCompositeOperation = "source-over";
	}

	return { resize, draw, disturb };
}
