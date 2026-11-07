import { IExtensionApi } from "vortex-api/lib/types/IExtensionContext";
import { Mod } from "./index";
import { IState } from "vortex-api/lib/types/IState";

export const registerNexusIntegration = (api: IExtensionApi) => {
  api.ext.addSourceToModlistBackup?.(
    "nexus",
    (api: IExtensionApi, mods: Mod[], install?: boolean) => {
      const state: IState = api.store.getState();
      // Use the choice the user made when restoring, falling back to their automatic install setting
      const shouldInstall = install ?? state.settings.automation.install;

      // Vortex reports most download failures itself, but if a download fails without that, we let the user know
      // once for all of the mods rather than once per mod
      const downloads: Promise<void>[] = [];
      let failedDownloads = 0;
      let lastError: Error;

      mods.forEach((mod) => {
        if (shouldInstall && mod.enabled !== false)
          api.events.emit(
            "mod-update",
            mod.game,
            mod.modId,
            mod.fileId,
            mod.source,
          );
        else {
          downloads.push(
            Promise.resolve(
              api.emitAndAwait(
                "nexus-download",
                mod.game,
                mod.modId,
                mod.fileId,
                undefined,
                false,
              ),
            ).then(
              () => undefined,
              (error) => {
                failedDownloads++;
                lastError = error;
              },
            ),
          );
        }
      });

      Promise.all(downloads).then(() => {
        if (failedDownloads > 0) {
          api.showErrorNotification(
            `${failedDownloads} mods from the modlist backup failed to download`,
            lastError,
          );
        }
      });
    },
  );
};
