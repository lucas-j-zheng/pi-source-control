import { createHash } from "node:crypto";

export function fingerprintPatch(rawPatch: string): string {
  return createHash("sha1").update(rawPatch).digest("hex");
}
