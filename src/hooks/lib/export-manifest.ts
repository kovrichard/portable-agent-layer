/** Archive metadata naming the machine that produced it. */
export const MANIFEST_NAME = "export-manifest.json";

export interface ExportManifest {
  machineId: string;
  label: string;
  os: string;
  exportedAt: string;
  fileCount: number;
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
  };
}
