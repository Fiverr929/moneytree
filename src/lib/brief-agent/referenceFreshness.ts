import { fingerprintReferenceValues } from "./referenceFingerprint.ts";

export const REFERENCE_READER_CONTRACT_VERSION = "neutral-visual-read-v1";

type ReferenceImageIdentity = {
  id: string | number;
  uuid?: string;
  url: string;
};

type ReferenceVisionState = ReferenceImageIdentity & {
  visualRead?: string;
  visualReadFingerprint?: string;
  visualReadVersion?: string;
};

export function fingerprintReferenceImage(file: ReferenceImageIdentity) {
  return fingerprintReferenceValues([[file.uuid || file.id, file.url]]);
}

export function hasCurrentReferenceRead(file: ReferenceVisionState) {
  return Boolean(
    file.visualRead?.trim()
    && file.visualReadFingerprint === fingerprintReferenceImage(file)
    && file.visualReadVersion === REFERENCE_READER_CONTRACT_VERSION
  );
}
