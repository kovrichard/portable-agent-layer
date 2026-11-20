export type Draft = { id: string; when: string; steering: string };
export type Isc = { id: number; title: string };
export type Review = {
  project: string | null;
  drafts: Draft[];
  iscs: Isc[];
  notice: string;
};

declare module "claude-code" {
  interface PluginState {
    "pal-review": { review: Shaped<Review> };
  }
}
