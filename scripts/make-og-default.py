"""从现有壁纸素材生成 1200x630 的站点默认 OG 卡片图。

非文章页（首页 / 归档 / 标签 …）分享时用它做 og:image。
只做「取现有壁纸 + 压暗 + 叠站点名」，不引入新的美术素材。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(r"C:\vibe coding\blog\Aemeath\public")
SRC = ROOT / "assets" / "images" / "wallpaper" / "wallpaper-27.webp"
OUT = ROOT / "assets" / "images" / "og-default.jpg"

W, H = 1200, 630
TITLE = "载尘望星"
SUBTITLE = "城之内，是尘埃与眼泪；城之外，是星宇与长河"

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def cover_resize(img: Image.Image) -> Image.Image:
    scale = max(W / img.width, H / img.height)
    return img.resize(
        (max(W, round(img.width * scale)), max(H, round(img.height * scale))),
        Image.LANCZOS,
    )


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    src = cover_resize(src)
    left = (src.width - W) // 2
    top = (src.height - H) // 2
    canvas = src.crop((left, top, left + W, top + H)).convert("RGBA")

    # 左侧文字区压暗，保证标题可读（文字从 x≈96 开始）
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(W):
        t = max(0.0, (W * 0.72 - x) / (W * 0.72))
        sd.line([(x, 0), (x, H)], fill=int(165 * t * t))
    dark = Image.new("RGBA", (W, H), (9, 11, 22, 255))
    canvas = Image.composite(dark, canvas, shade)

    draw = ImageDraw.Draw(canvas)
    font_title = load_font(96)
    font_sub = load_font(34)

    # 标题
    tx, ty = 96, H // 2 - 96
    draw.text((tx + 3, ty + 4), TITLE, font=font_title, fill=(0, 0, 0, 170))
    draw.text((tx, ty), TITLE, font=font_title, fill=(255, 255, 255, 255))

    # 分隔短线
    box = draw.textbbox((tx, ty), TITLE, font=font_title)
    line_y = box[3] + 30
    draw.rounded_rectangle(
        [tx, line_y, tx + 108, line_y + 5], radius=3, fill=(120, 160, 255, 255)
    )

    draw.text((tx, line_y + 30), SUBTITLE, font=font_sub, fill=(226, 232, 245, 255))

    canvas.convert("RGB").save(OUT, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"{OUT}  {OUT.stat().st_size / 1024:.1f} KB  {W}x{H}")


if __name__ == "__main__":
    main()
