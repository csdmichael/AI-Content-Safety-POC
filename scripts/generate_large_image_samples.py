#!/usr/bin/env python3
"""Generate large unsafe image samples for the image safety demo."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from random import Random

from PIL import Image, ImageFilter


REPO_ROOT = Path(__file__).resolve().parent.parent
ORIGINALS_DIR = REPO_ROOT / "ui" / "public" / "large-images" / "originals"
THUMBNAILS_DIR = REPO_ROOT / "ui" / "public" / "large-images" / "thumbnails"
MIN_BYTES = 5 * 1024 * 1024
MAX_BYTES = 20 * 1024 * 1024

SAMPLES = (
    ("unsafe-violence", "data/png/doc_051.png", "forest-waterfall.jpg"),
    ("unsafe-hate", "data/jpg/doc_054.jpg", "silicon-wafer.jpg"),
    ("unsafe-sexual", "data/png/doc_056.png", "character-parade.jpg"),
    ("unsafe-self-harm", "data/jpg/doc_057.jpg", "historic-cathedral.jpg"),
)


def _compose_sample(card_path: Path, background_path: Path) -> Image.Image:
    with Image.open(background_path) as background_source:
        background = background_source.convert("RGB")

    seed = sum(
        (index + 1) * value
        for index, value in enumerate(f"{card_path.name}:{background_path.name}".encode())
    )
    texture = Image.frombytes(
        "L",
        background.size,
        Random(seed).randbytes(background.width * background.height),
    ).convert("RGB")
    background = Image.blend(background, texture, 0.20)

    with Image.open(card_path) as card_source:
        card = card_source.convert("RGB")

    max_card_width = int(background.width * 0.78)
    max_card_height = int(background.height * 0.78)
    scale = min(max_card_width / card.width, max_card_height / card.height)
    card = card.resize(
        (round(card.width * scale), round(card.height * scale)),
        Image.Resampling.LANCZOS,
    )

    card_x = (background.width - card.width) // 2
    card_y = (background.height - card.height) // 2
    shadow = Image.new("RGBA", background.size, (0, 0, 0, 0))
    shadow_card = Image.new("RGBA", (card.width + 56, card.height + 56), (0, 0, 0, 150))
    shadow.paste(shadow_card, (card_x - 12, card_y + 10))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))

    composed = Image.alpha_composite(background.convert("RGBA"), shadow).convert("RGB")
    composed.paste(card, (card_x, card_y))
    return composed


def _encode_large_jpeg(image: Image.Image) -> bytes:
    for quality in range(98, 69, -2):
        output = BytesIO()
        image.save(output, "JPEG", quality=quality, optimize=True, subsampling=0)
        contents = output.getvalue()
        if MIN_BYTES <= len(contents) <= MAX_BYTES:
            return contents

    raise RuntimeError(
        f"Could not encode fixture between 5 and 20 MB; last size was {len(contents):,} bytes."
    )


def main() -> None:
    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    for sample_id, card_relative_path, background_name in SAMPLES:
        image = _compose_sample(
            REPO_ROOT / card_relative_path,
            ORIGINALS_DIR / background_name,
        )
        original_path = ORIGINALS_DIR / f"{sample_id}.jpg"
        original_path.write_bytes(_encode_large_jpeg(image))

        thumbnail = image.copy()
        thumbnail.thumbnail((640, 400), Image.Resampling.LANCZOS)
        thumbnail.save(THUMBNAILS_DIR / f"{sample_id}.webp", "WEBP", quality=82, method=6)

        size_bytes = original_path.stat().st_size
        if not MIN_BYTES <= size_bytes <= MAX_BYTES:
            raise RuntimeError(f"{original_path.name} has invalid size: {size_bytes:,} bytes")
        print(f"{sample_id}: {image.width}x{image.height}, {size_bytes:,} bytes")


if __name__ == "__main__":
    main()