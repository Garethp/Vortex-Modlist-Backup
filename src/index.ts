import {IMod} from "vortex-api/lib/extensions/mod_management/types/IMod";
import {IState} from "vortex-api/lib/types/IState";
import {IExtensionContext} from "vortex-api/lib/types/IExtensionContext";
import getSafe from "./getSafe";

const path = require('path');
const fs = require('fs');

// This is the data structure that I want our file to have
interface Mod {
    name: string;
    game: string;
    modId: number;
    fileId: number;
    source?: string;
}

// Get the active profile from the redux state.
const activeProfile = (state: IState) => {
    const profileId = state.settings.profiles.activeProfileId;
    return getSafe(state, ['persistent', 'profiles', profileId], undefined);
};

// Fetch the current active Game ID
const getActiveGameId = (state: IState): string => {
    const profile = activeProfile(state);
    return profile !== undefined ? profile.gameId : undefined;
};

// Transform the format of the mod from what's used internally in Vortex into what we want to store in the file
const transformModFormat = (mod: IMod): Mod => ({
    name: mod.attributes.modName,
    game: mod.attributes.downloadGame,
    modId: mod.attributes.modId,
    fileId: mod.attributes.fileId,
    source: mod.attributes.source,
});

/*
 * The installed mods will come back in an object format for games, where as we want an array, so do the following:
 *    Get the values of those objects
 *    Transform them into the structure we want
 *    We now have data in structure Mod[][], so let's concat all the array's into one array
 */
const getInstalledMods = (state: IState): Mod[] => Object.values(state.persistent.mods)
    .map(game => Object.values(game).map(mod => transformModFormat(mod)))
    .reduce((result, current) => result.concat(current), []);

const init = (context: IExtensionContext) => {
    const {api} = context;

    const backupMods = (thisGameOnly: boolean = false) => () => {
        const state = api.store.getState();
        let mods = getInstalledMods(state);

        // Ask the user where they want to export to
        api.selectFile({create: true, title: 'Select file to export to'})
            .then(fileName => {
                const activeGameId = getActiveGameId(state);

                mods = mods
                    // Some mods don't have modId's or fileId's. Maybe they were manually installed? Since we need a modId
                    // and a fileId, there's no point int writing out mods that have neither
                    .filter(mod => mod.modId && mod.fileId && mod.game)

                // If we're only backing up the existing games, let's filter out other ones
                if (thisGameOnly) {
                    mods = mods.filter(mod => mod.game === activeGameId);
                }

                // If we're overwriting an existing mod list, we only want to overwrite the mods for the game we're currently managing.
                // We don't want to remove mods from the backup for games that aren't installed
                if (fs.existsSync(fileName) && fs.readFileSync(fileName).length > 2) {
                    try {
                        // Get mods from the backup that aren't from the active game
                        const existingMods = JSON.parse(fs.readFileSync(fileName)).filter((mod: Mod) => mod.game !== activeGameId);

                        mods = mods
                            // Only get mods from the currently managed game, then merge them with the existing list
                            .filter((mod: Mod) => mod.game === activeGameId)
                            .concat(existingMods)
                    } catch (error) {
                        console.log(error);
                    }
                }

                // Write the file in pretty-print JSON for user readability
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
            })
            .catch((error) => console.log(error));
    };

    const restoreMods = () => {
        const state: IState = api.store.getState();

        // Installed mods with the `mod-update` event requires the user to be a Premium Member internally in Vortex, I think that's because
        // this method won't show any ads. Because of this restriction, we're going to run a check now rather than later, to give earlier feedback
        // @ts-ignore
        if (!getSafe(state, ['persistent', 'nexus', 'userInfo', 'isPremium'], false)) {
            api.showErrorNotification('You need to be a premium member to restore a list of mods', 'You need to be a premium member to restore a list of mods');
            return;
        }

        // Ask the user to select their file
        api.selectFile({create: false, title: 'Select your backup file to import'})
            .then(fileName => {
                fs.readFile(path.resolve(fileName), (error, jsonString) => {
                    // We don't want to restore for other games that might be in the modlist but aren't actively being managed
                    const activeGameId = getActiveGameId(state);

                    if (error) {
                        api.showErrorNotification(error, error);
                        return;
                    }

                    let mods = JSON.parse(jsonString) as Mod[];

                    mods = mods
                        // We only restore the mods for the current game that we're looking at
                        .filter(mod => mod.game === activeGameId)
                        // The nexus installer only installs mods for the nexus source, so let's filter out other sources
                        // However, this mod predates that check, so we have a backwards compatibility for older backups
                        .map(mod => {
                            if (!mod.source) {
                                mod.source = "nexus";
                            }

                            return mod;
                        })
                        .filter(mod => mod.source === "nexus" || !mod.source?.length);

                    const modsFound = mods.length;

                    const installedMods = getInstalledMods(state);

                    // Filter out any mods that aren't already installed. After this filter, we'll only have new mods
                    // This way we don't try to install mods twice
                    mods = mods.filter(mod => !installedMods.some(
                        // This will return true if the two mods (installedMod and mod) are the same
                        installedMod => installedMod.game === mod.game && installedMod.modId === mod.modId && installedMod.fileId === mod.fileId
                    ));

                    // `mod-update` is the Vortex internal event that's used for mod updates. Happily, it'll also download and install mods that aren't installed for us
                    for (const mod of mods) {
                        api.events.emit('mod-update', mod.game, mod.modId, mod.fileId, mod.source);
                    }

                    api.sendNotification({
                        type: 'success',
                        title: `${mods.length} mods for ${activeGameId} restores`,
                        message: `${modsFound} mods found for ${activeGameId}, but only ${mods.length} mods installed`
                    });
                });
            })
            .catch((error) => console.log(error));
    };

    // Register our option to restore backups. We use `999` as our position to put this at the end of the menu list.
    // Because we have the same position as the Modlist Backup option, they'll group together as a dropdown option
    context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup: Restore', restoreMods);

    // Register our option to backup mods. We use `999` as our position to put this at the end of the menu list.
    // Because we have the same position as the Modlist Backup: Restore option, they'll group together as a dropdown option
    context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup All Games', backupMods());

    // Register our option to backup mods from this game only. We use `999` as our position to put this at the end of the menu list.
    // Because we have the same position as the Modlist Backup: Restore option, they'll group together as a dropdown option
    context.registerAction('mod-icons', 999, 'show', {}, 'Modlist Backup Only This Game', backupMods(true));
};

module.exports = {default: init};
