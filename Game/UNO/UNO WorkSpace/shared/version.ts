function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

export function isNewerVersion(remoteVersion: string, currentVersion: string): boolean {
  return compareVersions(remoteVersion, currentVersion) > 0;
}
