/** Archive metadata naming the machine that produced it. */
export const MANIFEST_NAME = "export-manifest.json";

/**
 * Which folder layout the archive's paths follow. Raised with every release
 * that moves a store, so an older PAL can tell an archive it cannot place.
 * Archives from before the field are layout 1.
 */
export const DATA_LAYOUT = 4;

export interface ExportManifest {
  machineId: string;
  label: string;
  os: string;
  exportedAt: string;
  fileCount: number;
  layout: number;
}

/** The refusal an import gives an archive from a newer layout, or null when this PAL can place it. */
export function newerLayoutRefusal(
  manifest: Pick<ExportManifest, "layout"> | null
): string | null {
  const layout = manifest?.layout ?? 1;
  if (layout <= DATA_LAYOUT) return null;

  return `this archive uses data layout ${layout}, but this PAL knows layouts up to ${DATA_LAYOUT}; update PAL (pal cli update) and import again`;
}

export function buildManifest(
  identity: { id: string; label: string; os: string },
  fileCount: number
): ExportManifest {
  return {
    machineId: identity.id,
    label: identity.label,
    os: identity.os,
    exportedAt: new Date().toISOString(),
    fileCount,
    layout: DATA_LAYOUT,
  };
}
