import {IMod} from "vortex-api/lib/extensions/mod_management/types/IMod";
import {IState} from "vortex-api/lib/types/IState";
import {IExtensionContext} from "vortex-api/lib/types/IExtensionContext";
import getSafe from "./getSafe";

const path = require('path');
const fs = require('fs');

interface Mod {
  name: string;
  game: string;
  modId: number;
  fileId: number;
}

const activeProfile = (state: IState) => {
  const profileId = state.settings.profiles.activeProfileId;
  return getSafe(state, ['persistent', 'profiles', profileId], undefined);
};

const getActiveGameId = (state: IState): string => {
  const profile = activeProfile(state);
  return profile !== undefined ? profile.gameId : undefined;
};

const transformModFormat = (mod: IMod): Mod => ({
  name: mod.attributes.modName,
  game: mod.attributes.downloadGame,
  modId: mod.attributes.modId,
  fileId: mod.attributes.fileId,
});

const getInstalledMods = (state: IState): Mod[] => Object.values(state.persistent.mods)
  .map(game => Object.values(game).map(mod => transformModFormat(mod)))
  .reduce((result, current) => result.concat(current), []);

const init = (context: IExtensionContext) => {
  const { api } = context;
  context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup: Restore', () => {
    const state: IState = api.store.getState();

    // @ts-ignore
    if (!getSafe(state, ['persistent', 'nexus', 'userInfo', 'isPremium'], false)) {
      api.showErrorNotification('You need to be a premium member to restore a list of mods', 'You need to be a premium member to restore a list of mods');
      return;
    }

    api.selectFile({ create: false, title: 'Select your backup file to import'})
      .then(fileName => {
        fs.readFile(path.resolve(fileName), (error, jsonString) => {
          const activeGameId = getActiveGameId(state);

          if (error) {
            api.showErrorNotification(error, error);
            return;
          }

          const installedMods = getInstalledMods(state);
          let mods = JSON.parse(jsonString);
          mods = mods.filter(mod => mod.game === activeGameId);
          const modsFound = mods.length;

          mods = mods.filter(mod => !installedMods.some(installedMod => installedMod.game === mod.game && installedMod.modId === mod.modId && installedMod.fileId === mod.fileId));

          for (const mod of mods) {
            api.events.emit('mod-update', mod.game, mod.modId, mod.fileId);
          }

          api.sendNotification({
            type: 'success',
            title: `${mods.length} mods for ${activeGameId} restores`,
            message: `${modsFound} mods found for ${activeGameId}, but only ${mods.length} mods installed`
          });
        });
      });
  });

  context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup', () => {
    const state = api.store.getState();
    let mods = getInstalledMods(state);

    api.selectFile({ create: true, title: 'Select file to export to'})
      .then(fileName => {

        // If we're overwriting an existing mod list, we only want to overwrite the mods for the game we're currently managing.
        // We don't want to remove mods from the backup for games that aren't installed
        if (fs.existsSync(fileName)) {
          const activeGameId = getActiveGameId(state);
          // Get mods from the backup that aren't from the active game
          const existingMods = JSON.parse(fs.readFileSync(fileName)).filter((mod: Mod) => mod.game !== activeGameId);

          // Only get mods from the currently managed game, then merge them with the existing list
          mods = mods.filter((mod: Mod) => mod.game === activeGameId).concat(existingMods);
        }


        fs.writeFile(path.resolve(fileName), JSON.stringify(mods, null, 4), error => {
          if (error) {
            api.showErrorNotification(error, error);
            return;
          }

          api.sendNotification({
            type: 'success',
            title: 'Backup Complete',
            message: `Modlist backed up to ${path.resolve(fileName)}`,
          })
        });
      });
  });
};

module.exports = {default: init};
