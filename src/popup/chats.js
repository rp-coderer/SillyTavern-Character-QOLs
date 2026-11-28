/**
 * Chat list view of the preview popup: every chat stored for the previewed
 * character, with the most recently active one highlighted. Clicking a chat
 * closes the preview and opens that chat in SillyTavern.
 *
 * Part of the Character QOLs extension.
 */

import { resolvePreviewCharacter } from '../character.js';
import { openCharacterChat, setActiveCharacter, setActiveGroup, user_avatar } from '../st.js';

const CHAT_FILE_EXTENSION = '.jsonl';

/**
 * Shows the chat list instead of the character sections.
 * @param {object|null} preview
 */
function openChatsView(preview) {
    if (!preview || preview.edit || preview.chats) {
        return;
    }

    preview.chats = {
        items: [],
        loading: true,
        error: null,
        requestId: 0,
    };
    preview.setChatsOpen?.(true);
    preview.body.replaceChildren();
    renderChatsView(preview);
    void loadChats(preview);
}

/**
 * Leaves the chat list and restores the character sections.
 * @param {object|null} preview
 */
function closeChatsView(preview) {
    if (!preview?.chats) {
        return;
    }

    preview.chats = null;
    preview.setChatsOpen?.(false);
    preview.refresh?.();
}

/**
 * Repaints the chat list from the already fetched data.
 * @param {object} preview
 */
function refreshChatsView(preview) {
    if (!preview.chats) {
        return;
    }

    renderChatsView(preview);
}

/**
 * Fetches all chats of the previewed character.
 * @param {object} preview
 */
async function loadChats(preview) {
    const state = preview.chats;
    if (!state) {
        return;
    }

    const requestId = ++state.requestId;
    const character = resolvePreviewCharacter(preview);

    state.loading = true;
    state.error = null;
    renderChatsView(preview);

    try {
        // The character-chats endpoint (rather than /api/chats/search) is used
        // because it can also return each chat's metadata line, which is where
        // the locked user persona is stored (`chat_metadata.persona`).
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: preview.context.getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar, metadata: true }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            throw new Error(`Chat list request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (preview.chats !== state || state.requestId !== requestId) {
            return;
        }

        // `{ error: true }` means the character simply has no chats directory yet.
        state.items = Array.isArray(data)
            ? data.sort((a, b) => chatTimestamp(b) - chatTimestamp(a))
            : [];
        state.loading = false;
    } catch (error) {
        if (preview.chats !== state || state.requestId !== requestId) {
            return;
        }

        console.error('[Character QOLs] Failed to load the character chats.', error);
        state.items = [];
        state.loading = false;
        state.error = 'Could not load the chats of this character.';
    }

    renderChatsView(preview);
}

/**
 * Renders the chat list, the loading state or the error state.
 * @param {object} preview
 */
function renderChatsView(preview) {
    const state = preview.chats;
    if (!state) {
        return;
    }

    const root = document.createElement('div');
    root.className = 'st-cq-chats';

    const head = document.createElement('div');
    head.className = 'st-cq-chats-head';

    const title = document.createElement('span');
    title.className = 'st-cq-chats-title';
    title.textContent = 'Chats';
    head.append(title);

    if (!state.loading && !state.error && state.items.length > 0) {
        const count = document.createElement('small');
        count.className = 'st-cq-chats-count';
        count.textContent = state.items.length === 1 ? '1 chat' : `${state.items.length} chats`;
        head.append(count);
    }

    root.append(head);

    if (state.loading) {
        const note = document.createElement('div');
        note.className = 'st-cq-chats-note';
        note.textContent = 'Loading chats…';
        root.append(note);
    } else if (state.error) {
        const note = document.createElement('div');
        note.className = 'st-cq-chats-note';
        note.textContent = state.error;

        const retry = document.createElement('div');
        retry.className = 'menu_button st-cq-chats-retry';
        retry.tabIndex = 0;
        retry.setAttribute('role', 'button');
        retry.textContent = 'Retry';
        retry.addEventListener('click', (event) => {
            event.preventDefault();
            void loadChats(preview);
        });

        root.append(note, retry);
    } else if (state.items.length === 0) {
        const note = document.createElement('div');
        note.className = 'st-cq-chats-note';
        note.textContent = 'This character has no chats yet.';
        root.append(note);
    } else {
        const list = document.createElement('div');
        list.className = 'st-cq-chats-list';
        for (const chat of state.items) {
            list.append(createChatRow(preview, chat));
        }
        root.append(list);
    }

    preview.body.replaceChildren(root);
}

/**
 * Creates one clickable chat row: persona avatar on the left, chat details on
 * the right.
 * @param {object} preview
 * @param {{ file_name: string, file_size?: string, chat_items?: number, last_mes?: string|number, mes?: string, chat_metadata?: object }} chat
 * @returns {HTMLElement}
 */
function createChatRow(preview, chat) {
    const character = resolvePreviewCharacter(preview);
    const rawFileName = String(chat.file_name ?? '');
    const fileName = rawFileName.endsWith(CHAT_FILE_EXTENSION)
        ? rawFileName
        : `${rawFileName}${CHAT_FILE_EXTENSION}`;
    const displayName = rawFileName.replace(/\.jsonl$/, '');
    const isActive = character.chat === fileName;

    const row = document.createElement('div');
    row.className = 'st-cq-chat-row';
    if (isActive) {
        row.classList.add('st-cq-chat-active');
    }
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open chat: ${displayName}`);

    row.append(createPersonaAvatar(preview, chat));

    const main = document.createElement('div');
    main.className = 'st-cq-chat-main';

    const top = document.createElement('div');
    top.className = 'st-cq-chat-top';

    const name = document.createElement('span');
    name.className = 'st-cq-chat-name';
    name.textContent = displayName;
    top.append(name);

    const date = document.createElement('small');
    date.className = 'st-cq-chat-date';
    date.textContent = formatChatDate(chat.last_mes);
    top.append(date);

    main.append(top);

    const details = [];
    if (typeof chat.chat_items === 'number' && chat.chat_items > 0) {
        details.push(chat.chat_items === 1 ? '1 message' : `${chat.chat_items} messages`);
    }
    if (chat.file_size) {
        details.push(chat.file_size);
    }
    if (isActive) {
        details.push('open');
    }

    if (details.length > 0) {
        const meta = document.createElement('div');
        meta.className = 'st-cq-chat-meta';
        meta.textContent = details.join(' · ');
        main.append(meta);
    }

    const previewText = getPreviewText(chat.mes);
    if (previewText) {
        const previewLine = document.createElement('div');
        previewLine.className = 'st-cq-chat-preview';
        previewLine.textContent = previewText;
        main.append(previewLine);
    }

    row.append(main);

    const open = () => {
        void openChat(preview, fileName);
    };
    row.addEventListener('click', (event) => {
        event.preventDefault();
        open();
    });
    row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            open();
        }
    });

    return row;
}

/**
 * Builds the persona avatar shown at the left of a chat row.
 * Locked persona first, then the default persona, then the current one.
 * @param {object} preview
 * @param {{ chat_metadata?: { persona?: string } }} chat
 * @returns {HTMLElement}
 */
function createPersonaAvatar(preview, chat) {
    const context = preview.context;
    const powerUser = context.powerUserSettings ?? {};
    const storedAvatar = typeof chat.chat_metadata?.persona === 'string' ? chat.chat_metadata.persona : '';

    let avatar = '';
    let source = 'none';
    if (storedAvatar) {
        avatar = storedAvatar;
        source = 'locked';
    } else if (powerUser.default_persona) {
        avatar = powerUser.default_persona;
        source = 'default';
    } else if (user_avatar) {
        avatar = user_avatar;
        source = 'current';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'st-cq-chat-persona';

    const name = avatar ? String(powerUser.personas?.[avatar] ?? '') : '';
    const label = name || avatar;

    if (avatar) {
        wrapper.classList.add('avatar');
        const image = document.createElement('img');
        image.src = context.getThumbnailUrl('persona', avatar);
        image.alt = label ? `Persona: ${label}` : 'Persona';
        image.addEventListener('error', () => {
            wrapper.replaceChildren(createPersonaPlaceholder());
        }, { once: true });
        wrapper.append(image);

        if (source !== 'locked') {
            wrapper.classList.add('st-cq-chat-persona-inferred');
        }
    } else {
        wrapper.classList.add('st-cq-chat-persona-missing');
        wrapper.append(createPersonaPlaceholder());
    }

    const suffix = source === 'locked'
        ? ''
        : source === 'default'
            ? ' (default persona)'
            : source === 'current'
                ? ' (current persona, not recorded in this chat)'
                : '';
    wrapper.title = label ? `Persona: ${label}${suffix}` : 'No persona recorded for this chat';

    return wrapper;
}

/**
 * Placeholder icon for chats whose persona cannot be resolved.
 * @returns {HTMLElement}
 */
function createPersonaPlaceholder() {
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-user';
    return icon;
}

/**
 * Turns the raw last message text into a short one-paragraph preview.
 * @param {string|undefined} message
 * @returns {string}
 */
function getPreviewText(message) {
    if (typeof message !== 'string') {
        return '';
    }

    const text = message.replace(/\s+/g, ' ').trim();
    if (!text || text === '[The message is empty]' || text === '[The chat is empty]') {
        return '';
    }

    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

/**
 * Closes the preview and opens the selected chat for the previewed character.
 * Mirrors what SillyTavern's welcome screen does for a recent chat.
 * @param {object} preview
 * @param {string} fileName Chat file name including the extension
 */
async function openChat(preview, fileName) {
    if (preview.openingChat) {
        return;
    }
    preview.openingChat = true;

    const context = preview.context;
    const character = resolvePreviewCharacter(preview);

    try {
        const closing = preview.popup?.complete?.(context.POPUP_RESULT.CANCELLED);
        if (closing) {
            await closing.catch(() => { });
        }

        const id = context.characters.findIndex((candidate) => candidate.avatar === character.avatar);
        if (id === -1) {
            console.error('[Character QOLs] Could not find the character for the selected chat.');
            return;
        }

        const isActiveCharacter = !context.groupId && String(context.characterId) === String(id);
        if (isActiveCharacter && context.chatId === fileName) {
            const sendTextarea = document.getElementById('send_textarea');
            if (sendTextarea instanceof HTMLElement) {
                sendTextarea.focus();
            }
            return;
        }

        if (!isActiveCharacter) {
            await context.selectCharacterById(id);
        }

        setActiveCharacter(character.avatar);
        setActiveGroup(null);
        context.saveSettingsDebounced();
        await openCharacterChat(fileName);
    } catch (error) {
        console.error('[Character QOLs] Failed to open the selected chat.', error);
        toastr.error('Could not open the selected chat. Check the console for details.');
    } finally {
        preview.openingChat = false;
    }
}

/**
 * Formats the last message timestamp of a chat for the list.
 * @param {string|number|Date|undefined} value
 * @returns {string}
 */
function formatChatDate(value) {
    const date = value instanceof Date ? value : new Date(value ?? '');
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {{ last_mes?: string|number }} chat
 * @returns {number}
 */
function chatTimestamp(chat) {
    const time = new Date(chat.last_mes ?? '').getTime();
    return Number.isNaN(time) ? 0 : time;
}

export { openChatsView, closeChatsView, refreshChatsView };
