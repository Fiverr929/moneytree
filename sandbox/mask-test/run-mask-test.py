from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image


DEFAULT_INSTRUCTION = "Remove the white outside background and the horizontal text strip."


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ask Gemini for a grayscale alpha mask, then apply it to the original image."
    )
    parser.add_argument("--input", default="sandbox/mask-test/input.png", help="Input image path.")
    parser.add_argument("--instruction", default=DEFAULT_INSTRUCTION, help="What should become transparent.")
    parser.add_argument("--model", default=os.getenv("GEMINI_MODEL", ""), help="Gemini image model id.")
    parser.add_argument("--api-key", default=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "")
    parser.add_argument("--mask", default="sandbox/mask-test/mask.png", help="Where to save Gemini's mask.")
    parser.add_argument("--output", default="sandbox/mask-test/output.png", help="Where to save transparent PNG.")
    parser.add_argument("--preview", default="sandbox/mask-test/preview-blue.png", help="Where to save color preview.")
    parser.add_argument("--endpoint", choices=["aiplatform", "generativelanguage"], default="aiplatform")
    parser.add_argument("--invert", action="store_true", help="Invert mask before applying alpha.")
    parser.add_argument("--preview-color", default="20,90,210", help="RGB preview background, e.g. 20,90,210.")
    return parser.parse_args()


def data_url_parts(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    suffix = path.suffix.lower()
    mime_type = "image/png"
    if suffix in {".jpg", ".jpeg"}:
        mime_type = "image/jpeg"
    elif suffix == ".webp":
        mime_type = "image/webp"
    return mime_type, base64.b64encode(data).decode("ascii")


def build_url(endpoint: str, model: str, api_key: str) -> str:
    if endpoint == "generativelanguage":
        return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    return f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key={api_key}"


def request_mask(input_path: Path, instruction: str, model: str, api_key: str, endpoint: str) -> bytes:
    mime_type, image_b64 = data_url_parts(input_path)
    prompt = "\n".join(
        [
            "Create a grayscale alpha mask for the provided image.",
            "",
            "Return only the mask image. Do not return the edited original image.",
            "White pixels mean keep visible.",
            "Black pixels mean make transparent.",
            "Gray pixels mean soft semi-transparent edge.",
            "Keep the exact same composition and framing as the input image.",
            "",
            f"Instruction: {instruction}",
        ]
    )

    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"imageOutputOptions": {"mimeType": "image/png"}},
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        ],
    }

    req = urllib.request.Request(
        build_url(endpoint, model, api_key),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini request failed: HTTP {exc.code}: {detail}") from exc

    for candidate in payload.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])

    raise RuntimeError(f"Gemini returned no mask image: {json.dumps(payload)[:2000]}")


def apply_mask(input_path: Path, mask_path: Path, output_path: Path, preview_path: Path, invert: bool, preview_color: str) -> None:
    original = Image.open(input_path).convert("RGBA")
    mask = Image.open(mask_path).convert("L")

    if mask.size != original.size:
        mask = mask.resize(original.size, Image.Resampling.LANCZOS)

    if invert:
        mask = Image.eval(mask, lambda value: 255 - value)

    result = original.copy()
    result.putalpha(mask)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.save(output_path)

    rgb = tuple(int(part.strip()) for part in preview_color.split(","))
    if len(rgb) != 3:
        raise ValueError("--preview-color must be R,G,B")
    preview = Image.new("RGBA", result.size, (*rgb, 255))
    preview.alpha_composite(result)
    preview.save(preview_path)


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    mask_path = Path(args.mask)
    output_path = Path(args.output)
    preview_path = Path(args.preview)

    if not input_path.exists():
        print(f"Input image not found: {input_path}", file=sys.stderr)
        return 2
    if not args.api_key:
        print("Missing API key. Set GOOGLE_API_KEY or pass --api-key.", file=sys.stderr)
        return 2
    if not args.model:
        print("Missing model id. Set GEMINI_MODEL or pass --model.", file=sys.stderr)
        return 2

    mask_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Requesting mask from {args.model}...")
    mask_bytes = request_mask(input_path, args.instruction, args.model, args.api_key, args.endpoint)
    mask_path.write_bytes(mask_bytes)
    print(f"Saved mask: {mask_path}")

    apply_mask(input_path, mask_path, output_path, preview_path, args.invert, args.preview_color)
    print(f"Saved transparent PNG: {output_path}")
    print(f"Saved preview: {preview_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
