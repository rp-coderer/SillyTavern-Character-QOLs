/**
 * Character QOLs
 *
 * Clicking a character card in the character list opens a details popup instead
 * of immediately loading (or resuming) that character's chat.
 *
 * Everything the popup shows comes from the same data SillyTavern uses to render
 * the card, is rendered with SillyTavern's own markdown converter and sanitizer,
 * and is presented in SillyTavern's own popup dialog. No custom overlay, no CDN
 * dependency, no second copy of the character data.
 *
 * How the click is claimed
 * ------------------------
 * SillyTavern reacts to a card click through two delegated handlers on `document`:
 * `selectCharacterById()` (loads the chat) and the "remember the active character
 * for the next page load" handler. Both run in the bubble phase, so a single
 * capture-phase listener on `document` can claim the click first and stop the rest
 * of the propagation with `stopImmediatePropagation()`.
 *
 * Only plain primary-button clicks on a `.character_select` inside
 * `#rm_print_characters_block` are claimed. Interactive children (inputs, bulk
 * edit checkboxes, ...) and bulk selection mode are left to SillyTavern.
 *
 * Phase 2 (not implemented here) will reuse the native character editor inside
 * the same popup; this file only contains the read-only preview.
 */

import { getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { converter, setActiveCharacter, setActiveGroup } from '../../../../script.js';
import { decodeStyleTags, encodeStyleTags } from '../../../chats.js';

const MODULE_NAME = 'SillyTavern-Character-QOLs';
const EXTENSION_PATH = 'third-party/SillyTavern-Character-QOLs';

/** Shown when a character has no avatar file of its own. */
const FALLBACK_AVATAR = 'img/ai4.png';

/**
 * Controls inside a character card that keep their own click behavior.
 * The bulk edit checkboxes are inputs, so they are covered by this as well.
 */
const INTERACTIVE_SELECTOR = [
    'input',
    'textarea',
    'select',
    'button',
    'a',
    'label',
    '.menu_button',
    '.tag_remove',
    '.tags_view',
].join(', ');

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
});

/** @type {{ enabled: boolean }} */
let settings = { ...DEFAULT_SETTINGS };

let initialized = false;

/** True while a preview is being opened or shown, so clicks cannot stack popups. */
let openingPreview = false;

/**
 * The popup that is currently open, or null.
 * @type {any}
 */
let currentPopup = null;

/**
 * Small helper so debug output is easy to filter.
 * @param {...any} args
 */
function log(...args) {
    console.debug('[Character QOLs]', ...args);
}

/**
 * Initializes the extension once the app is ready.
 */
async function init() {
    if (initialized) {
        return;
    }
    initialized = true;

    const context = getContext();
    const stored = context.extensionSettings[MODULE_NAME] ??= {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (stored[key] === undefined) {
            stored[key] = value;
        }
    }
    settings = stored;

    await addSettingsPanel(context);

    // Capture phase: this runs before SillyTavern's delegated document handlers.
    document.addEventListener('click', onDocumentClick, true);

    log('ready');
}

/**
 * Adds the extension settings drawer.
 * @param {ReturnType<typeof getContext>} context
 */
async function addSettingsPanel(context) {
    const container = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings');
    if (!container) {
        console.warn('[Character QOLs] Extension settings container not found.');
        return;
    }

    try {
        const html = await renderExtensionTemplateAsync(EXTENSION_PATH, 'settings');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        container.append(wrapper);

        const checkbox = wrapper.querySelector('#st_cq_enabled');
        if (!(checkbox instanceof HTMLInputElement)) {
            return;
        }
        checkbox.checked = settings.enabled;
        checkbox.addEventListener('change', () => {
            settings.enabled = checkbox.checked;
            context.saveSettingsDebounced();

            if (!settings.enabled) {
                // Closing is the only thing left to do for a popup that is
                // already open; the click handler ignores new ones.
                currentPopup?.complete(context.POPUP_RESULT.CANCELLED)?.catch(() => { });
            }
        });
    } catch (error) {
        console.error('[Character QOLs] Failed to render the settings template.', error);
    }
}

/**
 * Claims character card clicks so that they open the preview instead of a chat.
 * @param {MouseEvent} event
 */
function onDocumentClick(event) {
    if (!settings.enabled) {
        return;
    }
    if (event.button !== 0) {
        return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
        return;
    }

    const card = target.closest('#rm_print_characters_block .character_select');
    if (!(card instanceof HTMLElement)) {
        return;
    }

    // Cards can contain real controls; those must keep working.
    if (target.closest(INTERACTIVE_SELECTOR)) {
        return;
    }

    // Bulk edit mode turns card clicks into selection toggles.
    if (card.closest('#rm_print_characters_block')?.classList.contains('bulk_select')) {
        return;
    }

    const id = Number(card.dataset.chid ?? card.getAttribute('data-chid'));
    if (!Number.isInteger(id) || id < 0) {
        return;
    }

    const context = getContext();
    if (!context.characters?.[id]) {
        return;
    }

    // Claim the click even if the preview cannot be shown right now (a popup is
    // already open, or a lazy-loaded character is still being fetched). Letting
    // it through would start the chat, which is exactly what we avoid.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (openingPreview || currentPopup) {
        return;
    }

    openPreview(id).catch((error) => {
        console.error('[Character QOLs] Failed to open the character preview.', error);
    });
}

/**
 * Loads a character and shows its preview popup.
 * @param {number} id Character index in the `characters` array
 */
async function openPreview(id) {
    if (openingPreview) {
        return;
    }
    openingPreview = true;

    try {
        const context = getContext();
        let character = context.characters[id];
        if (!character) {
            return;
        }

        // Lazy-loaded character lists only carry a stub until the card is opened.
        if (character.shallow) {
            await context.getOneCharacter(character.avatar);
            character = context.characters[id] ?? character;
        }

        let popup;
        try {
            popup = createPopup(character, context);
        } catch (error) {
            // Never leave the character list unusable: if the preview cannot be
            // built, fall back to the native behavior of opening the chat.
            console.error('[Character QOLs] Could not build the character preview, opening the chat instead.', error);
            await context.selectCharacterById(id, { switchMenu: false });
            return;
        }

        currentPopup = popup;
        log('opening preview:', id, character.name);

        const result = await popup.show();
        if (result === context.POPUP_RESULT.AFFIRMATIVE) {
            await startChat(id);
        }
    } finally {
        currentPopup = null;
        openingPreview = false;
    }
}

/**
 * Creates the preview popup, including its footer buttons.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 */
function createPopup(character, context) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = context;
    const content = createPreviewContent(character, context);

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        animation: 'fast',
        leftAlign: true,
        customButtons: [
            {
                text: 'Chat',
                icon: 'fa-comment',
                tooltip: 'Continue the most recent chat with this character',
                result: POPUP_RESULT.AFFIRMATIVE,
                classes: ['st-cq-chat-button'],
            },
            {
                text: 'Close',
                icon: 'fa-xmark',
                result: POPUP_RESULT.CANCELLED,
                appendAtEnd: true,
            },
        ],
    });

    popup.dlg.classList.add('st-cq-popup');
    popup.dlg.setAttribute('aria-label', `Character details: ${character.name ?? 'character'}`);

    return popup;
}

/**
 * Starts (or resumes) the chat with the previewed character, mirroring what a
 * native card click does.
 * @param {number} id Character index in the `characters` array
 */
async function startChat(id) {
    const context = getContext();

    const isActiveCharacter = !context.groupId && String(context.characterId) === String(id);
    if (isActiveCharacter) {
        // The chat is already open; the popup was just covering it.
        const sendTextarea = document.getElementById('send_textarea');
        if (sendTextarea instanceof HTMLElement) {
            sendTextarea.focus();
        }
        return;
    }

    // SillyTavern's own card click handler does this too: remember the character
    // that should be auto-loaded on the next page load.
    setActiveCharacter(id);
    setActiveGroup(null);
    context.saveSettingsDebounced();

    await context.selectCharacterById(id, { switchMenu: false });
}

/**
 * Normalizes the handful of character fields the preview needs.
 * Older cards store creator notes as `creatorcomment`.
 * @param {object} character
 */
function getCharacterData(character) {
    const data = character.data ?? {};
    const alternateGreetings = Array.isArray(data.alternate_greetings)
        ? data.alternate_greetings.filter((greeting) => typeof greeting === 'string' && greeting.trim())
        : [];

    return {
        name: character.name ?? '',
        description: character.description ?? '',
        personality: character.personality ?? '',
        scenario: character.scenario ?? '',
        firstMessage: character.first_mes ?? '',
        alternateGreetings,
        exampleDialogue: character.mes_example ?? '',
        creatorNotes: data.creator_notes ?? character.creatorcomment ?? '',
        creator: data.creator ?? '',
        version: data.character_version ?? '',
        systemPrompt: data.system_prompt ?? '',
        postHistoryInstructions: data.post_history_instructions ?? '',
        depthPrompt: data.extensions?.depth_prompt?.prompt ?? '',
        depthDepth: data.extensions?.depth_prompt?.depth,
        depthRole: data.extensions?.depth_prompt?.role ?? '',
    };
}

/**
 * Builds the popup content: a native-looking header plus collapsible sections.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getContext>} context
 * @returns {HTMLElement}
 */
function createPreviewContent(character, context) {
    const data = getCharacterData(character);

    const root = document.createElement('div');
    root.className = 'st-cq';

    root.append(createHeader(character, data, context));

    const body = document.createElement('div');
    body.className = 'st-cq-body';
    root.append(body);

    const greetings = [data.firstMessage, ...data.alternateGreetings]
        .filter((greeting) => typeof greeting === 'string' && greeting.trim());

    let sectionCount = 0;
    sectionCount += addTextSection(body, 'Description', data.description, { open: true });
    if (greetings.length > 0) {
        body.append(createGreetingsSection(greetings));
        sectionCount++;
    }
    sectionCount += addTextSection(body, 'Scenario', data.scenario);
    sectionCount += addTextSection(body, 'Personality', data.personality);
    sectionCount += addTextSection(body, 'Example dialogue', data.exampleDialogue);
    sectionCount += addTextSection(body, 'Main Prompt', data.systemPrompt);
    sectionCount += addTextSection(body, 'Post-History Instructions', data.postHistoryInstructions);
    sectionCount += addTextSection(body, 'Character\'s Note', data.depthPrompt, {
        meta: formatDepthMeta(data.depthDepth, data.depthRole),
    });
    sectionCount += addTextSection(body, 'Creator\'s Notes', data.creatorNotes);

    if (sectionCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'st-cq-empty';
        empty.textContent = 'This character has no description fields filled in.';
        body.append(empty);
    }

    return root;
}

/**
 * Builds the character header: avatar, name, version, tags and author.
 * @param {object} character Character object from the `characters` array
 * @param {ReturnType<typeof getCharacterData>} data
 * @param {ReturnType<typeof getContext>} context
 * @returns {HTMLElement}
 */
function createHeader(character, data, context) {
    const header = document.createElement('header');
    header.className = 'st-cq-head';

    const avatar = document.createElement('div');
    avatar.className = 'st-cq-avatar avatar';
    const image = document.createElement('img');
    image.src = character.avatar && character.avatar !== 'none'
        ? context.getThumbnailUrl('avatar', character.avatar)
        : FALLBACK_AVATAR;
    image.alt = data.name;
    image.addEventListener('error', () => {
        image.src = FALLBACK_AVATAR;
    }, { once: true });
    avatar.append(image);

    const info = document.createElement('div');
    info.className = 'st-cq-head-info';

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
    info.append(nameBlock);

    const tags = createTagList(character, context);
    if (tags) {
        info.append(tags);
    }

    if (data.creator) {
        const meta = document.createElement('div');
        meta.className = 'st-cq-meta';
        meta.textContent = `Created by ${data.creator}`;
        info.append(meta);
    }

    header.append(avatar, info);
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
 * Adds a collapsible markdown section to the body if the text is not empty.
 * @param {HTMLElement} parent
 * @param {string} title
 * @param {string} text
 * @param {{ open?: boolean, meta?: string }} [options]
 * @returns {number} 1 if the section was added, 0 otherwise
 */
function addTextSection(parent, title, text, { open = false, meta = '' } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
        return 0;
    }

    const { drawer, content } = createSection(title, { open, meta });
    const markdown = document.createElement('div');
    markdown.className = 'st-cq-md';
    renderInto(markdown, text);
    content.append(markdown);
    parent.append(drawer);
    return 1;
}

/**
 * Adds a collapsible section shell.
 * @param {string} title
 * @param {{ open?: boolean, meta?: string }} [options]
 * @returns {{ drawer: HTMLElement, content: HTMLElement }}
 */
function createSection(title, { open = false, meta = '' } = {}) {
    const drawer = document.createElement('div');
    drawer.className = 'inline-drawer st-cq-section';

    const header = document.createElement('div');
    header.className = 'inline-drawer-toggle inline-drawer-header';

    const label = document.createElement('b');
    label.textContent = title;
    header.append(label);

    const headerRight = document.createElement('div');
    headerRight.className = 'flex-container alignItemsBaseline';

    if (meta) {
        const metaElement = document.createElement('small');
        metaElement.className = 'st-cq-section-meta';
        metaElement.textContent = meta;
        headerRight.append(metaElement);
    }

    const icon = document.createElement('div');
    icon.className = 'inline-drawer-icon fa-solid '
        + (open ? 'fa-circle-chevron-up up' : 'fa-circle-chevron-down down');
    headerRight.append(icon);
    header.append(headerRight);

    const content = document.createElement('div');
    content.className = 'inline-drawer-content';
    // The native toggle handler slides the content, so the initial state is set here.
    content.style.display = open ? 'block' : 'none';

    drawer.append(header, content);
    return { drawer, content };
}

/**
 * Builds the greetings section: first message plus alternate greetings with a
 * small pager, like the character editor's alternate greetings popup.
 * @param {string[]} greetings
 * @returns {HTMLElement}
 */
function createGreetingsSection(greetings) {
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
        renderInto(markdown, greetings[index]);
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

        nav.append(previous, label, next);
        wrapper.prepend(nav);
    }

    renderGreeting();
    content.append(wrapper);
    return drawer;
}

/**
 * Creates a small icon button for the greeting pager.
 * @param {string} icon Font Awesome icon name without the `fa-solid` prefix
 * @param {string} title
 * @returns {HTMLElement}
 */
function createNavButton(icon, title) {
    const button = document.createElement('div');
    button.className = `menu_button st-cq-greeting-button fa-solid ${icon}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
}

/**
 * Formats the depth prompt metadata shown next to the character's note.
 * @param {number|string|undefined} depth
 * @param {string} role
 * @returns {string}
 */
function formatDepthMeta(depth, role) {
    const parts = [];
    if (depth !== undefined && depth !== null && depth !== '') {
        parts.push(`depth ${depth}`);
    }
    if (role) {
        parts.push(role);
    }
    return parts.join(' · ');
}

/**
 * Renders markdown with SillyTavern's converter and sanitizer, scoping any
 * custom styles inside the character data to this content block.
 * Falls back to plain text if anything goes wrong.
 * @param {HTMLElement} element
 * @param {string} text
 */
function renderInto(element, text) {
    const html = renderMarkdown(text);
    if (html) {
        element.innerHTML = html;
    } else {
        element.textContent = text;
    }
}

/**
 * Converts markdown to sanitized HTML with SillyTavern's own pipeline.
 * @param {string} text
 * @returns {string} Sanitized HTML, or an empty string if it could not be rendered
 */
function renderMarkdown(text) {
    if (typeof text !== 'string' || !text.trim() || !converter) {
        return '';
    }

    try {
        const html = converter.makeHtml(text);
        const purifier = window.DOMPurify;
        if (!purifier) {
            return '';
        }
        const sanitized = purifier.sanitize(encodeStyleTags(html), {
            RETURN_DOM: false,
            RETURN_DOM_FRAGMENT: false,
            RETURN_TRUSTED_TYPE: false,
            MESSAGE_SANITIZE: true,
            ADD_TAGS: ['custom-style'],
        });
        return decodeStyleTags(sanitized, { prefix: '.st-cq-md ' });
    } catch (error) {
        console.warn('[Character QOLs] Failed to render character text as markdown.', error);
        return '';
    }
}

const context = getContext();
context.eventSource.on(context.eventTypes.APP_READY, init);
