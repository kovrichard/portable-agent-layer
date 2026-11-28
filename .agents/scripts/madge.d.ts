declare module "madge" {
  interface MadgeResult {
    obj(): Record<string, string[]>;
  }

  export default function madge(
    paths: string[],
    config: { fileExtensions: string[]; tsConfig: string }
  ): Promise<MadgeResult>;
}
