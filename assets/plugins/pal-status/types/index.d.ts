export type Notice = string | null;

declare module "claude-code" {
  interface PluginState {
    "pal-status": { notice: Notice };
  }
}
