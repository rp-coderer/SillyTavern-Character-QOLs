/**
 * Rendering of the overhauled welcome screen chat list: mode switch, search,
 * date sections (recent mode) or character groups (character mode), pinned
 * chats and the chat rows themselves.
 *
 * Part of the Character QOLs extension.
 */

import { DATE_BUCKETS, formatChatDate, formatChatDateLong, getDateBucket } from '../chat-utils.js';
import { createPersonaAvatarElement } from '../persona.js';

/**
 * @typedef {object} WelcomeState
 * @property {ReturnType<import('../st.js').getContext>} context
 * @property {import('./model.js').WelcomeChat[]} items
 * @property {boolean} loading
 * @property {string|null} error
 * @property {'recent'|'characters'} mode
 * @property {string} search
 * @property {Map<string, number>} revealed
 * @property {Set<string>} openGroups
 * @property {boolean} groupsInitialized
 * @property {number} batch
 * @property {number} maxPerSection
 * @property {boolean} groupsCollapsed
 */

/**
 * @typedef {object} WelcomeHandlers
 * @property {(mode: 'recent'|'characters') => void} onModeChange
 * @property {(query: string) => void} onSearch
 * @property {(item: import('./model.js').WelcomeChat) => void} onOpen
 * @property {(item: import('./model.js').WelcomeChat) => void} onTogglePin
 * @property {(item: import('./model.js').WelcomeChat) => void} onRename
 * @property {(item: import('./model.js').WelcomeChat) => void} onDelete
 * @property {(groupKey: string) => void} onToggleGroup
 * @property {(sectionKey: string) => void} onShowMore
 * @property {() => void} onRefresh
 */

/**
 * Renders the whole list into `root`.
 * @param {HTMLElement} root
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 */
function renderWelcome(root, state, handlers) {
    root.replaceChildren();
    root.append(createHeader(state, handlers));

    const body = document.createElement('div');
    body.className = 'st-cq-welcome-body';

    if (state.loading) {
        body.append(createNote('Loading chats…'));
        root.append(body);
        return;
    }

    if (state.error) {
        const note = createNote(state.error);
        const retry = createButton('Retry', 'fa-rotate', () => handlers.onRefresh());
        retry.classList.add('st-cq-welcome-retry');
        note.append(retry);
        body.append(note);
        root.append(body);
        return;
    }

    if (state.items.length === 0) {
        body.append(createNote('No chats found.'));
        root.append(body);
        return;
    }

    const searching = state.search.trim().length > 0;
    const items = searching
        ? state.items.filter((item) => matchesSearch(item, state.search))
        : state.items;

    const pinned = items.filter((item) => item.pinned);
    if (pinned.length > 0) {
        body.append(createPinnedSection(pinned, state, handlers));
    }

    if (state.mode === 'characters') {
        renderCharacterSections(body, items, state, handlers, searching);
    } else {
        renderDateSections(body, items, state, handlers, searching);
    }

    if (body.childElementCount === 0) {
        body.append(createNote('No chats match your search.'));
    }

    root.append(body);
}

/**
 * Builds the strip with the mode switch, the search box and the reload button.
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @returns {HTMLElement}
 */
function createHeader(state, handlers) {
    const head = document.createElement('div');
    head.className = 'st-cq-welcome-head';

    const modes = document.createElement('div');
    modes.className = 'st-cq-welcome-modes';

    const recent = createModeButton('Recent', 'fa-clock-rotate-left', 'recent', state.mode, handlers);
    const characters = createModeButton('Characters', 'fa-users', 'characters', state.mode, handlers);
    modes.append(recent, characters);
    head.append(modes);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'st-cq-welcome-search-wrap';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'text_pole st-cq-welcome-search';
    search.placeholder = 'Search chats…';
    search.value = state.search;
    search.setAttribute('aria-label', 'Search chats');
    search.addEventListener('input', () => handlers.onSearch(search.value));
    searchWrap.append(search);
    head.append(searchWrap);

    const refresh = createButton('', 'fa-rotate', () => handlers.onRefresh());
    refresh.classList.add('st-cq-welcome-refresh');
    refresh.title = 'Reload chats';
    refresh.setAttribute('aria-label', 'Reload chats');
    head.append(refresh);

    return head;
}

/**
 * @param {string} label
 * @param {string} icon
 * @param {'recent'|'characters'} mode
 * @param {'recent'|'characters'} current
 * @param {WelcomeHandlers} handlers
 * @returns {HTMLElement}
 */
function createModeButton(label, icon, mode, current, handlers) {
    const button = createButton(label, icon, () => handlers.onModeChange(mode));
    button.classList.add('st-cq-welcome-mode');
    button.classList.toggle('st-cq-welcome-mode-active', mode === current);
    button.setAttribute('aria-pressed', String(mode === current));
    return button;
}

/**
 * Creates a native-looking icon+label button.
 * @param {string} label
 * @param {string} icon
 * @param {() => void} onClick
 * @returns {HTMLElement}
 */
function createButton(label, icon, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button menu_button_icon st-cq-welcome-button';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    if (label) {
        button.title = label;
        button.setAttribute('aria-label', label);
    }

    const iconElement = document.createElement('i');
    iconElement.className = `fa-solid ${icon}`;
    button.append(iconElement);

    if (label) {
        const text = document.createElement('span');
        text.className = 'st-cq-welcome-button-label';
        text.textContent = label;
        button.append(text);
    }

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onClick();
        }
    });

    return button;
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function createNote(text) {
    const note = document.createElement('div');
    note.className = 'st-cq-welcome-note';
    note.textContent = text;
    return note;
}

/**
 * Pinned chats are shown above both modes, newest first.
 * @param {import('./model.js').WelcomeChat[]} pinned
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @returns {HTMLElement}
 */
function createPinnedSection(pinned, state, handlers) {
    const section = document.createElement('div');
    section.className = 'st-cq-welcome-section st-cq-welcome-pinned';

    const title = document.createElement('div');
    title.className = 'st-cq-welcome-section-title';
    title.innerHTML = '<i class="fa-solid fa-thumbtack"></i> Pinned';
    section.append(title);

    const list = document.createElement('div');
    list.className = 'st-cq-welcome-list';
    for (const item of pinned) {
        list.append(createChatRow(item, state, handlers, { showName: true }));
    }
    section.append(list);

    return section;
}

/**
 * Date sections: Today / Yesterday / This week / This month / Long time ago.
 * @param {HTMLElement} body
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @param {boolean} searching
 */
function renderDateSections(body, items, state, handlers, searching) {
    const chats = items.filter((item) => !item.pinned);

    for (const bucket of DATE_BUCKETS) {
        const items = chats.filter((item) => getDateBucket(item.lastMes) === bucket.key);
        if (items.length === 0) {
            continue;
        }

        const key = `bucket:${bucket.key}`;
        const section = createSectionTitle(bucket.title, items.length);
        const list = document.createElement('div');
        list.className = 'st-cq-welcome-list';

        const visible = searching ? items.length : getVisibleCount(state, key, items.length);
        for (const item of items.slice(0, visible)) {
            list.append(createChatRow(item, state, handlers, { showName: true }));
        }
        section.append(list);
        body.append(section);

        if (!searching && visible < Math.min(items.length, state.maxPerSection)) {
            body.append(createShowMore(state, handlers, key, items.length - visible));
        }
    }
}

/**
 * Character sections: one collapsible group per character/group, ordered by the
 * newest chat in each group.
 * @param {HTMLElement} body
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @param {boolean} searching
 */
function renderCharacterSections(body, items, state, handlers, searching) {
    const chats = items.filter((item) => !item.pinned);
    /** @type {Map<string, { name: string, thumbnail: string, items: import('./model.js').WelcomeChat[] }>} */
    const groups = new Map();

    for (const item of chats) {
        const key = item.isGroup ? `group:${item.groupId}` : `char:${item.avatar}`;
        const group = groups.get(key) ?? { name: item.name, thumbnail: item.thumbnail, items: [] };
        group.items.push(item);
        groups.set(key, group);
    }

    if (!state.groupsInitialized) {
        state.groupsInitialized = true;
        if (!state.groupsCollapsed) {
            for (const key of groups.keys()) {
                state.openGroups.add(key);
            }
        }
    }

    const ordered = [...groups.entries()].sort((a, b) => {
        const aNewest = Math.max(...a[1].items.map((item) => new Date(item.lastMes).getTime() || 0));
        const bNewest = Math.max(...b[1].items.map((item) => new Date(item.lastMes).getTime() || 0));
        return bNewest - aNewest;
    });

    for (const [key, group] of ordered) {
        const isOpen = searching || state.openGroups.has(key);
        const section = document.createElement('div');
        section.className = 'st-cq-welcome-section st-cq-welcome-group';

        const header = document.createElement('div');
        header.className = 'st-cq-welcome-group-head';
        header.tabIndex = 0;
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', String(isOpen));
        header.setAttribute('aria-label', `${group.name}, ${group.items.length} chats`);

        const chevron = document.createElement('i');
        chevron.className = `fa-solid ${isOpen ? 'fa-chevron-down' : 'fa-chevron-right'} st-cq-welcome-chevron`;
        header.append(chevron);

        const avatar = document.createElement('div');
        avatar.className = 'avatar st-cq-welcome-group-avatar';
        if (group.thumbnail) {
            const image = document.createElement('img');
            image.src = group.thumbnail;
            image.alt = group.name;
            avatar.append(image);
        } else {
            avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
        }
        header.append(avatar);

        const name = document.createElement('span');
        name.className = 'st-cq-welcome-group-name';
        name.textContent = group.name;
        header.append(name);

        const count = document.createElement('small');
        count.className = 'st-cq-welcome-group-count';
        count.textContent = String(group.items.length);
        header.append(count);

        const toggle = () => handlers.onToggleGroup(key);
        header.addEventListener('click', (event) => {
            event.preventDefault();
            toggle();
        });
        header.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                toggle();
            }
        });

        section.append(header);
        body.append(section);

        if (!isOpen) {
            continue;
        }

        const list = document.createElement('div');
        list.className = 'st-cq-welcome-list';
        const visible = searching ? group.items.length : getVisibleCount(state, key, group.items.length);
        for (const item of group.items.slice(0, visible)) {
            list.append(createChatRow(item, state, handlers, { showName: false }));
        }
        section.append(list);

        if (!searching && visible < Math.min(group.items.length, state.maxPerSection)) {
            body.append(createShowMore(state, handlers, key, group.items.length - visible));
        }
    }
}

/**
 * Number of chats currently visible in a section.
 * @param {WelcomeState} state
 * @param {string} key
 * @param {number} total
 * @returns {number}
 */
function getVisibleCount(state, key, total) {
    const revealed = state.revealed.get(key) ?? state.batch;
    return Math.min(total, revealed, state.maxPerSection);
}

/**
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @param {string} key
 * @param {number} remaining
 * @returns {HTMLElement}
 */
function createShowMore(state, handlers, key, remaining) {
    const step = Math.min(state.batch, remaining);
    const button = createButton(`Show next ${step} ${step === 1 ? 'chat' : 'chats'}`, 'fa-chevron-down', () => handlers.onShowMore(key));
    button.classList.add('st-cq-welcome-show-more');
    return button;
}

/**
 * @param {string} title
 * @param {number} count
 * @returns {HTMLElement}
 */
function createSectionTitle(title, count) {
    const section = document.createElement('div');
    section.className = 'st-cq-welcome-section';

    const heading = document.createElement('div');
    heading.className = 'st-cq-welcome-section-title';

    const label = document.createElement('span');
    label.textContent = title;
    heading.append(label);

    const badge = document.createElement('small');
    badge.className = 'st-cq-welcome-section-count';
    badge.textContent = String(count);
    heading.append(badge);

    section.append(heading);
    return section;
}

/**
 * Builds one chat row: character + persona avatars, name/date, stats, preview
 * and the pin/rename/delete actions.
 * @param {import('./model.js').WelcomeChat} item
 * @param {WelcomeState} state
 * @param {WelcomeHandlers} handlers
 * @param {{ showName: boolean }} options
 * @returns {HTMLElement}
 */
function createChatRow(item, state, handlers, { showName }) {
    const row = document.createElement('div');
    row.className = 'st-cq-welcome-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Open chat: ${item.chatName}`);

    const avatars = document.createElement('div');
    avatars.className = 'st-cq-welcome-avatars';

    const characterAvatar = document.createElement('div');
    characterAvatar.className = 'avatar st-cq-welcome-char';
    characterAvatar.title = item.name;
    if (item.thumbnail) {
        const image = document.createElement('img');
        image.src = item.thumbnail;
        image.alt = item.name;
        characterAvatar.append(image);
    } else {
        characterAvatar.innerHTML = '<i class="fa-solid fa-user"></i>';
    }
    avatars.append(characterAvatar);

    avatars.append(createPersonaAvatarElement(state.context, item.persona, {
        className: 'st-cq-welcome-persona',
        inferredClassName: 'st-cq-welcome-persona-inferred',
        missingClassName: 'st-cq-welcome-persona-missing',
    }));

    const main = document.createElement('div');
    main.className = 'st-cq-welcome-main';

    const top = document.createElement('div');
    top.className = 'st-cq-welcome-top';

    if (item.pinned) {
        const pin = document.createElement('i');
        pin.className = 'fa-solid fa-thumbtack st-cq-welcome-pin-mark';
        pin.title = 'Pinned chat';
        top.append(pin);
    }

    const name = document.createElement('span');
    name.className = 'st-cq-welcome-name';
    if (showName) {
        name.textContent = `${item.name} — ${item.chatName}`;
    } else {
        name.textContent = item.chatName;
    }
    top.append(name);

    const date = document.createElement('small');
    date.className = 'st-cq-welcome-date';
    date.textContent = formatChatDate(item.lastMes);
    date.title = formatChatDateLong(item.lastMes);
    top.append(date);

    main.append(top);

    const details = [];
    if (item.messageCount > 0) {
        details.push(item.messageCount === 1 ? '1 message' : `${item.messageCount} messages`);
    }
    if (item.fileSize) {
        details.push(item.fileSize);
    }
    if (details.length > 0) {
        const meta = document.createElement('div');
        meta.className = 'st-cq-welcome-meta';
        meta.textContent = details.join(' · ');
        main.append(meta);
    }

    if (item.preview) {
        const preview = document.createElement('div');
        preview.className = 'st-cq-welcome-preview';
        preview.textContent = item.preview;
        main.append(preview);
    }

    row.append(avatars, main);

    const actions = document.createElement('div');
    actions.className = 'st-cq-welcome-actions';
    actions.append(
        createAction('fa-thumbtack', item.pinned ? 'Unpin chat' : 'Pin chat', () => handlers.onTogglePin(item), item.pinned ? 'st-cq-welcome-action-active' : ''),
        createAction('fa-pen-to-square', 'Rename chat', () => handlers.onRename(item)),
        createAction('fa-trash', 'Delete chat', () => handlers.onDelete(item)),
    );
    row.append(actions);

    const open = () => handlers.onOpen(item);
    row.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.st-cq-welcome-actions')) {
            return;
        }
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
 * Small icon button for a chat row action.
 * @param {string} icon
 * @param {string} title
 * @param {() => void} onClick
 * @param {string} [activeClass='']
 * @returns {HTMLElement}
 */
function createAction(icon, title, onClick, activeClass = '') {
    const button = document.createElement('div');
    button.className = `st-cq-welcome-action fa-solid ${icon}`;
    button.title = title;
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    if (activeClass) {
        button.classList.add(activeClass);
    }

    const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    };
    button.addEventListener('click', activate);
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            activate(event);
        }
    });

    return button;
}

/**
 * Case-insensitive word match over chat name, character name, preview and
 * persona name.
 * @param {import('./model.js').WelcomeChat} item
 * @param {string} query
 * @returns {boolean}
 */
function matchesSearch(item, query) {
    const fragments = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (fragments.length === 0) {
        return true;
    }
    const haystack = `${item.name} ${item.chatName} ${item.preview} ${item.persona.name}`.toLowerCase();
    return fragments.every((fragment) => haystack.includes(fragment));
}

export { renderWelcome };
