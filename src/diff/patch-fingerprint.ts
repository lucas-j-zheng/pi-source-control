import { createHash } from "node:crypto";

import type { FileStatus } from "../model/diff.ts";

export function fingerprintPatch(rawPatch: string): string {
  return createHash("sha1").update(rawPatch).digest("hex");
}

export function fingerprintFilePatch(
  rawPatch: string,
  status: FileStatus,
  newPath: string,
): string {
  return fingerprintPatch(rawPatch === "" ? `${status}\0${newPath}` : rawPatch);
}
