from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "brand-source"
OUTPUT_DIR = ROOT / "public" / "brand"

ASSETS = {
    "cherryapi-icon": {
        "source_name": "cherryapi-icon",
        "output": OUTPUT_DIR / "cherryapi-icon.png",
        "max_size": (512, 512),
        "padding": 18,
    },
    "cherryapi-wordmark": {
        "source_name": "cherryapi-wordmark",
        "output": OUTPUT_DIR / "cherryapi-wordmark.png",
        "max_size": (1200, 260),
        "padding": 12,
    },
}

SOURCE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")


def source_path(source_name: str) -> Path:
    for extension in SOURCE_EXTENSIONS:
        candidate = SOURCE_DIR / f"{source_name}{extension}"
        if candidate.exists():
            return candidate
    return SOURCE_DIR / f"{source_name}.png"


def remove_white_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            whiteness = min(red, green, blue)
            color_spread = max(red, green, blue) - whiteness

            if whiteness >= 248 and color_spread <= 12:
                pixels[x, y] = (red, green, blue, 0)
            elif whiteness >= 222 and color_spread <= 28:
                fade = max(0, min(255, int((248 - whiteness) * 9)))
                pixels[x, y] = (red, green, blue, min(alpha, fade))

    return rgba


def trim_and_pad(image: Image.Image, padding: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return image

    cropped = image.crop(bbox)
    result = Image.new("RGBA", (cropped.width + padding * 2, cropped.height + padding * 2), (255, 255, 255, 0))
    result.alpha_composite(cropped, (padding, padding))
    return result


def resize_to_fit(image: Image.Image, max_size: tuple[int, int]) -> Image.Image:
    result = image.copy()
    result.thumbnail(max_size, Image.Resampling.LANCZOS)
    return result


def write_asset(name: str, config: dict[str, object]) -> None:
    source_name = config["source_name"]
    output = config["output"]
    max_size = config["max_size"]
    padding = config["padding"]
    assert isinstance(source_name, str)
    assert isinstance(output, Path)
    assert isinstance(max_size, tuple)
    assert isinstance(padding, int)
    source = source_path(source_name)

    if not source.exists():
        raise FileNotFoundError(f"Missing {source}")

    image = Image.open(source)
    transparent = remove_white_background(image)
    transparent = trim_and_pad(transparent, padding)
    transparent = resize_to_fit(transparent, max_size)
    output.parent.mkdir(parents=True, exist_ok=True)
    transparent.save(output)
    print(f"wrote {output.relative_to(ROOT)}")


def main() -> int:
    missing = [
        f"brand-source\\{config['source_name']}{{.png,.jpg,.jpeg,.webp}}"
        for config in ASSETS.values()
        if not source_path(str(config["source_name"])).exists()
    ]
    if missing:
        print("Put the source images here before running this script:")
        for item in missing:
            print(f"  {item}")
        return 1

    for name, config in ASSETS.items():
        write_asset(name, config)
    return 0


if __name__ == "__main__":
    sys.exit(main())
