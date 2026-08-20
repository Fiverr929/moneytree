import assert from "node:assert/strict";
import {
  fingerprintReferenceImage,
  hasCurrentReferenceRead,
  REFERENCE_READER_CONTRACT_VERSION,
} from "../src/lib/brief-agent/referenceFreshness.ts";
import {
  getGenerationModuleImages,
  resolveGenerationModuleImages,
} from "../src/lib/pipeline/module-order.ts";
import { galleryCellForStorage } from "../src/lib/galleryCells.ts";

const image = {
  id: 1,
  uuid: "asset-a",
  url: "data:image/png;base64,AAAA",
  visualRead: "A current image",
  visualReadVersion: REFERENCE_READER_CONTRACT_VERSION,
};
image.visualReadFingerprint = fingerprintReferenceImage(image);
assert.equal(hasCurrentReferenceRead(image), true);
assert.equal(hasCurrentReferenceRead({ ...image, url: "data:image/png;base64,BBBB" }), false);
assert.equal(hasCurrentReferenceRead({ ...image, visualReadVersion: "older-reader" }), false);

const files = Array.from({ length: 9 }, (_, index) => ({
  id: index,
  uuid: `asset-${index}`,
  url: `data:image/png;base64,${index}`,
  eye: index !== 7,
  folder: index === 8 ? "MOOD" : null,
  mode: index === 6 ? "REFERENCE" : index % 3 === 0 ? "SUBJECT" : index % 3 === 1 ? "SCENE" : "STYLE",
  modified: new Date(2026, 0, 1, 0, 0, index).toISOString(),
}));
const active = getGenerationModuleImages(files);
assert.equal(active.length, 6);
assert.deepEqual(active.map((file) => file.id), [5, 4, 3, 2, 1, 0]);
assert.deepEqual(resolveGenerationModuleImages(undefined, files), active);

const stored = galleryCellForStorage({
  id: 1,
  imgUrl: "generated-pixels",
  usedImages: [
    { uuid: "asset-a", imgUrl: "reference-pixels" },
    { imgUrl: "unaddressed-base-pixels", role: "BASE" },
  ],
  moduleSnapshot: { files: [{ ...files[0], kind: "IMG", label: "A", name: "A", size: "", dims: "", eye: true, strength: 50 }] },
});
assert.equal(stored.imgUrl, undefined);
assert.equal(stored.usedImages?.[0].imgUrl, "");
assert.equal(stored.usedImages?.[1].imgUrl, "unaddressed-base-pixels");
assert.equal(stored.moduleSnapshot?.files[0].url, "");

console.log("Reference pipeline freshness checks passed.");
