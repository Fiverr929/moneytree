# CafeHTML Quickstart

CafeHTML is a browser-based image creation workspace. You use it to combine a written prompt, reference images, subject/stage/style modules, and generation settings, then send that structured brief to a Google image model.

It is not a normal website with a backend server. It runs from `CafeHTML-v2.html`, stores your projects in the browser, and calls Google Vertex AI directly using the API key you enter in Settings.

## What You Are Doing In CafeHTML

Think of CafeHTML as a visual prompt builder.

Instead of writing one long messy prompt, you organize the image request into parts:

- `Prompt bar`: the main thing you want to create.
- `FRAME / SCENE`: choose whether you are making still images or a sequence/movie-style set.
- `Settings`: aspect ratio, variation count, frame count, model, resolution, and Google API key.
- `Module panel`: structured references for subject, stage, and style.
- `Reference images`: uploaded images that guide the generation.
- `Gallery`: generated images and saved outputs.
- `Sequence bar`: images selected for a sequence.
- `Studio`: refine or edit an existing generated image.

## Basic Workflow

1. Open `CafeHTML-v2.html` in a browser.
2. Click Settings and enter your Google Vertex AI API key.
3. Choose the model and resolution.
4. Type the main request in the prompt bar.
5. Optionally upload reference images.
6. Optionally organize details in the module panel:
   - `Subject`: who or what should appear.
   - `Stage`: location, setting, props, lighting, scene context.
   - `Style`: look, camera, mood, color, art direction.
7. Pick aspect ratio and number of variations.
8. Press `FRAME` to generate still images.
9. Review results in the gallery.
10. Open an image in Studio if you want to refine it.

## When To Use Each Area

Use the main prompt when the request is simple.

Example:

```text
A cinematic product photo of a matte black coffee cup on a stone table, morning window light, shallow depth of field.
```

Use modules when you want more control.

Example:

```text
Subject: red ceramic coffee cup with gold rim
Stage: marble cafe table, rainy window in background
Style: warm editorial photography, 85mm lens, soft contrast
```

Use reference images when exact visual identity matters:

- Same person
- Same product
- Same clothing
- Same room
- Same pose
- Same color palette
- Same visual style

Use Studio after generation when the image is close but needs changes:

- Replace or adjust part of the image
- Crop
- Draw/refine an area
- Create version history for one image
- Add more references for an edit

## Important Notes

- Your data is stored in the browser using IndexedDB and localStorage.
- Opening the file in a different browser may not show the same projects.
- Clearing browser storage can delete saved CafeHTML projects.
- The app needs internet access only when calling Google generation APIs.
- Generation cost depends on the selected model, resolution, and number of variations.

## Simple Mental Model

CafeHTML turns this:

```text
I want an image, and I have some references.
```

into this:

```text
Main prompt + subject references + stage references + style references + output settings
```

Then it sends that structured package to the image model and stores the results in your local gallery.

