/**
 * Data layer of the welcome screen chat list: loading every chat, resolving the
 * character/group and persona of each one, and the actions that mutate a chat
 * (pin, rename, delete, open).
 *
 * Part of the Character QOLs extension.
 */

import { chatTimestamp, getPreviewText } from '../chat-utils.js';
import { resolveChatPersona } from '../persona.js';
import {
    deleteCharacterChatByName,
    deleteGroupChatByName,
    openCharacterChat,
    openGroupById,
    openGroupChat,
    renameGroupOrCharacterChat,
    setActiveCharacter,
    setActiveGroup,
    updateRemoteChatName,
} from '../st.js';

const PINNED_STORAGE_KEY = 'pinnedChats';
const CACHE_TTL_MS = 60_000;
const MAX_CHATS = 3000;

/**
 * @typedef {object} WelcomeChat
 * @property {string} key Stable storage key (matches SillyTavern's pin keys)
 * @property {string} fileName Chat file name including `.jsonl`
 * @property {string} chatName Chat name without the extension
 * @property {boolean} isGroup
 * @property {string} avatar Character avatar file name (empty for groups)
 * @property {string} groupId Group id (empty for character chats)
 * @property {string} name Character or group name
 * @property {string} thumbnail Character/group avatar URL
 * @property {string} lastMes Last message timestamp
 * @property {number} messageCount Message count
 * @property {string} fileSize Human readable file size
 * @property {string} preview Short last message preview
 * @property {import('../persona.js').ChatPersona} persona
 * @property {boolean} pinned
 */

/** @type {{ at: number, items: WelcomeChat[], context: object|null }} */
let cache = { at: 0, items: [], context: null };

/**
 * Reads SillyTavern's pin storage (the same `accountStorage` key its welcome
 * screen uses, so both UIs agree on what is pinned).
 * @param {ReturnType<import('../st.js').getContext>} context
 * @returns {Record<string, { group?: string, avatar?: string, file_name: string }>}
 */
function readPinnedStore(context) {
    try {
        const raw = context.accountStorage.getItem(PINNED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.warn('[Character QOLs] Could not parse the pinned chats storage.', error);
        return {};
    }
}

/**
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {Record<string, object>} store
 */
function writePinnedStore(context, store) {
    context.accountStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(store));
}

/**
 * Key used by SillyTavern's own pinned-chat storage.
 * @param {{ groupId: string, avatar: string, fileName: string }} item
 * @returns {string}
 */
function pinnedKey(item) {
    const prefix = item.groupId ? `group_${item.groupId}` : `char_${item.avatar}`;
    return `${prefix}_${item.fileName}`;
}

/**
 * Sorts chats newest first.
 * @param {WelcomeChat[]} items
 * @returns {WelcomeChat[]}
 */
function sortChats(items) {
    return items.sort((a, b) => chatTimestamp(b) - chatTimestamp(a));
}

/**
 * Turns one raw `/api/chats/recent` entry into the shape the UI uses.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {object} raw
 * @returns {WelcomeChat|null}
 */
function normalizeChat(context, raw) {
    const avatar = typeof raw.avatar === 'string' ? raw.avatar : '';
    const groupId = typeof raw.group === 'string' ? raw.group : '';
    const character = avatar ? context.characters.find((entry) => entry.avatar === avatar) ?? null : null;
    const group = groupId ? context.groups.find((entry) => entry.id === groupId) ?? null : null;

    // Chats whose card or group is gone are not actionable; the native list
    // filters them out as well.
    if (!character && !group) {
        return null;
    }

    const fileName = String(raw.file_name ?? '');
    const thumbnail = group
        ? group.avatar_url
            ? context.getThumbnailUrl('avatar', group.avatar_url)
            : ''
        : character
            ? context.getThumbnailUrl('avatar', character.avatar)
            : '';

    return {
        key: pinnedKey({ groupId, avatar, fileName }),
        fileName,
        chatName: fileName.replace(/\.jsonl$/, ''),
        isGroup: Boolean(group),
        avatar,
        groupId,
        name: group?.name ?? character?.name ?? fileName,
        thumbnail,
        lastMes: raw.last_mes ?? '',
        messageCount: Number.isFinite(raw.chat_items) ? raw.chat_items : 0,
        fileSize: typeof raw.file_size === 'string' ? raw.file_size : '',
        preview: getPreviewText(raw.mes),
        persona: resolveChatPersona(context, raw.chat_metadata),
        pinned: false,
    };
}

/**
 * Loads every chat known to SillyTavern, newest first. The response is cached
 * for a minute, because it reads all chat files on the server.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<WelcomeChat[]>}
 */
async function loadChats(context, { force = false } = {}) {
    if (!force && cache.context === context && cache.items.length > 0 && Date.now() - cache.at < CACHE_TTL_MS) {
        return cache.items;
    }

    const pinnedStore = readPinnedStore(context);
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ max: MAX_CHATS, pinned: Object.values(pinnedStore), metadata: true }),
        cache: 'no-cache',
    });

    if (!response.ok) {
        throw new Error(`Recent chats request failed with status ${response.status}`);
    }

    const data = await response.json();
    const items = (Array.isArray(data) ? data : [])
        .map((raw) => normalizeChat(context, raw))
        .filter((item) => item !== null);

    for (const item of items) {
        item.pinned = item.key in pinnedStore;
    }

    cache = { at: Date.now(), items: sortChats(items), context };
    return cache.items;
}

/**
 * Drops the cached chat list so the next call refetches it.
 */
function invalidateChats() {
    cache = { at: 0, items: [], context: null };
}

/**
 * Pins or unpins a chat in SillyTavern's own storage.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {WelcomeChat} item
 * @param {boolean} pinned
 */
function setPinned(context, item, pinned) {
    const store = readPinnedStore(context);
    if (pinned) {
        store[item.key] = { group: item.groupId, avatar: item.avatar, file_name: item.fileName };
    } else {
        delete store[item.key];
    }
    writePinnedStore(context, store);
    item.pinned = pinned;
}

/**
 * Renames a chat and migrates its pin to the new key.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {WelcomeChat} item
 * @param {string} newName
 * @returns {Promise<boolean>} Whether the rename was attempted successfully
 */
async function renameChat(context, item, newName) {
    const name = String(newName ?? '').trim().replace(/\.jsonl$/i, '');
    if (!name || name === item.chatName) {
        return false;
    }

    const characterId = item.isGroup
        ? undefined
        : context.characters.findIndex((entry) => entry.avatar === item.avatar);
    if (!item.isGroup && characterId < 0) {
        return false;
    }

    await renameGroupOrCharacterChat({
        characterId: item.isGroup ? undefined : String(characterId),
        groupId: item.isGroup ? item.groupId : undefined,
        oldFileName: item.chatName,
        newFileName: name,
        loader: false,
    });

    if (!item.isGroup) {
        await updateRemoteChatName(characterId, name);
    }

    const store = readPinnedStore(context);
    if (item.key in store) {
        const pinned = store[item.key];
        delete store[item.key];
        const fileName = `${name}.jsonl`;
        store[pinnedKey({ groupId: item.groupId, avatar: item.avatar, fileName })] = {
            group: pinned.group,
            avatar: pinned.avatar,
            file_name: fileName,
        };
        writePinnedStore(context, store);
    }

    item.chatName = name;
    item.fileName = `${name}.jsonl`;
    item.key = pinnedKey({ groupId: item.groupId, avatar: item.avatar, fileName: item.fileName });
    return true;
}

/**
 * Deletes a chat and removes its pin.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {WelcomeChat} item
 * @returns {Promise<boolean>}
 */
async function deleteChat(context, item) {
    if (item.isGroup) {
        await deleteGroupChatByName(item.groupId, item.chatName);
    } else {
        const characterId = context.characters.findIndex((entry) => entry.avatar === item.avatar);
        if (characterId < 0) {
            return false;
        }
        await deleteCharacterChatByName(String(characterId), item.chatName);
    }

    if (item.pinned) {
        setPinned(context, item, false);
    }
    invalidateChats();
    return true;
}

/**
 * Opens a chat for its character or group.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {WelcomeChat} item
 */
async function openChat(context, item) {
    if (item.isGroup) {
        await openGroupById(item.groupId);
        setActiveGroup(item.groupId);
        context.saveSettingsDebounced();
        await openGroupChat(item.groupId, item.chatName);
        return;
    }

    const characterId = context.characters.findIndex((entry) => entry.avatar === item.avatar);
    if (characterId < 0) {
        return;
    }

    const isActiveCharacter = !context.groupId && String(context.characterId) === String(characterId);
    if (isActiveCharacter && context.chatId === item.chatName) {
        const sendTextarea = document.getElementById('send_textarea');
        if (sendTextarea instanceof HTMLElement) {
            sendTextarea.focus();
        }
        return;
    }

    if (!isActiveCharacter) {
        await context.selectCharacterById(characterId);
    }

    setActiveCharacter(item.avatar);
    setActiveGroup(null);
    context.saveSettingsDebounced();
    await openCharacterChat(item.chatName);
}

/**
 * Reads the native "Recent chats settings" from account storage so the
 * overhauled list uses the same max/collapsed counts.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @returns {{ maxDisplayed: number, collapsedDisplayed: number }}
 */
function readListSettings(context) {
    const fallback = { maxDisplayed: 50, collapsedDisplayed: 5 };
    try {
        const raw = context.accountStorage.getItem('recentChatsSettings');
        if (!raw) {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        return {
            maxDisplayed: Math.max(1, parseInt(parsed.maxDisplayed) || fallback.maxDisplayed),
            collapsedDisplayed: Math.max(1, parseInt(parsed.collapsedDisplayed) || fallback.collapsedDisplayed),
        };
    } catch {
        return fallback;
    }
}

export {
    deleteChat,
    invalidateChats,
    loadChats,
    openChat,
    readListSettings,
    renameChat,
    setPinned,
    sortChats,
};
