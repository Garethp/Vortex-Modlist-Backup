## Vortex Modlist and Load Order Backup

A fork of [Garethp's Vortex Modlist Backup](https://github.com/Garethp/Vortex-Modlist-Backup)
([Nexus Mods page](https://www.nexusmods.com/site/mods/67)), with bug fixes and load order backup. All credit for the
original extension goes to Garethp. See [CHANGELOG.md](CHANGELOG.md) for what changed.

#### Installation
 * Download the latest `.7z` from the `Releases` tab here
 * Open the `Extensions` page in Vortex
 * Drag and drop the `.7z` file into the bottom pane of that page
 * Restart Vortex

If you have an older version installed, remove it on the `Extensions` page and restart Vortex first.

#### What does this do?
This is a **very simple** extension that takes the list of mods that Vortex currently has and writes them to a file.
It then allows you to take that file and Restore your list of mods, making Vortex download them again as if you'd 
downloaded them from the Nexus Website.

It adds four buttons to the toolbar on the `Mods` page:

| Button | What it does |
|---|---|
| Restore Modlist | Downloads the mods in a backup file again, and enables or disables them as they were |
| Back Up Modlist (All Games) | Backs up the mods for every game |
| Back Up Modlist (This Game) | Backs up the mods for the game you're managing |
| Back Up Modlist and Load Order (This Profile) | Backs up the enabled mods in your current profile, and its load order |

Backups are named for what was backed up and when, in your local time. You can change the name when saving:
 * `vortex-allgames-modlist-backup-20261026-213039.json`
 * `vortex-starfield-modlist-backup-20261026-213039.json`
 * `vortex-starfield-Default-modlist-backup-20261026-213039.json`

#### Does this backup the Load Order
Yes, when you use **Back Up Modlist and Load Order (This Profile)**. It saves a second file next to the modlist, like
`vortex-starfield-Default-loadorder-backup-20261026-213039.json`. This is the same file the `Export` button on Vortex's
`Load Order` page makes.

Restore Modlist doesn't restore the load order. To restore both:
 1. Use **Restore Modlist** with the modlist file, and wait for all the mods to download and install
 2. Open the `Load Order` page, click `Import`, and choose the load order file

If the game uses Vortex's `Plugins` page instead (for Starfield, the "Rules-based (Classic)" load order method in
Starfield Settings), the second file is that page's order, which is what Vortex writes to plugins.txt. It has
`loadorder-classic` in its name, like `vortex-starfield-Default-loadorder-classic-backup-20261104-213039.json`. The
`Load Order` page can't import it; it's a record of the order, so use it to put plugins back in order by hand or with
rules. Starfield remembers both lists, and the one you aren't using stays as it was when you switched, so the extension
checks which method the profile uses and saves that one.

Games with neither page have no load order to back up. The modlist is still saved, and you'll get a warning instead.

#### Does it backup Mod Configs, Dependencies Etc.
No, only the list of mods and, for a profile, its load order.

#### Does it back up the mod files
No, this only stores list of mods. When you Restore the list, Vortex will download every mod on the list. Mods that
didn't come from the Nexus, like ones you installed from a file, are listed in the backup with `"source": "local"` so
the backup matches your Mods page, but Restore skips them because there's nothing to download. Keep those files
yourself.

Each mod in the backup also lists its plugin files (`.esm`, `.esp`, `.esl`) under `plugins`, so you can tell which mod
a plugin came from. Mods with no plugins, like SFSE or DLL mods, have an empty list.

#### Are there any requirements
You need to be a premium member on the Nexus site to Restore the list, since the Vortex client won't let you 
download the mods automatically unless you're a premium member, since you need to see the ads.

#### Building
 * `corepack yarn@3.6.4 install --mode=skip-build`
 * `corepack yarn@3.6.4 webpack`
 * Copy `info.json` into `dist/`
 * Pack `dist/index.js` and `dist/info.json` into a `.7z` with [7-Zip](https://www.7-zip.org/)
