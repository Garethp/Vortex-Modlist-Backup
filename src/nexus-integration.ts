import { IExtensionApi } from "vortex-api/lib/types/IExtensionContext";
import { Mod } from "./index";
import { IState } from "vortex-api/lib/types/IState";

export const registerNexusIntegration = (api: IExtensionApi) => {
  api.ext.addSourceToModlistBackup?.(
    "nexus",
    (api: IExtensionApi, mods: Mod[]) => {
      const state: IState = api.store.getState();
      let shouldInstall = state.settings.automation.install;

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
          api.emitAndAwait(
            "nexus-download",
            mod.game,
            mod.modId,
            mod.fileId,
            undefined,
            false,
          );
        }
      });
    },
  );
};
