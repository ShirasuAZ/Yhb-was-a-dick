import type { ConnectionStatus } from "../types.ts";

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const label =
    status === "connected"
      ? "已连接"
      : status === "connecting"
        ? "连接中"
        : "已断开";
  return (
    <span className={`connection-badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
