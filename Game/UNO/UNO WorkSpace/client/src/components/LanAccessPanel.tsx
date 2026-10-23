import { useEffect, useMemo, useState } from "react";
import type { LanStatusView } from "@shared/protocol.ts";
import { copyText } from "../clipboard.ts";

const KIND_LABELS: Record<LanStatusView["addresses"][number]["kind"], string> = {
  wlan: "WLAN",
  ethernet: "以太网",
  radmin: "Radmin",
  uu: "UU",
  "blue-shield": "小蓝盾",
  virtual: "虚拟网卡",
  other: "网络"
};

interface LanAccessPanelProps {
  status: LanStatusView;
  busy: boolean;
  roomCode?: string;
  disabled: boolean;
  onToggle: (enabled: boolean) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}

function addressKey(address: LanStatusView["addresses"][number]): string {
  return `${address.name}:${address.address}`;
}

export function LanAccessPanel({
  status,
  busy,
  roomCode,
  disabled,
  onToggle,
  onRefresh,
  onError
}: LanAccessPanelProps) {
  const storageKey = `uno.lanPreferred:${status.hostName}:${status.port}`;
  const [selectedKey, setSelectedKey] = useState(
    () => localStorage.getItem(storageKey) ?? ""
  );
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (status.addresses.length === 0) {
      setSelectedKey("");
      return;
    }
    if (status.addresses.some((address) => addressKey(address) === selectedKey)) {
      return;
    }
    const currentHost = window.location.hostname;
    const defaultAddress =
      status.addresses.find((address) => address.address === currentHost) ??
      status.addresses.find(
        (address) => address.kind === "wlan" || address.kind === "ethernet"
      ) ??
      status.addresses[0]!;
    setSelectedKey(addressKey(defaultAddress));
  }, [selectedKey, status.addresses]);

  const selectedAddress = useMemo(
    () =>
      status.addresses.find(
        (address) => addressKey(address) === selectedKey
      ) ?? null,
    [selectedKey, status.addresses]
  );
  const primaryUrl = selectedAddress
    ? roomCode
      ? `${selectedAddress.url}/room/${roomCode}`
      : selectedAddress.url
    : "";

  const selectAddress = (key: string): void => {
    setSelectedKey(key);
    localStorage.setItem(storageKey, key);
  };

  const copyAddress = async (key: string, url: string): Promise<void> => {
    const value = roomCode ? `${url}/room/${roomCode}` : url;
    if (await copyText(value)) {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } else {
      onError("复制失败，请手动选择地址");
    }
  };

  return (
    <section className="panel lan-panel" aria-labelledby="lan-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">主机网络</p>
          <h2 id="lan-heading">局域网开放</h2>
        </div>
        <span
          className={`tag ${status.enabled ? "lan-open-tag" : "warn-tag"}`}
        >
          {status.enabled ? "已开放" : "已关闭"}
        </span>
      </div>

      {status.enabled ? (
        <>
          <p className="muted lan-description">
            选择玩家使用的局域网或虚拟网卡地址，再复制房间链接。
          </p>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => void onToggle(false)}
              disabled={busy || disabled}
            >
              关闭局域网访问
            </button>
            <button
              className="text-button"
              onClick={() => void onRefresh()}
              disabled={busy || disabled}
            >
              刷新网卡地址
            </button>
            <span className="hint">
              主机：{status.hostName} · 端口 {status.port || "启动中"}
            </span>
          </div>

          {selectedAddress ? (
            <div className="lan-primary">
              <label className="field-label" htmlFor="lan-preferred-address">
                首选地址
              </label>
              <select
                id="lan-preferred-address"
                aria-label="首选局域网地址"
                value={selectedKey}
                onChange={(event) => selectAddress(event.target.value)}
                disabled={disabled}
              >
                {status.addresses.map((address) => {
                  const key = addressKey(address);
                  return (
                    <option key={key} value={key}>
                      {KIND_LABELS[address.kind]} · {address.name} ·{" "}
                      {address.address}
                    </option>
                  );
                })}
              </select>
              <code className="lan-primary-url">{primaryUrl}</code>
              <button
                className="primary"
                onClick={() => void copyAddress(selectedKey, selectedAddress.url)}
                disabled={disabled}
              >
                {copied === selectedKey
                  ? "已复制"
                  : roomCode
                    ? "复制房间链接"
                    : "复制地址"}
              </button>
            </div>
          ) : (
            <p className="hint">
              暂未检测到局域网网卡。请先连接 Wi-Fi、有线网络，或启动 Radmin/UU/小蓝盾。
            </p>
          )}

          <details className="lan-more">
            <summary>更多网卡</summary>
            <div className="lan-address-list">
              {status.addresses.map((address) => {
                const key = addressKey(address);
                return (
                  <div className="lan-address-row" key={key}>
                    <div className="lan-address-info">
                      <div className="lan-address-title">
                        <span className="tag">
                          {KIND_LABELS[address.kind]}
                        </span>
                        <span>{address.name}</span>
                        {address.isVirtual ? (
                          <span className="muted small-text">虚拟网卡</span>
                        ) : null}
                      </div>
                      <code>{address.url}</code>
                    </div>
                    <button
                      className="secondary lan-copy-button"
                      onClick={() => void copyAddress(key, address.url)}
                      disabled={disabled}
                    >
                      {copied === key
                        ? "已复制"
                        : roomCode
                          ? "复制房间链接"
                          : "复制地址"}
                    </button>
                  </div>
                );
              })}
            </div>
            {status.localUrl ? (
              <p className="lan-local-address">
                本机地址：<code>{status.localUrl}</code>
              </p>
            ) : null}
          </details>
        </>
      ) : (
        <div className="button-row">
          <button
            className="primary"
            onClick={() => void onToggle(true)}
            disabled={busy || disabled}
          >
            开放局域网访问
          </button>
        </div>
      )}
    </section>
  );
}
