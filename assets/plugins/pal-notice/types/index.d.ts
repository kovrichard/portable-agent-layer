export type Notice = string | null;

declare module "claude-code" {
  interface PluginState {
    "pal-notice": { notice: Notice };
  }
}
