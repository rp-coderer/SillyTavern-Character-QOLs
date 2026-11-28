/**
 * Single bridge to SillyTavern's own modules, so the relative path depth lives
 * in exactly one place. Everything exported here comes straight from the app.
 *
 * Part of the Character QOLs extension.
 */

import { getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { converter, duplicateCharacter, openCharacterChat, setActiveCharacter, setActiveGroup } from '../../../../../script.js';
import { decodeStyleTags, encodeStyleTags } from '../../../../chats.js';
import { favsToHotswap } from '../../../../RossAscends-mods.js';
import { openWorldInfoEditor, world_names } from '../../../../world-info.js';

export {
    getContext,
    renderExtensionTemplateAsync,
    converter,
    duplicateCharacter,
    openCharacterChat,
    setActiveCharacter,
    setActiveGroup,
    decodeStyleTags,
    encodeStyleTags,
    favsToHotswap,
    openWorldInfoEditor,
    world_names,
};
