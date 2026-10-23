import type { LanAccessController } from "./lan.ts";

export function clientAddress(
  lanAccess: LanAccessController,
  remoteAddress: string | undefined,
  forwardedAddress: string | string[] | undefined
): string | undefined {
  if (!lanAccess.isLocalAddress(remoteAddress)) {
    return remoteAddress;
  }
  const forwarded = Array.isArray(forwardedAddress)
    ? forwardedAddress[0]
    : forwardedAddress?.split(",", 1)[0];
  return forwarded?.trim() || remoteAddress;
}
