type ReferenceFingerprintPart = string | number | boolean | null | undefined;

function feedHash(state: [number, number], value: ReferenceFingerprintPart) {
  const text = String(value ?? "");
  const framed = `${text.length}:${text};`;
  let [left, right] = state;
  for (let index = 0; index < framed.length; index += 1) {
    const code = framed.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x5bd1e995);
    right ^= right >>> 13;
  }
  state[0] = left;
  state[1] = right;
}

/**
 * Produces a compact, deterministic identifier without retaining image data URLs.
 * Every character of each value participates in the digest, so replacing pixels
 * while retaining an image UUID still invalidates reference-vision memory.
 */
export function fingerprintReferenceValues(rows: ReferenceFingerprintPart[][]) {
  const state: [number, number] = [0x811c9dc5, 0x27d4eb2f];
  feedHash(state, rows.length);
  rows.forEach((row) => {
    feedHash(state, row.length);
    row.forEach((value) => feedHash(state, value));
  });
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return `refs-v3:${hex(state[0])}${hex(state[1])}`;
}
