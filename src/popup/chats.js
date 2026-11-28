/**
 * Chat list view of the preview popup: every chat stored for the previewed
 * character, with the most recently active one highlighted. Clicking a chat
 * closes the preview and opens that chat in SillyTavern.
 *
 * Part of the Character QOLs extension.
 */

import { resolvePreviewCharacter } from '../character.js';
import { openCharacterChat, setActiveCharacter, setActiveGroup } from '../st.js';

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
        const response = await fetch('/api/chats/search', {
            method: 'POST',
            headers: preview.context.getRequestHeaders(),
            body: JSON.stringify({ query: '', avatar_url: character.avatar }),
            cache: 'no-cache',
        });

        if (!response.ok) {
            throw new Error(`Chat list request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (preview.chats !== state || state.requestId !== requestId) {
            return;
        }

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
 * Creates one clickable chat row.
 * @param {object} preview
 * @param {{ file_name: string, file_size?: string, message_count?: number, last_mes?: string|number, preview_message?: string }} chat
 * @returns {HTMLElement}
 */
function createChatRow(preview, chat) {
    const character = resolvePreviewCharacter(preview);
    const fileName = chat.file_name.endsWith(CHAT_FILE_EXTENSION)
        ? chat.file_name
        : `${chat.file_name}${CHAT_FILE_EXTENSION}`;
    const isActive = character.chat === fileName;

    const row = document.createElement('div');
    row.className = 'st-cq-chat-row';
    if (isActive) {
        row.classList.add('st-cq-chat-active');
        row.title = 'Currently open';
    }
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open chat: ${chat.file_name}`);

    const top = document.createElement('div');
    top.className = 'st-cq-chat-top';

    const name = document.createElement('span');
    name.className = 'st-cq-chat-name';
    name.textContent = chat.file_name;
    top.append(name);

    const date = document.createElement('small');
    date.className = 'st-cq-chat-date';
    date.textContent = formatChatDate(chat.last_mes);
    top.append(date);

    row.append(top);

    const details = [];
    if (typeof chat.message_count === 'number' && chat.message_count > 0) {
        details.push(chat.message_count === 1 ? '1 message' : `${chat.message_count} messages`);
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
        row.append(meta);
    }

    const previewText = typeof chat.preview_message === 'string' ? chat.preview_message.trim() : '';
    const hasPreview = previewText && previewText !== '[The message is empty]';
    if (hasPreview) {
        const previewLine = document.createElement('div');
        previewLine.className = 'st-cq-chat-preview';
        previewLine.textContent = previewText;
        row.append(previewLine);
    }

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
