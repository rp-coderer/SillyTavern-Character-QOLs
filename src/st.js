/**
 * Single bridge to SillyTavern's own modules, so the relative path depth lives
 * in exactly one place. Everything exported here comes straight from the app.
 *
 * Part of the Character QOLs extension.
 */

import { getContext, renderExtensionTemplateAsync } from '../../../../extensions.js';
import {
    converter,
    deleteCharacterChatByName,
    duplicateCharacter,
    openCharacterChat,
    renameGroupOrCharacterChat,
    setActiveCharacter,
    setActiveGroup,
    updateRemoteChatName,
} from '../../../../../script.js';
import { decodeStyleTags, encodeStyleTags } from '../../../../chats.js';
import { deleteGroupChatByName, openGroupById, openGroupChat } from '../../../../group-chats.js';
import { user_avatar } from '../../../../personas.js';
import { favsToHotswap } from '../../../../RossAscends-mods.js';
import { openWelcomeScreen } from '../../../../welcome-screen.js';
import { openWorldInfoEditor, world_names } from '../../../../world-info.js';

export {
    getContext,
    renderExtensionTemplateAsync,
    converter,
    deleteCharacterChatByName,
    deleteGroupChatByName,
    duplicateCharacter,
    openCharacterChat,
    openGroupById,
    openGroupChat,
    openWelcomeScreen,
    renameGroupOrCharacterChat,
    setActiveCharacter,
    setActiveGroup,
    updateRemoteChatName,
    decodeStyleTags,
    encodeStyleTags,
    user_avatar,
    favsToHotswap,
    openWorldInfoEditor,
    world_names,
};
