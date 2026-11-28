/**
 * Mounts the overhauled welcome screen chat list.
 *
 * SillyTavern renders the welcome panel as raw DOM inside `#chat` (not as a
 * chat message), so the list is replaced after each render and kept in sync
 * with a MutationObserver. Turning the override off removes it and asks
 * SillyTavern to render its own list again.
 *
 * Part of the Character QOLs extension.
 */

import { settings } from '../settings.js';
import { openWelcomeScreen } from '../st.js';
import { deleteChat, invalidateChats, loadChats, openChat, readListSettings, renameChat, setPinned } from './model.js';
import { renderWelcome } from './view.js';

const MODE_STORAGE_KEY = 'CharacterQOLs_WelcomeMode';
const SEARCH_DEBOUNCE_MS = 250;

/** @type {MutationObserver|null} */
let observer = null;
/** @type {ReturnType<import('../st.js').getContext>|null} */
let currentContext = null;
/** @type {HTMLElement|null} */
let currentContainer = null;
/** @type {import('./view.js').WelcomeState|null} */
let state = null;
let mountScheduled = false;
let searchTimer = 0;

/**
 * Starts watching for the welcome panel.
 * @param {ReturnType<import('../st.js').getContext>} context
 */
function setupWelcomeOverhaul(context) {
    currentContext = context;
    if (observer) {
        return;
    }

    const chat = document.getElementById('chat');
    if (!chat) {
        return;
    }

    observer = new MutationObserver(scheduleMount);
    observer.observe(chat, { childList: true, subtree: true });
    scheduleMount();
}

/**
 * Stops watching for the welcome panel.
 */
function teardownWelcomeOverhaul() {
    observer?.disconnect();
    observer = null;
    currentContainer = null;
    state = null;
    clearTimeout(searchTimer);
    searchTimer = 0;
}

/**
 * Coalesces bursts of DOM mutations into one check per frame.
 */
function scheduleMount() {
    if (mountScheduled) {
        return;
    }
    mountScheduled = true;
    requestAnimationFrame(() => {
        mountScheduled = false;
        tryMount();
    });
}

/**
 * Mounts the list when the welcome panel exists and is not ours yet.
 */
function tryMount() {
    if (!observer || !currentContext) {
        return;
    }

    const list = document.querySelector('#chat .welcomePanel .welcomeRecent .recentChatList');
    if (!list) {
        currentContainer = null;
        state = null;
        return;
    }

    if (list.dataset.stCqWelcome === 'true' && list.querySelector(':scope > .st-cq-welcome')) {
        return;
    }

    mount(list);
}

/**
 * @param {HTMLElement} list
 */
function mount(list) {
    const context = currentContext;
    if (!context) {
        return;
    }

    list.dataset.stCqWelcome = 'true';
    const container = document.createElement('div');
    container.className = 'st-cq-welcome';
    list.replaceChildren(container);
    currentContainer = container;

    const listSettings = readListSettings(context);
    state = {
        context,
        items: [],
        loading: true,
        error: null,
        mode: readMode(context),
        search: '',
        revealed: new Map(),
        openGroups: new Set(),
        groupsInitialized: false,
        batch: listSettings.collapsedDisplayed,
        maxPerSection: listSettings.maxDisplayed,
        groupsCollapsed: settings.welcomeGroupsCollapsed,
    };

    draw();
    void reload(false);
}

/**
 * @param {ReturnType<import('../st.js').getContext>} context
 * @returns {'recent'|'characters'}
 */
function readMode(context) {
    const stored = context.accountStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'characters' ? 'characters' : 'recent';
}

/**
 * Re-renders the current list.
 */
function draw() {
    if (!state || !currentContainer) {
        return;
    }

    renderWelcome(currentContainer, state, handlers);
}

/**
 * Fetches the chats and repaints.
 * @param {boolean} force
 */
async function reload(force) {
    if (!state) {
        return;
    }

    state.loading = state.items.length === 0;
    state.error = null;
    draw();

    try {
        if (force) {
            invalidateChats();
        }
        state.items = await loadChats(state.context, { force });
        if (!state) {
            return;
        }
        state.loading = false;
        state.error = null;
        state.groupsInitialized = false;
    } catch (error) {
        console.error('[Character QOLs] Failed to load the welcome chat list.', error);
        if (!state) {
            return;
        }
        state.loading = false;
        state.error = 'Could not load the chats.';
    }

    draw();
}

/**
 * @param {import('./view.js').WelcomeState} current
 * @param {import('./model.js').WelcomeChat[]} items
 */
function removeItem(current, items) {
    const index = current.items.indexOf(items);
    if (index !== -1) {
        current.items.splice(index, 1);
    }
}

/** @type {import('./view.js').WelcomeHandlers} */
const handlers = {
    onModeChange(mode) {
        if (!state || state.mode === mode) {
            return;
        }
        state.mode = mode;
        state.groupsInitialized = false;
        state.revealed.clear();
        state.context.accountStorage.setItem(MODE_STORAGE_KEY, mode);
        draw();
    },

    onSearch(query) {
        if (!state) {
            return;
        }
        state.search = query;
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            if (!state) {
                return;
            }
            state.revealed.clear();
            draw();
            const input = currentContainer?.querySelector('.st-cq-welcome-search');
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            }
        }, SEARCH_DEBOUNCE_MS);
    },

    async onOpen(item) {
        if (!state || state.opening) {
            return;
        }
        state.opening = true;
        try {
            await openChat(state.context, item);
        } catch (error) {
            console.error('[Character QOLs] Failed to open the chat.', error);
            toastr.error('Could not open the chat. Check the console for details.');
        } finally {
            if (state) {
                state.opening = false;
            }
        }
    },

    onTogglePin(item) {
        if (!state) {
            return;
        }
        setPinned(state.context, item, !item.pinned);
        draw();
    },

    async onRename(item) {
        if (!state) {
            return;
        }
        const context = state.context;
        try {
            const value = await context.callGenericPopup('<h3>Rename chat</h3>', context.POPUP_TYPE.INPUT, item.chatName);
            if (typeof value !== 'string') {
                return;
            }
            const renamed = await renameChat(context, item, value);
            if (renamed) {
                draw();
            }
        } catch (error) {
            console.error('[Character QOLs] Failed to rename the chat.', error);
            toastr.error('Could not rename the chat. Check the console for details.');
        }
    },

    async onDelete(item) {
        if (!state) {
            return;
        }
        const context = state.context;
        try {
            const confirmed = await context.callGenericPopup('Delete this chat file?', context.POPUP_TYPE.CONFIRM);
            if (!confirmed) {
                return;
            }
            const deleted = await deleteChat(context, item);
            if (deleted) {
                removeItem(state, item);
                draw();
            }
        } catch (error) {
            console.error('[Character QOLs] Failed to delete the chat.', error);
            toastr.error('Could not delete the chat. Check the console for details.');
        }
    },

    onToggleGroup(groupKey) {
        if (!state) {
            return;
        }
        if (state.openGroups.has(groupKey)) {
            state.openGroups.delete(groupKey);
        } else {
            state.openGroups.add(groupKey);
        }
        draw();
    },

    onShowMore(sectionKey) {
        if (!state) {
            return;
        }
        const current = state.revealed.get(sectionKey) ?? state.batch;
        state.revealed.set(sectionKey, current + state.batch);
        draw();
    },

    onRefresh() {
        void reload(true);
    },
};

/**
 * Applies a settings change: starts or stops the overhaul and asks SillyTavern
 * to re-render the welcome panel so the change is visible immediately.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {boolean} enabled
 */
function applyWelcomeOverhaul(context, enabled) {
    const panelVisible = Boolean(document.querySelector('#chat .welcomePanel'));

    if (enabled) {
        setupWelcomeOverhaul(context);
    } else {
        teardownWelcomeOverhaul();
        document.querySelectorAll('#chat .st-cq-welcome').forEach((element) => element.remove());
    }

    if (panelVisible) {
        openWelcomeScreen({ force: true }).catch((error) => {
            console.error('[Character QOLs] Failed to refresh the welcome screen.', error);
        });
    }
}

/**
 * Re-renders the list after a settings change that affects it (e.g. groups
 * collapsed), without discarding the cached chats.
 */
function refreshWelcomeOverhaul() {
    if (!state) {
        return;
    }
    state.groupsCollapsed = settings.welcomeGroupsCollapsed;
    state.groupsInitialized = false;
    state.openGroups.clear();
    draw();
}

export { applyWelcomeOverhaul, refreshWelcomeOverhaul, setupWelcomeOverhaul, teardownWelcomeOverhaul };
