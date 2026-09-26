"""烘「笔顺骨架」数据：双位面页用到的全部汉字。

数据源 hanzi-writer-data（Make Me a Hanzi 的派生数据），只在烘数据时从 CDN 取一次；
仓库里不留依赖、运行期不加载任何字体 —— 换台机器字形也不会变。

每字输出：n = 每笔的点数（按书写顺序），p = 扁平坐标（各笔依次拼接），
w = 每点的半宽。半宽是**量出来的**：拿每个中线点到它自己那一笔轮廓的距离，
取最小值。所以提按顿挫是真的，不是画上去的。

用法：<python> scripts/bake-dual-glyphs.py
"""
import json
import math
import os
import re
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "components", "dual", "glyphs.ts")
CDN = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/{}.json"

# ── 字表 ────────────────────────────────────────────────────────────────
DIZHI = "子丑寅卯辰巳午未申酉戌亥"
SHICHEN = ["夜半", "鸡鸣", "平旦", "日出", "食时", "隅中",
           "日中", "日昃", "晡时", "日入", "黄昏", "人定"]
YUELING = ["正月", "二月", "三月", "四月", "五月", "六月",
           "七月", "八月", "九月", "十月", "冬月", "腊月"]
READOUT = "年月日时分秒"
# 「书写汉字」的池子：一个字就是一幅画
POOL = "山水云风花雪灯影光墨梦鹤竹茶江剑星河尘归春秋舟"

chars = []
for part in (DIZHI, "".join(SHICHEN), "".join(YUELING), READOUT, POOL):
    for ch in part:
        if ch not in chars:
            chars.append(ch)

# ── SVG path 采样（只要 M / L / Q / C / Z，hanzi-writer 就这几种）──────
NUM = re.compile(r"-?\d+(?:\.\d+)?")
CMD = re.compile(r"([MLQCZmlqcz])([^MLQCZmlqcz]*)")

def sample_path(d: str, steps: int = 6):
    pts = []
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    for cmd, args in CMD.findall(d):
        v = [float(x) for x in NUM.findall(args)]
        if cmd in "Mm":
            for i in range(0, len(v) - 1, 2):
                cur = (v[i], v[i + 1])
                start = cur
                pts.append(cur)
        elif cmd in "Ll":
            for i in range(0, len(v) - 1, 2):
                for s in range(1, steps + 1):
                    t = s / steps
                    pts.append((cur[0] + (v[i] - cur[0]) * t,
                                cur[1] + (v[i + 1] - cur[1]) * t))
                cur = (v[i], v[i + 1])
        elif cmd in "Qq":
            for i in range(0, len(v) - 3, 4):
                p0, p1, p2 = cur, (v[i], v[i + 1]), (v[i + 2], v[i + 3])
                for s in range(1, steps + 1):
                    t = s / steps
                    u = 1 - t
                    pts.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
                cur = p2
        elif cmd in "Cc":
            for i in range(0, len(v) - 5, 6):
                p0, p1 = cur, (v[i], v[i + 1])
                p2, p3 = (v[i + 2], v[i + 3]), (v[i + 4], v[i + 5])
                for s in range(1, steps + 1):
                    t = s / steps
                    u = 1 - t
                    pts.append((
                        u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                        u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
                cur = p3
        elif cmd in "Zz":
            for s in range(1, steps + 1):
                t = s / steps
                pts.append((cur[0] + (start[0] - cur[0]) * t,
                            cur[1] + (start[1] - cur[1]) * t))
            cur = start
    return pts


import urllib.error
import urllib.parse


def fetch(ch: str):
    """取一个字的数据。404 = 这个字不在包里，返回 None 让上层跳过（不静默留半个字）。"""
    for attempt in range(4):
        try:
            url = CDN.format(urllib.parse.quote(ch))
            with urllib.request.urlopen(url, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == 3:
                raise
            time.sleep(2)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {ch}: {e}")
            time.sleep(2)
    return None


# hanzi-writer 的坐标是 1024×1024、y 轴向下、原点左上。换到 em 框中心、y 向上。
def norm(x: float, y: float):
    return round((x - 512) / 512, 4), round((512 - y) / 512, 4)


result: dict[str, dict] = {}
missing: list[str] = []
for i, ch in enumerate(chars, 1):
    data = fetch(ch)
    if not data or not data.get("medians"):
        missing.append(ch)
        print(f"[{i:>2}/{len(chars)}] {ch}  ← 包里没有，跳过")
        continue
    n, p, w = [], [], []
    for stroke, medians in zip(data["strokes"], data["medians"]):
        outline = sample_path(stroke)
        # 中线太密就均匀抽稀到 15 点以内（数据里本来就 3–15 点）
        pts = medians
        if len(pts) > 15:
            keep = 15
            pts = [pts[round(k * (len(pts) - 1) / (keep - 1))] for k in range(keep)]
        pts = [pt for pt in pts]
        n.append(len(pts))
        for (mx, my) in pts:
            best = 1e9
            for (ox, oy) in outline:
                dd = (ox - mx) ** 2 + (oy - my) ** 2
                if dd < best:
                    best = dd
            X, Y = norm(mx, my)
            p.extend([X, Y])
            w.append(round(math.sqrt(best) / 512, 4))
    result[ch] = {"n": n, "p": p, "w": w}
    print(f"[{i:>2}/{len(chars)}] {ch} 笔画={len(n)} 点={len(p) // 2}")

lines = [
    "// 「笔顺骨架」—— 双位面页里所有毛笔字都由这份数据写出来。",
    "//",
    "// 这是**生成物**，别手改：跑 `scripts/bake-dual-glyphs.py` 重新产。",
    "// 数据源是 hanzi-writer-data（Make Me a Hanzi 的派生数据），只在烘数据时从 CDN 取一次，",
    "// 仓库里不留依赖、运行期也不加载字体 —— 换台机器字形不会变。",
    "//",
    "// 每字：n = 每笔的点数（按书写顺序），p = 扁平坐标 [x0,y0,x1,y1,...]（各笔依次拼接），",
    "// w = 每点的半宽（由该笔轮廓到中线的距离量出，所以提按顿挫是真的，不是画上去的）。",
    "// 坐标已归一化到 [-1,1]、y 轴向上、原点在 em 框中心；同一 em 框所以字距天然正确。",
    "//",
    "// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: 这些小数是量出来的坐标与笔宽，",
    "// 不是「写了个近似常量」。偶尔撞上 √2/2 之类的值纯属巧合。",
    "",
    "export type BrushGlyph = {",
    "\tn: number[];",
    "\tp: number[];",
    "\tw: number[];",
    "};",
    "",
    "export const BRUSH_STROKES: Record<string, BrushGlyph> = {",
]
for ch, g in result.items():
    lines.append(f"\t{ch}: {{")
    lines.append("\t\tn: [" + ", ".join(str(v) for v in g["n"]) + "],")
    body = ", ".join(str(v) for v in g["p"])
    lines.append("\t\tp: [" + body + "],")
    lines.append("\t\tw: [" + ", ".join(str(v) for v in g["w"]) + "],")
    lines.append("\t},")
lines.append("};")
lines.append("")

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))
print("wrote", os.path.abspath(OUT), len(result), "chars")
if missing:
    print("MISSING:", "".join(missing))
