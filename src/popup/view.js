/**
 * Read-only view of the preview popup: header, sidebar, tags and sections.
 *
 * Part of the Character QOLs extension.
 */

import { createNavButton, createSection } from '../sections.js';
import { renderInto } from '../media.js';
import { settings } from '../settings.js';
import { previewState } from '../state.js';
import { FALLBACK_AVATAR, formatDepthMeta, getCharacterData, resolvePreviewCharacter } from '../character.js';
import { enterEditMode, requestExitEditMode } from './editor.js';
import { closeChatsView, openChatsView } from './chats.js';
import {
    duplicatePreviewed,
    getLinkedWorld,
    getMediaState,
    isFavorite,
    isPreviewMediaAllowed,
    openMediaPreferenceDialog,
    openWorldForPreview,
    toggleFavorite,
} from './actions.js';

/**
 * Builds the popup skeleton: sidebar (avatar + actions) and main column
 * (header + scrollable sections).
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 */
function createPreviewContent(character, context) {
    const root = document.createElement('div');
    root.className = 'st-cq';

    const sidebar = createSidebar(character, context);

    const main = document.createElement('div');
    main.className = 'st-cq-main';
    main.append(createHeader(character, context));

    const body = document.createElement('div');
    body.className = 'st-cq-body';
    main.append(body);

    root.append(sidebar.element, main);

    return { root, body, sidebar, character, context };
}

/**
 * Builds the left column: the character's avatar and the action buttons mirrored
 * from the character editor's toolbar.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 */
function createSidebar(character, context) {
    const element = document.createElement('aside');
    element.className = 'st-cq-side';

    const avatar = document.createElement('div');
    avatar.className = 'st-cq-avatar avatar';
    const image = document.createElement('img');
    const data = getCharacterData(character);
    image.src = character.avatar && character.avatar !== 'none'
        ? context.getThumbnailUrl('avatar', character.avatar)
        : FALLBACK_AVATAR;
    image.alt = data.name;
    image.addEventListener('error', () => {
        image.src = FALLBACK_AVATAR;
    }, { once: true });
    avatar.append(image);

    const actions = document.createElement('div');
    actions.className = 'st-cq-actions';

    const chats = createActionButton('fa-comments', 'Chats', () => {
        const preview = previewState.active;
        if (preview?.chats) {
            closeChatsView(preview);
        } else {
            openChatsView(preview);
        }
    }, { className: 'st-cq-action-chats' });
    const edit = createActionButton('fa-pen', 'Edit', () => {
        const preview = previewState.active;
        if (preview?.edit) {
            void requestExitEditMode(preview);
        } else {
            enterEditMode(preview);
        }
    }, { className: 'st-cq-action-edit' });

    const favorite = createActionButton('fa-star', 'Favorite', () => toggleFavorite());
    const media = createActionButton('fa-link', 'Ext. Media', () => openMediaPreferenceDialog());
    const world = getLinkedWorld(character)
        ? createActionButton('fa-globe', 'World Info', () => openWorldForPreview())
        : null;
    const duplicate = createActionButton('fa-clone', 'Duplicate', () => duplicatePreviewed());

    actions.append(chats, edit, createActionDivider(), favorite, duplicate, createActionDivider());
    if (world) {
        actions.append(world);
    }
    actions.append(media);

    element.append(avatar, actions);

    return { element, chats, edit, favorite, media, world, duplicate };
}

/**
 * Creates a horizontal divider between groups of sidebar actions.
 * @returns {HTMLElement}
 */
function createActionDivider() {
    const divider = document.createElement('div');
    divider.className = 'st-cq-actions-divider';
    divider.setAttribute('role', 'separator');
    return divider;
}

/**
 * Creates one native-looking sidebar button: an icon with a label, spanning the
 * full width of the column.
 * @param {string} icon Font Awesome icon without the `fa-solid` prefix
 * @param {string} label
 * @param {() => void} onClick
 * @param {{ className?: string }} [options]
 * @returns {HTMLElement}
 */
function createActionButton(icon, label, onClick, { className = '' } = {}) {
    const button = document.createElement('div');
    button.className = `menu_button st-cq-action ${className}`.trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('role', 'button');
    button.tabIndex = 0;

    const iconElement = document.createElement('i');
    iconElement.className = `fa-solid ${icon}`;
    const text = document.createElement('span');
    text.className = 'st-cq-action-label';
    text.textContent = label;
    button.append(iconElement, text);

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
 * Builds the character header of the main column: name, version, tags and author.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 * @returns {HTMLElement}
 */
function createHeader(character, context) {
    const data = getCharacterData(character);

    const header = document.createElement('header');
    header.className = 'st-cq-head';

    const nameBlock = document.createElement('div');
    nameBlock.className = 'character_name_block';
    const name = document.createElement('span');
    name.className = 'ch_name';
    name.textContent = data.name || 'Unnamed character';
    nameBlock.append(name);

    if (data.version) {
        const version = document.createElement('small');
        version.className = 'ch_additional_info character_version';
        version.textContent = data.version;
        version.title = `Character version: ${data.version}`;
        nameBlock.append(version);
    }
    header.append(nameBlock);

    const tags = createTagList(character, context);
    if (tags) {
        header.append(tags);
    }

    if (data.creator) {
        const meta = document.createElement('div');
        meta.className = 'st-cq-meta';
        meta.textContent = `Created by ${data.creator}`;
        header.append(meta);
    }

    return header;
}

/**
 * Builds the character's tag list with SillyTavern's own tag markup and colors.
 * Tags hidden from the character card are still shown here, since this is the
 * detail view.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 * @returns {HTMLElement|null}
 */
function createTagList(character, context) {
    const tagIds = context.tagMap?.[character.avatar];
    if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return null;
    }

    const list = document.createElement('div');
    list.className = 'tags st-cq-tags';

    for (const tagId of tagIds) {
        const tag = context.tags?.find((candidate) => candidate.id === tagId);
        if (!tag) {
            continue;
        }

        const element = document.createElement('span');
        element.className = 'tag';
        if (tag.color) {
            element.style.backgroundColor = tag.color;
        }
        if (tag.color2) {
            element.style.color = tag.color2;
        }
        if (tag.title) {
            element.title = tag.title;
        }

        const tagName = document.createElement('span');
        tagName.className = 'tag_name';
        tagName.textContent = tag.name;
        element.append(tagName);

        list.append(element);
    }

    return list.childElementCount > 0 ? list : null;
}

/**
 * Fills the scrollable body with the collapsible character sections.
 * Can be called again to refresh the content in place (e.g. after changing the
 * external media preference).
 * @param {{ body: HTMLElement, character: object, context: ReturnType<typeof getContext> }} preview
 */
function renderSections(preview) {
    const { body, character, context } = preview;
    const data = getCharacterData(character);
    const mediaAllowed = isPreviewMediaAllowed(character, context);

    body.replaceChildren();

    const greetings = [data.firstMessage, ...data.alternateGreetings]
        .filter((greeting) => typeof greeting === 'string' && greeting.trim());

    let sectionCount = 0;
    sectionCount += addTextSection(body, 'Creator\'s Notes', data.creatorNotes, { mediaAllowed });
    sectionCount += addTextSection(body, 'Description', data.description, { open: true, mediaAllowed });
    if (greetings.length > 0) {
        body.append(createGreetingsSection(greetings, { mediaAllowed }));
        sectionCount++;
    }
    sectionCount += addTextSection(body, 'Scenario', data.scenario, { mediaAllowed });
    sectionCount += addTextSection(body, 'Personality', data.personality, { mediaAllowed });
    sectionCount += addTextSection(body, 'Example dialogue', data.exampleDialogue, { mediaAllowed });
    sectionCount += addTextSection(body, 'Main Prompt', data.systemPrompt, { mediaAllowed });
    sectionCount += addTextSection(body, 'Post-History Instructions', data.postHistoryInstructions, { mediaAllowed });
    sectionCount += addTextSection(body, 'Character\'s Note', data.depthPrompt, {
        meta: formatDepthMeta(data.depthDepth, data.depthRole),
        mediaAllowed,
    });

    if (sectionCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'st-cq-empty';
        empty.textContent = 'This character has no description fields filled in.';
        body.append(empty);
    }
}

/**
 * Updates the sidebar buttons to match the current character state.
 * @param {object} preview
 */
function updateSidebar(preview) {
    const character = resolvePreviewCharacter(preview);
    const context = preview.context;
    const powerUser = context.powerUserSettings;
    const sidebar = preview.sidebar;

    const favorite = isFavorite(character);
    sidebar.favorite.classList.toggle('fav_on', favorite);
    sidebar.favorite.classList.toggle('fav_off', !favorite);
    setActionTitle(sidebar.favorite, favorite ? 'Remove from favorites' : 'Add to favorites');

    const mediaAllowed = isPreviewMediaAllowed(character, context);
    const mediaIcon = sidebar.media.querySelector('i');
    if (mediaIcon) {
        mediaIcon.classList.toggle('fa-link', mediaAllowed);
        mediaIcon.classList.toggle('fa-link-slash', !mediaAllowed);
    }

    if (settings.alwaysShowExternalMedia) {
        setActionTitle(sidebar.media, 'External media (previews always show it)');
    } else {
        const state = getMediaState(character.avatar, powerUser);
        if (state === 'allow') {
            setActionTitle(sidebar.media, 'External media: always allowed for this character');
        } else if (state === 'forbid') {
            setActionTitle(sidebar.media, 'External media: always forbidden for this character');
        } else {
            const globalState = powerUser.forbid_external_media ? 'forbidden' : 'allowed';
            setActionTitle(sidebar.media, `External media: follows the global setting (${globalState})`);
        }
    }

    if (sidebar.world) {
        const worldName = getLinkedWorld(character);
        sidebar.world.classList.toggle('world_set', Boolean(worldName));
        setActionTitle(sidebar.world, worldName ? `World Info: ${worldName}` : 'World Info');
    }

    const chatsOpen = Boolean(preview.chats);
    sidebar.chats.classList.toggle('st-cq-action-active', chatsOpen);
    sidebar.chats.setAttribute('aria-pressed', String(chatsOpen));
    setActionTitle(sidebar.chats, chatsOpen ? 'Back to character details' : 'Chats');

    const editing = Boolean(preview.edit);
    sidebar.edit.classList.toggle('st-cq-action-active', editing);
    sidebar.edit.setAttribute('aria-pressed', String(editing));
    sidebar.edit.querySelector('.st-cq-action-label').textContent = editing ? 'Editing' : 'Edit';
    setActionTitle(sidebar.edit, editing ? 'Stop editing' : 'Edit character');
}

/**
 * Sets the tooltip and the accessible name of an action button.
 * @param {HTMLElement} button
 * @param {string} title
 */
function setActionTitle(button, title) {
    button.title = title;
    button.setAttribute('aria-label', title);
}

/**
 * Adds a collapsible markdown section to the body if the text is not empty.
 * @param {HTMLElement} parent
 * @param {string} title
 * @param {string} text
 * @param {{ open?: boolean, meta?: string, mediaAllowed?: boolean }} [options]
 * @returns {number} 1 if the section was added, 0 otherwise
 */
function addTextSection(parent, title, text, { open = false, meta = '', mediaAllowed = true } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
        return 0;
    }

    const { drawer, content } = createSection(title, { open, meta });
    const markdown = document.createElement('div');
    markdown.className = 'st-cq-md';
    renderInto(markdown, text, mediaAllowed);
    content.append(markdown);
    parent.append(drawer);
    return 1;
}

/**
 * Builds the greetings section: first message plus alternate greetings with a
 * small pager, like the character editor's alternate greetings popup.
 * @param {string[]} greetings
 * @param {{ mediaAllowed?: boolean }} [options]
 * @returns {HTMLElement}
 */
function createGreetingsSection(greetings, { mediaAllowed = true } = {}) {
    const hasAlternates = greetings.length > 1;
    const { drawer, content } = createSection(
        hasAlternates ? 'Greetings' : 'First Message',
        { meta: hasAlternates ? `${greetings.length} greetings` : '' },
    );

    const wrapper = document.createElement('div');
    wrapper.className = 'st-cq-greetings';

    let index = 0;

    const markdown = document.createElement('div');
    markdown.className = 'st-cq-md';

    let label = null;

    /**
     * Renders the currently selected greeting.
     */
    function renderGreeting() {
        markdown.replaceChildren();
        renderInto(markdown, greetings[index], mediaAllowed);
        if (label) {
            label.textContent = `${index + 1} / ${greetings.length}`;
        }
    }

    wrapper.append(markdown);

    if (hasAlternates) {
        const nav = document.createElement('div');
        nav.className = 'st-cq-greeting-nav';

        const previous = createNavButton('fa-chevron-left', 'Previous greeting');
        label = document.createElement('span');
        label.className = 'st-cq-greeting-label';
        const next = createNavButton('fa-chevron-right', 'Next greeting');

        previous.addEventListener('click', () => {
            index = (index - 1 + greetings.length) % greetings.length;
            renderGreeting();
        });
        next.addEventListener('click', () => {
            index = (index + 1) % greetings.length;
            renderGreeting();
        });

        const pager = document.createElement('div');
        pager.className = 'st-cq-greeting-pager';
        pager.append(previous, label, next);
        nav.append(pager);
        wrapper.prepend(nav);
    }

    renderGreeting();
    content.append(wrapper);
    return drawer;
}

export { createPreviewContent, renderSections, updateSidebar };
