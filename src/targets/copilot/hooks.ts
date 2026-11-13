import { loadHooksTemplate } from "../hooks-template";

/** Load and resolve the Copilot hooks template, substituting PKG_ROOT */
export function loadCopilotHooksTemplate(templatePath: string, pkgRoot: string): unknown {
  return loadHooksTemplate(templatePath, pkgRoot, "Copilot");
}
