/**
 * Compat seam for writing `defaultTools` on Pi's SettingsManager.
 * Pi exposes `getDefaultTools()` but no public setter; setters follow the same
 * globalSettings + markModified + save pattern as `setExtensionPaths`.
 */
interface DefaultToolsWritablePiSettingsManager {
  setDefaultTools?(entries: string[]): void;
  globalSettings?: { defaultTools?: string[] };
  markModified?(field: string, nestedKey?: string): void;
  save?(): void;
}

export function setPiDefaultTools(settingsManager: object, entries: string[]): void {
  const manager = settingsManager as DefaultToolsWritablePiSettingsManager;
  if (typeof manager.setDefaultTools === "function") {
    manager.setDefaultTools(entries);
    return;
  }
  if (
    !manager.globalSettings ||
    typeof manager.markModified !== "function" ||
    typeof manager.save !== "function"
  ) {
    throw new Error("The bundled Pi runtime does not support writing defaultTools settings.");
  }
  manager.globalSettings.defaultTools = entries;
  manager.markModified("defaultTools");
  manager.save();
}
