import { refreshHealthOnStart } from "./health-cache";
import { refreshLoginOnStart } from "./login-cache";

export function refreshCachesOnStart(
  refreshLogin: () => void = refreshLoginOnStart,
  refreshHealth: () => void = refreshHealthOnStart
): void {
  refreshLogin();
  refreshHealth();
}
