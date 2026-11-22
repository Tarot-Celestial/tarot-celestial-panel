import type { OfficeVersion } from "./model";

export function latestVersions(versions: OfficeVersion[]) {
  const newest = new Map<string, OfficeVersion>();
  for (const version of versions) {
    const previous = newest.get(version.deliverable_id);
    if (!previous || previous.version < version.version) newest.set(version.deliverable_id, version);
  }
  return newest;
}
