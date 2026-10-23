import { APP_VERSION } from "../version.ts";

export function VersionBadge() {
  return (
    <span className="version-badge" title="当前游戏版本">
      v{APP_VERSION}
    </span>
  );
}
