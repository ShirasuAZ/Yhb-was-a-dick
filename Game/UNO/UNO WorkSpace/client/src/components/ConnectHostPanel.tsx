import { useState } from "react";
import {
  directLanNavigationUrl,
  parseHostAddress,
  resolveHost,
  type HostTarget
} from "../connectTarget.ts";

interface ConnectHostPanelProps {
  defaultOpen?: boolean;
}

export function ConnectHostPanel({
  defaultOpen = false
}: ConnectHostPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [progress, setProgress] = useState("");

  const connect = async (): Promise<void> => {
    setError("");
    setProgress("");
    if (connecting) {
      return;
    }
    let target: HostTarget;
    try {
      target = parseHostAddress(address);
    } catch (connectError) {
      setError(
        connectError instanceof Error ? connectError.message : "主机地址格式无效"
      );
      return;
    }
    setConnecting(true);
    const directUrl = directLanNavigationUrl(window.location.protocol, target);
    if (directUrl) {
      window.location.assign(directUrl);
      return;
    }
    setProgress(
      target.explicitPort
        ? "正在检测主机…"
        : `正在自动查找 ${target.host} 的 80、3000–3011 端口…`
    );
    try {
      const host = await resolveHost(target);
      setProgress(`已连接 ${host.baseUrl}，正在进入游戏…`);
      window.location.assign(`${host.baseUrl}/join`);
    } catch (connectError) {
      setError(
        connectError instanceof Error ? connectError.message : "连接主机失败"
      );
      setConnecting(false);
    }
  };

  return (
    <details
      className="connect-host panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>连接主机</summary>
      <div className="connect-host-fields">
        <label>
          <span className="field-label">主机 IP 或地址</span>
          <input
            aria-label="主机 IP 或地址"
            value={address}
            placeholder="192.168.1.10 或 26.209.70.144:3000"
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void connect();
              }
            }}
          />
        </label>
        <button
          className="primary"
          onClick={() => void connect()}
          disabled={connecting}
        >
          {connecting ? "连接中…" : "连接主机"}
        </button>
      </div>
      {progress ? (
        <p className="hint" role="status">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
