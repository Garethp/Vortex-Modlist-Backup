import { IMod } from "vortex-api/lib/extensions/mod_management/types/IMod";
import { IState } from "vortex-api/lib/types/IState";
import {
  IExtensionApi,
  IExtensionContext,
} from "vortex-api/lib/types/IExtensionContext";
import getSafe from "./getSafe";
import { actions, selectors } from "vortex-api";
import { registerNexusIntegration } from "./nexus-integration";

const path = require("path");
const fs = require("fs");

// This is the data structure that I want our file to have
export interface Mod {
  name: string;
  game: string;
  modId: number;
  fileId: number;
  source?: string;
  enabled?: boolean;
  vortexId?: string;
  // The game Vortex installed the mod into. `game` is the game the mod was downloaded for, which can be different
  // when a game accepts mods from another game, like Skyrim Special Edition accepting Skyrim mods. We still need
  // `game` to download the mod again. Older backups don't have this
  installedGame?: string;
  // The plugin files (.esm, .esp, .esl) in the mod's own folder, so other tools can tell which mod a plugin came
  // from, and which mods (like SFSE or DLL mods) have none. Older backups don't have this, and it's left out when
  // the mod's folder can't be read
  plugins?: string[];
  // The version Vortex shows for the mod, and the archive it was last installed from. vortexId is the mod's folder
  // name, set at the first install, and Vortex keeps it (and the old fileId) when a newer archive is installed over
  // the mod, so these are the only fields that show what's really installed. Informational only: Restore doesn't
  // use them. Older backups don't have them, and each is left out when Vortex doesn't know it
  version?: string;
  archive?: string;
}

// Mods installed from a file on disk rather than downloaded have no modId or fileId, so they can't be downloaded
// again. They're still backed up with this source so the backup lists every mod, but restoring skips them
const LOCAL_SOURCE = "local";

const PLUGIN_EXTENSIONS = [".esm", ".esp", ".esl"];

// List the plugin files in a mod's folder. Plugins sit at the top of the folder for games whose mods go into the
// Data folder, or in a Data folder inside it for games whose mods go into the game's own folder
const modPlugins = (modPath: string): string[] => {
  const plugins: string[] = [];
  const readDir = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir);
    } catch (error) {
      return undefined;
    }
  };

  const top = readDir(modPath);
  if (top === undefined) return undefined;

  const isPlugin = (file: string) =>
    PLUGIN_EXTENSIONS.includes(path.extname(file).toLowerCase());

  plugins.push(...top.filter(isPlugin));
  const dataDir = top.find((file) => file.toLowerCase() === "data");
  if (dataDir !== undefined) {
    plugins.push(
      ...(readDir(path.join(modPath, dataDir)) || []).filter(isPlugin),
    );
  }

  return plugins.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
};

// The game a mod from a backup belongs to, falling back to the game it was downloaded for in older backups
const modGame = (mod: Mod): string => mod.installedGame ?? mod.game;

interface Profile {
  gameId: string;
  id: string;
  name?: string;
  lastActivated: number;
  modState?: Record<string, { enabled: boolean }>;
}

// shouldInstall is the user's choice of whether to install the mods once they've downloaded, or only download them.
// Integrations registered before it was added can ignore it
type InstallMods = (
  api: IExtensionApi,
  mod: Mod[],
  shouldInstall?: boolean,
) => void;

interface Integration {
  source: string;
  installMods: InstallMods;
}

// Get the active profile from the redux state.
const activeProfile = (state: IState): Profile => {
  const profileId = state.settings.profiles.activeProfileId;
  return getSafe(state, ["persistent", "profiles", profileId], undefined);
};

// Fetch the current active Game ID
const getActiveGameId = (state: IState): string => {
  const profile = activeProfile(state);
  return profile !== undefined ? profile.gameId : undefined;
};

// Get the profile whose enabled state we should record for a game. That's the active profile for the game we're
// managing, or the last active profile for any other game. Returns undefined if the game has never had a profile
const profileForGame = (state: IState, gameId: string): Profile => {
  const profile = activeProfile(state);
  if (profile !== undefined && profile.gameId === gameId) return profile;

  const profileId = getSafe(
    state,
    ["settings", "profiles", "lastActiveProfile", gameId],
    undefined,
  );
  if (profileId === undefined) return undefined;

  return getSafe(state, ["persistent", "profiles", profileId], undefined);
};

// Transform the format of the mod from what's used internally in Vortex into what we want to store in the file
// If we don't know the enabled state for the mod's game, leave it undefined so that restoring won't change it
// When stagingPath is given, the mod's plugin files are listed too
const transformModFormat = (
  mod: IMod,
  gameId: string,
  profile: Profile,
  stagingPath?: string,
  downloads?: Record<string, { localPath?: string }>,
): Mod => {
  const attributes = mod.attributes || {};
  const downloadable = !!(attributes.modId && attributes.fileId);
  const result: Mod = {
    // Mods installed from a file often have no modName, so fall back to the name Vortex shows
    name:
      attributes.modName ??
      attributes.name ??
      attributes.logicalFileName ??
      mod.id,
    game: attributes.downloadGame ?? (downloadable ? undefined : gameId),
    modId: attributes.modId,
    fileId: attributes.fileId,
    source: downloadable ? attributes.source : LOCAL_SOURCE,
    enabled:
      profile !== undefined && profile.modState !== undefined
        ? profile.modState[mod.id]?.enabled === true
        : undefined,
    vortexId: mod.id,
    installedGame: gameId,
  };

  // The archive: the download the mod was last installed from (archiveId changes with every install), falling back
  // to the mod's own record of its file name once that download has been removed from the Downloads list
  const version = attributes.version;
  if (typeof version === "string" && version.trim() !== "") result.version = version.trim();
  const archiveId = (mod as any).archiveId;
  const archive =
    (archiveId !== undefined ? downloads?.[archiveId]?.localPath : undefined) ??
    attributes.fileName;
  if (typeof archive === "string" && archive !== "") result.archive = path.basename(archive);

  if (stagingPath !== undefined && mod.installationPath) {
    const plugins = modPlugins(path.join(stagingPath, mod.installationPath));
    if (plugins !== undefined) result.plugins = plugins;
  }

  return result;
};

// The staging folder Vortex installs a game's mods into, or undefined if it can't be found
const stagingPathForGame = (state: IState, gameId: string): string => {
  try {
    return (selectors as any).installPathForGame(state, gameId);
  } catch (error) {
    return undefined;
  }
};

/*
 * The installed mods will come back in an object format for games, where as we want an array, so do the following:
 *    Get the entries of those objects, so we know which game each set of mods belongs to
 *    Transform them into the structure we want, using that game's profile for the enabled state
 *    We now have data in structure Mod[][], so let's concat all the array's into one array
 */
const getInstalledMods = (state: IState, withPlugins = false): Mod[] =>
  Object.entries(state.persistent.mods)
    .map(([gameId, game]) => {
      const profile = profileForGame(state, gameId);
      const stagingPath = withPlugins
        ? stagingPathForGame(state, gameId)
        : undefined;
      const downloads = getSafe(state, ["persistent", "downloads", "files"], {});
      return Object.values(game).map((mod) =>
        transformModFormat(mod, gameId, profile, stagingPath, downloads),
      );
    })
    .reduce((result, current) => result.concat(current), []);

// Replace characters that aren't allowed in Windows file names, so a profile name like "Main: Survival" still
// makes a valid default file name
const fileNamePart = (name: string): string =>
  name.trim().replace(/[\\/:*?"<>|\x00-\x1f\s]+/g, "_") || "unnamed";

// The local time as YYYYMMDD-HHMMSS, so backups sort by when they were made
const fileNameTimestamp = (date: Date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

// The default file name for a backup, saying what was backed up and when:
//    vortex-allgames-modlist-backup-<timestamp>.json for all games
//    vortex-<game>-modlist-backup-<timestamp>.json for the game being managed
//    vortex-<game>-<profile>-modlist-backup-<timestamp>.json for the active profile
const defaultBackupFileName = (
  state: IState,
  thisGameOnly: boolean,
  thisProfileOnly: boolean,
): string => {
  let scope = "allgames";
  if (thisGameOnly) {
    const profile = activeProfile(state);
    scope = fileNamePart(profile.gameId);
    if (thisProfileOnly)
      scope += `-${fileNamePart(profile.name ?? profile.id)}`;
  }
  return `vortex-${scope}-modlist-backup-${fileNameTimestamp()}.json`;
};

// Where the active profile's load order lives:
//  - "classic": the Plugins page (Vortex's plugin management, the rules-based method)
//  - "dnd": the Load Order page (drag and drop)
// A game that offers both records the choice per profile in settings.<game>.loadOrderManagementType, as
// "gamebryo" (Classic) or "dnd" (Starfield's extension does this, and its default is "dnd"). For other games, use the
// Load Order page's list if there is one, otherwise the Plugins page's
type LoadOrderSource = "classic" | "dnd";

const loadOrderSource = (state: IState, profile: Profile): LoadOrderSource => {
  const managementType = getSafe(
    state,
    ["settings", profile.gameId, "loadOrderManagementType", profile.id],
    undefined,
  );
  if (managementType === "gamebryo") return "classic";
  if (managementType !== undefined) return "dnd";

  const dndLoadOrder = getSafe(
    state,
    ["persistent", "loadOrder", profile.id],
    undefined,
  );
  if (Array.isArray(dndLoadOrder) && dndLoadOrder.length > 0) return "dnd";

  const classic = getSafe(state, ["loadOrder"], undefined);
  return classic !== undefined && Object.keys(classic).length > 0
    ? "classic"
    : "dnd";
};

interface LoadOrderEntry {
  enabled: boolean;
  id: string;
  name: string;
  locked?: boolean;
}

// The Plugins page's load order for the active profile, in load order. Vortex's plugin management keeps it in
// state.loadOrder, keyed by lower case plugin name: { name, enabled, loadOrder }. That can still list plugins that
// are no longer installed, so when Vortex has a list of the plugins it found, keep only those (like plugins.txt).
// The game always loads its own plugins (base game, DLC, Creations in the .ccc file) and Vortex leaves them out of
// plugins.txt and marks them not enabled, so save them as enabled and locked, like the Load Order page does
const classicLoadOrder = (state: IState): LoadOrderEntry[] => {
  const loadOrder: Record<
    string,
    { name?: string; enabled?: boolean; loadOrder?: number }
  > = getSafe(state, ["loadOrder"], {});
  const installed: Record<string, { isNative?: boolean }> = getSafe(
    state,
    ["session", "plugins", "pluginList"],
    {},
  );
  const native = new Set<string>();
  const installedIds = new Set<string>();
  Object.keys(installed).forEach((id) => {
    installedIds.add(id.toLowerCase());
    if (installed[id]?.isNative === true) native.add(id.toLowerCase());
  });

  return Object.keys(loadOrder)
    .filter((id) => installedIds.size === 0 || installedIds.has(id))
    .map((id) => ({ id, entry: loadOrder[id] }))
    .sort((a, b) => (a.entry.loadOrder ?? -1) - (b.entry.loadOrder ?? -1))
    .map(({ id, entry }): LoadOrderEntry => {
      const isNative = native.has(id);
      return {
        enabled: isNative || entry.enabled === true,
        id,
        name: entry.name ?? id,
        ...(isNative ? { locked: true } : {}),
      };
    });
};

// The load order backup goes next to the modlist backup, with "modlist" swapped for "loadorder" in the name:
//    vortex-starfield-Default-modlist-backup-<timestamp>.json -> vortex-starfield-Default-loadorder-backup-<timestamp>.json
// A Plugins page (Classic) load order gets "loadorder-classic" instead, because the Load Order page can't import it:
//    vortex-starfield-Default-loadorder-classic-backup-<timestamp>.json
// If the user picked a name without "modlist-backup" in it, add "-loadorder" (or "-loadorder-classic") to the end
const loadOrderFileName = (
  backupPath: string,
  source: LoadOrderSource = "dnd",
): string => {
  const dir = path.dirname(backupPath);
  const ext = path.extname(backupPath);
  const base = path.basename(backupPath, ext);
  const kind = source === "classic" ? "loadorder-classic" : "loadorder";
  const name = /modlist-backup/i.test(base)
    ? base.replace(/modlist-backup/i, `${kind}-backup`)
    : `${base}-${kind}`;
  return path.join(dir, `${name}${ext || ".json"}`);
};

// Write a JSON file in pretty-print for user readability. We write to a temporary file first and then rename it
// over the backup, so that a crash part way through the write can't leave a half written backup
const writeJsonFile = (
  filePath: string,
  data: string,
  callback: (error?: Error) => void,
) => {
  const tempPath = `${filePath}.tmp`;
  const onError = (error: Error) => {
    fs.unlink(tempPath, () => undefined);
    callback(error);
  };

  fs.writeFile(tempPath, data, (error: Error) => {
    if (error) return onError(error);

    fs.rename(tempPath, filePath, (error: Error) => {
      if (error) return onError(error);
      callback();
    });
  });
};

const init = (context: IExtensionContext) => {
  const { api } = context;
  const integrations: Integration[] = [];

  context.once(() => {
    registerNexusIntegration(api);
  });

  context.registerAPI(
    "addSourceToModlistBackup",
    (source: string, installMods: InstallMods) => {
      console.log("Source being registered", source);

      if (integrations.some((existing) => existing.source == source)) return;

      integrations.push({
        source,
        installMods,
      });
    },
    {},
  );

  // Save the active profile's load order next to its modlist backup. Vortex keeps a load order in one of two places:
  //  - the Load Order page (drag and drop, "dnd"): persistent.loadOrder[profile]. We save exactly what that page's
  //    Export button saves, so the file can be restored with its Import button
  //  - the Plugins page (rules-based, "Classic"): the loadOrder state of Vortex's plugin management, which is what
  //    Vortex writes to plugins.txt. We save it in the same shape, in load order, with "-classic" in the file name
  // Starfield lets each profile pick either one, and the other one is left as it was when the user switched, so
  // reading the wrong one gives an old load order. See loadOrderSource
  const backupLoadOrder = (state: IState, backupPath: string) => {
    const profile = activeProfile(state);
    const source = loadOrderSource(state, profile);
    const loadOrder =
      source === "classic"
        ? classicLoadOrder(state)
        : getSafe(state, ["persistent", "loadOrder", profile.id], undefined);

    if (!Array.isArray(loadOrder) || loadOrder.length === 0) {
      api.sendNotification({
        type: "warning",
        title: "Backup Complete",
        message: `Modlist backed up to ${backupPath}. This profile has no load order to back up`,
      });
      return;
    }

    const loadOrderPath = loadOrderFileName(backupPath, source);

    // Like the modlist, don't overwrite a file that isn't a load order backup
    if (fs.existsSync(loadOrderPath)) {
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(loadOrderPath));
      } catch (error) {
        existing = undefined;
      }

      if (!Array.isArray(existing)) {
        api.showErrorNotification(
          "Load order not saved",
          `Modlist backed up to ${backupPath}, but ${loadOrderPath} already exists and isn't a load order backup, so it wasn't overwritten`,
          { allowReport: false },
        );
        return;
      }
    }

    writeJsonFile(
      loadOrderPath,
      JSON.stringify(loadOrder, null, 2),
      (error) => {
        if (error) {
          api.showErrorNotification(
            "Failed to save load order backup",
            `Modlist backed up to ${backupPath}, but the load order couldn't be saved: ${error}`,
          );
          return;
        }

        api.sendNotification({
          type: "success",
          title: "Backup Complete",
          message: `Modlist backed up to ${backupPath} and load order (${
            loadOrder.length
          } plugins, from the ${
            source === "classic" ? "Plugins page" : "Load Order page"
          }) backed up to ${loadOrderPath}`,
        });
      },
    );
  };

  const backupMods = (
    thisGameOnly: boolean = false,
    thisProfileOnly: boolean = false,
  ) => {
    return () => {
      const state = api.store.getState();
      const activeGameId = getActiveGameId(state);

      if (thisGameOnly && activeGameId === undefined) {
        api.showErrorNotification(
          "No game is being managed",
          "Select a game to manage before backing up its mods",
          { allowReport: false },
        );
        return;
      }

      let mods = getInstalledMods(state, true);

      // Ask the user where they want to export to. The save dialog asks the user before replacing an existing file.
      // Older versions of Vortex (and the vortex-api types we build against) don't have saveFile, so fall back to
      // the open dialog there
      const title = "Select file to export to";
      const selectBackupFile: Promise<string> =
        typeof (api as any).saveFile === "function"
          ? (api as any).saveFile({
              title,
              defaultPath: defaultBackupFileName(
                state,
                thisGameOnly,
                thisProfileOnly,
              ),
              filters: [
                { name: "Modlist backup", extensions: ["json"] },
                { name: "All files", extensions: ["*"] },
              ],
            })
          : api.selectFile({ create: true, title });

      selectBackupFile
        .then((fileName) => {
          if (!fileName) return;

          mods = mods
            // Mods installed from a file on disk have no modId or fileId. They're kept with the "local" source so
            // the backup lists every mod, and restoring skips them. A downloaded mod still needs its game
            .filter((mod) => mod.source === LOCAL_SOURCE || mod.game);

          // If we're only backing up the existing games, let's filter out other ones
          if (thisGameOnly) {
            mods = mods.filter((mod) => modGame(mod) === activeGameId);
          }

          if (thisProfileOnly) {
            mods = mods.filter((mod) => mod.enabled);
          }

          // If the file already has content, make sure it's a modlist backup before we touch it, so that picking the
          // wrong file doesn't overwrite it
          let existingMods: Mod[] = [];
          if (fs.existsSync(fileName) && fs.readFileSync(fileName).length > 2) {
            try {
              existingMods = JSON.parse(fs.readFileSync(fileName));
            } catch (error) {
              existingMods = undefined;
            }

            if (!Array.isArray(existingMods)) {
              api.showErrorNotification(
                "Backup not saved",
                `${path.resolve(
                  fileName,
                )} already exists and isn't a modlist backup, so it wasn't overwritten`,
                { allowReport: false },
              );
              return;
            }
          }

          // If we're backing up one game over an existing mod list, we only want to overwrite the mods for that game.
          // We don't want to remove mods from the backup for other games. A backup of all games replaces the file
          if (thisGameOnly) {
            mods = mods.concat(
              existingMods.filter(
                (mod: Mod) => !!mod && modGame(mod) !== activeGameId,
              ),
            );
          }

          const backupPath = path.resolve(fileName);
          writeJsonFile(backupPath, JSON.stringify(mods, null, 4), (error) => {
            if (error) {
              api.showErrorNotification("Failed to save modlist backup", error);
              return;
            }

            if (!thisProfileOnly) {
              api.sendNotification({
                type: "success",
                title: "Backup Complete",
                message: `Modlist backed up to ${backupPath}`,
              });
              return;
            }

            backupLoadOrder(state, backupPath);
          });
        })
        .catch((error) => console.log(error));
    };
  };

  const restoreMods = () => {
    const state: IState = api.store.getState();
    const doInstall = "Yes, download and install";
    const dontInstall = "No, download only";

    // Installed mods with the `mod-update` event requires the user to be a Premium Member internally in Vortex, I think that's because
    // this method won't show any ads. Because of this restriction, we're going to run a check now rather than later, to give earlier feedback
    // @ts-ignore
    if (
      !getSafe(state, ["persistent", "nexus", "userInfo", "isPremium"], false)
    ) {
      api.showErrorNotification(
        "You need to be a premium member to restore a list of mods",
        "You need to be a premium member to restore a list of mods",
      );
      return;
    }

    // We don't want to restore for other games that might be in the modlist but aren't actively being managed
    const activeGameId = getActiveGameId(state);

    if (activeGameId === undefined) {
      api.showErrorNotification(
        "No game is being managed",
        "Select a game to manage before restoring its mods",
        { allowReport: false },
      );
      return;
    }

    // Ask the user to select their file
    api
      .selectFile({ create: false, title: "Select your backup file to import" })
      .then(async (fileName) => {
        if (!fileName) return;

        const backupPath = path.resolve(fileName);
        let mods: Mod[];

        try {
          mods = JSON.parse(await fs.promises.readFile(backupPath));
        } catch (error) {
          mods = undefined;
        }

        if (!Array.isArray(mods)) {
          api.showErrorNotification(
            "Failed to read modlist backup",
            `${backupPath} couldn't be read or isn't a modlist backup`,
            { allowReport: false },
          );
          return;
        }

        mods = mods
          // We only restore the mods for the current game that we're looking at
          .filter((mod) => !!mod && modGame(mod) === activeGameId)
          // The nexus installer only installs mods for the nexus source, so let's filter out other sources
          // However, this mod predates that check, so we have a backwards compatibility for older backups
          .map((mod) => {
            if (!mod.source) {
              mod.source = "nexus";
            }

            return mod;
          });

        // Mods installed from a file on disk can't be downloaded, so they're counted and skipped
        const localMods = mods.filter((mod) => mod.source === LOCAL_SOURCE);

        mods = mods.filter((mod) =>
          integrations.some(({ source }) => mod.source === source),
        );

        const modsFound = mods.length;

        // Only mods installed into the current game count, so that a mod installed for another game that shares
        // its downloads still gets installed here
        const installedMods = getInstalledMods(state).filter(
          (mod) => mod.installedGame === activeGameId,
        );

        // Filter out any mods that aren't already installed. After this filter, we'll only have new mods
        // This way we don't try to install mods twice
        const modsToInstall = mods.filter(
          (mod) =>
            !installedMods.some(
              // This will return true if the two mods (installedMod and mod) are the same
              (installedMod) =>
                installedMod.game === mod.game &&
                installedMod.modId === mod.modId &&
                installedMod.fileId === mod.fileId,
            ),
        );

        // Get a list of all installed mods whose enabled state is different to what's in the backup so that we can set enabled state for the profile correctly
        const modsToChangeState = mods
          .filter((mod) => mod.enabled !== undefined)
          .map(
            (mod) =>
              installedMods.filter(
                // This will return true if the two mods (installedMod and mod) are the same
                (installedMod) =>
                  installedMod.game === mod.game &&
                  installedMod.modId === mod.modId &&
                  installedMod.fileId === mod.fileId &&
                  installedMod.enabled !== undefined &&
                  installedMod.enabled !== mod.enabled,
              )[0],
          )
          .filter((mod) => !!mod);

        // Only ask about installing if automatic installation is off and there's something new to install
        const shouldInstall =
          state.settings.automation.install ||
          (modsToInstall.length > 0 &&
            (await api
              .showDialog(
                "question",
                "Automatically install?",
                {
                  text: "In your settings, you've disabled automatic installation on download. Would you like to install these mods when they download anyway?",
                },
                [
                  {
                    label: dontInstall,
                  },
                  {
                    label: doInstall,
                  },
                ],
              )
              .then((result) => result?.action === doInstall)));

        const installs: Record<string, Mod[]> = {};

        // `mod-update` is the Vortex internal event that's used for mod updates. Happily, it'll also download and install mods that aren't installed for us
        for (const mod of modsToInstall) {
          const integration = integrations.find(
            ({ source }) => mod.source === source,
          );
          if (!integration) continue;
          if (!installs[integration.source]) installs[integration.source] = [];

          installs[integration.source].push(mod);
        }

        Object.keys(installs).forEach((installSource) => {
          const integration = integrations.find(
            ({ source }) => installSource === source,
          );

          integration.installMods(api, installs[installSource], shouldInstall);
        });

        // Flip the enabled state for mods that aren't set correctly for this profile
        modsToChangeState.forEach((mod) =>
          api.store.dispatch(
            actions.setModEnabled(
              selectors.activeProfile(api.getState()).id,
              mod.vortexId,
              !mod.enabled,
            ),
          ),
        );

        api.sendNotification({
          type: "success",
          title: `Modlist restored for ${activeGameId}`,
          message: `${modsFound} mods found in the backup. ${
            modsToInstall.length
          } new mods queued for download${
            shouldInstall ? " and install" : ""
          }, ${
            modsToChangeState.length
          } enabled or disabled to match the backup${
            localMods.length > 0
              ? `. ${localMods.length} mods installed from a file on disk were skipped, because they can't be downloaded`
              : ""
          }`,
        });
      })
      .catch((error) =>
        api.showErrorNotification("Failed to restore modlist backup", error),
      );
  };

  // Register our option to restore backups. We use `999` as our position to put this at the end of the menu list.
  // Because we have the same position as the Back Up Modlist options, they'll group together as a dropdown option
  context.registerAction(
    "mod-icons",
    999,
    "import",
    {},
    "Restore Modlist",
    restoreMods,
  );

  // Register our option to backup mods. We use `999` as our position to put this at the end of the menu list.
  // Because we have the same position as the Restore Modlist option, they'll group together as a dropdown option
  context.registerAction(
    "mod-icons",
    999,
    "archive",
    {},
    "Back Up Modlist (All Games)",
    backupMods(),
  );

  // Register our option to backup mods from this game only. We use `999` as our position to put this at the end of the menu list.
  // Because we have the same position as the Restore Modlist option, they'll group together as a dropdown option
  context.registerAction(
    "mod-icons",
    999,
    "game",
    {},
    "Back Up Modlist (This Game)",
    backupMods(true),
  );

  context.registerAction(
    "mod-icons",
    999,
    "profile",
    {},
    "Back Up Modlist and Load Order (This Profile)",
    backupMods(true, true),
  );
};

module.exports = { default: init };
