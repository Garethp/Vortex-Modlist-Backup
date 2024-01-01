## Changelog

#### Version 0.4.0
 * There's a new option to only backup mods enabled in the current profile
 * Backup files created from now on will contain information on whether or not the mod was enabled in the current active profile
 * If you restore a mod from a backup made from this version onwards, it won't enable mods that were disabled when backed up

#### Version 0.3.2
 * Ask the user if they want to install the mods when they have auto-install disabled in the settings

#### Version 0.3.1
 * Cancelling the file selector for creating or restoring backups no longer causes an error (#3)
 * Trying to save to an already existing blank text file will no longer cause an error (#5)

#### Version 0.3.0
 * Added the ability to backup the mods for just one game
 * Filtered out the backup output to remove mods that have no modId or fileId
 * Added support for a newer version of Vortex

#### Version 0.2.0
 * Moved to Typescript
 * Changed error popups to success notifications
 * Backuping up modlist no longer removes mods from games that aren't part of Vortex anymore

#### Version 0.1.1
 * Added a file selector to choose where to back up to and restore from

#### Version 0.1.0
 * First release
