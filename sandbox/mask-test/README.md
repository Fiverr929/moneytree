# Gemini Mask Test Sandbox

This folder is an isolated test bed for turning a Gemini-generated grayscale mask into a real transparent PNG.

It does not touch the Studio UI.

## Files

- `input.png` - local test input image
- `mask.png` - Gemini grayscale mask output
- `output.png` - original image with mask brightness applied as alpha
- `preview-blue.png` - output composited on blue to verify transparency

## Run

Use a Gemini API key in the environment:

```powershell
$env:GOOGLE_API_KEY="your-key"
& "C:\Users\This PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\sandbox\mask-test\run-mask-test.py --input .\sandbox\mask-test\input.png --model "your-image-model-id" --instruction "Remove the white outside background and the horizontal text strip."
```

The model should be an image-capable Gemini model supported by the same Google endpoint used by the app.

