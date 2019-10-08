const path = require('path');
const fs = require('fs');

const activeProfile = (state) => {
  const profileId = state.settings.profiles.activeProfileId;
  return state.persistent.profiles[profileId];
};

const getActiveGameId = state => {
  const profile = activeProfile(state);
  return profile !== undefined ? profile.gameId : undefined;
};

const transformModFormat = mod => ({
  name: mod.attributes.modName,
  game: mod.attributes.downloadGame,
  modId: mod.attributes.modId,
  fileId: mod.attributes.fileId,
});

const getInstalledMods = state => Object.values(state.persistent.mods)
  .map(game => Object.values(game).map(mod => transformModFormat(mod)))
  .reduce((result, current) => result.concat(current), []);

const init = (context) => {
  const { api } = context;
  context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup: Restore', () => {
    const state = api.store.getState();

    if (!state.persistent.nexus.userInfo.isPremium) {
      api.showErrorNotification('You need to be a premium member to restore a list of mods');
      return;
    }

    api.selectFile({ create: false, title: 'Select your backup file to import'})
      .then(fileName => {
        fs.readFile(path.resolve(fileName), (error, jsonString) => {
          const activeGameId = getActiveGameId(state);

          if (error) {
            api.showErrorNotification(error);
            return;
          }

          const installedMods = getInstalledMods(state);
          let mods = JSON.parse(jsonString);
          mods = mods.filter(mod => mod.game === activeGameId)
            .filter(mod => !installedMods.some(installedMod => installedMod.game === mod.game && installedMod.modId === mod.modId && installedMod.fileId === mod.fileId))
          ;

          for (const mod of mods) {
            api.events.emit('mod-update', mod.game, mod.modId, mod.fileId);
          }

          api.showErrorNotification(`${mods.length} mods for ${activeGameId} restored`);
        });
      });
  });

  context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup', () => {
    const state = api.store.getState();
    const mods = getInstalledMods(state);

    api.selectFile({ create: true, title: 'Select file to export to'})
      .then(fileName => {
        fs.writeFile(path.resolve(fileName), JSON.stringify(mods, null, 4), error => {
          if (error) {
            api.showErrorNotification(error);
            return;
          }

          api.showErrorNotification(`Modlist backed up to ${path.resolve(fileName)}`);
        });
      });
  });
};

module.exports = {default: init};
