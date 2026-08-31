"""Regenerate TripDock web icons and the social card from the approved source logo."""

from hashlib import sha256
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "apps" / "web" / "public"
BRAND = PUBLIC / "brand"
ICONS = PUBLIC / "icons"
SOURCE = BRAND / "tripdock-logo.png"
EXPECTED_SHA256 = "6a882e3d4d7360566ffa01c784f8cc3f492686d46934315120cc83f137e43c1c"
WARM = "#faf8f4"
RESAMPLE = Image.Resampling.LANCZOS


def tile(mark: Image.Image, canvas: int, artwork: int) -> Image.Image:
    output = Image.new("RGBA", (canvas, canvas), WARM)
    foreground = mark.resize((artwork, artwork), RESAMPLE)
    position = (canvas - artwork) // 2
    output.alpha_composite(foreground, (position, position))
    return output.convert("RGB")


def main() -> None:
    if sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("Approved TripDock source logo hash did not match.")

    ICONS.mkdir(exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (1863, 844):
        raise RuntimeError(f"Unexpected source dimensions: {source.size}")

    clean_alpha = source.getchannel("A").point(lambda value: 0 if value < 8 else value)
    clean = source.copy()
    clean.putalpha(clean_alpha)
    mark = clean.crop((29, 148, 570, 689))

    mark.resize((512, 512), RESAMPLE).save(
        BRAND / "tripdock-mark.png", compress_level=9, optimize=False
    )
    tile(mark, 32, 32).save(
        PUBLIC / "favicon-32x32.png", compress_level=9, optimize=False
    )
    tile(mark, 256, 256).save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        bitmap_format="png",
    )
    tile(mark, 180, 128).save(
        PUBLIC / "apple-touch-icon.png", compress_level=9, optimize=False
    )
    tile(mark, 192, 160).save(
        ICONS / "icon-192.png", compress_level=9, optimize=False
    )
    tile(mark, 512, 432).save(
        ICONS / "icon-512.png", compress_level=9, optimize=False
    )
    tile(mark, 512, 336).save(
        ICONS / "icon-maskable-512.png", compress_level=9, optimize=False
    )

    logo = clean.resize((1000, 453), RESAMPLE)
    social = Image.new("RGB", (1200, 630), WARM)
    social.paste(logo, (100, 88), logo)
    draw = ImageDraw.Draw(social)
    draw.rectangle((0, 614, 959, 629), fill="#174f47")
    draw.rectangle((960, 614, 1199, 629), fill="#b75538")
    social.save(PUBLIC / "og.png", compress_level=9, optimize=False)


if __name__ == "__main__":
    main()
