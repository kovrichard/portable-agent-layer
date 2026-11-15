import { refreshLoginOnStart } from "../inference/login-cache";
import { refreshHealthOnStart } from "../usage/health-cache";

export function refreshCachesOnStart(
  refreshLogin: () => void = refreshLoginOnStart,
  refreshHealth: () => void = refreshHealthOnStart
): void {
  refreshLogin();
  refreshHealth();
}
