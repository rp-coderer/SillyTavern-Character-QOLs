/**
 * Character QOLs
 *
 * Clicking a character card in the character list opens a details popup instead
 * of immediately loading (or resuming) that character's chat.
 *
 * Everything the popup shows comes from the same data SillyTavern uses to render
 * the card, is rendered with SillyTavern's own markdown converter and sanitizer,
 * and is presented in SillyTavern's own popup dialog. The sidebar buttons use
 * SillyTavern's own APIs and dialogs, so favorites, external media preferences
 * and lorebook links stay in sync with the rest of the UI.
 *
 * How the click is claimed
 * ------------------------
 * SillyTavern reacts to a card click through two delegated handlers on `document`:
 * `selectCharacterById()` (loads the chat) and the "remember the active character
 * for the next page load" handler. Both run in the bubble phase, so a single
 * capture-phase listener on `document` can claim the click first and stop the rest
 * of the propagation with `stopImmediatePropagation()`.
 *
 * Clicking the card of the character whose chat is already open is left alone, so
 * SillyTavern keeps its native behavior (opening the character editor panel).
 *
 * Only plain primary-button clicks on a `.character_select` inside
 * `#rm_print_characters_block` are claimed. Interactive children (inputs, bulk
 * edit checkboxes, ...) and bulk selection mode are left to SillyTavern.
 *
 * Phase 2 (not implemented here) will reuse the native character editor inside
 * the same popup; this file only contains the read-only preview.
 */

import { getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { converter, duplicateCharacter, setActiveCharacter, setActiveGroup } from '../../../../script.js';
import { decodeStyleTags, encodeStyleTags } from '../../../chats.js';
import { favsToHotswap } from '../../../RossAscends-mods.js';
import { openWorldInfoEditor, world_names } from '../../../world-info.js';

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

/**
 * Media elements whose source attributes have to be protected while the preview
 * HTML is sanitized. SillyTavern's sanitizer blocks external media based on the
 * entity of the *current chat*, which is not necessarily the previewed character.
 * The attributes are moved to `data-*` attributes for the sanitize call and
 * restored afterwards, where the previewed character's own setting is applied.
 */
const MEDIA_SELECTOR = 'img, audio, video, source, track, embed, object';
const MEDIA_ATTRIBUTES = ['src', 'srcset', 'poster', 'data'];
const MEDIA_ATTRIBUTE_PREFIX = 'data-st-cq-media-';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    alwaysShowExternalMedia: false,
});

/** @type {{ enabled: boolean, alwaysShowExternalMedia: boolean }} */
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
 * The view of the preview that is currently open, or null.
 * @type {{
 *   root: HTMLElement,
 *   body: HTMLElement,
 *   sidebar: { element: HTMLElement, favorite: HTMLElement, media: HTMLElement, world: HTMLElement|null, duplicate: HTMLElement },
 *   character: object,
 *   context: ReturnType<typeof getContext>,
 *   popup: any,
 * }|null}
 */
let activePreview = null;

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

        const enabled = wrapper.querySelector('#st_cq_enabled');
        if (enabled instanceof HTMLInputElement) {
            enabled.checked = settings.enabled;
            enabled.addEventListener('change', () => {
                settings.enabled = enabled.checked;
                context.saveSettingsDebounced();

                if (!settings.enabled) {
                    // Closing is the only thing left to do for a popup that is
                    // already open; the click handler ignores new ones.
                    currentPopup?.complete(context.POPUP_RESULT.CANCELLED)?.catch(() => { });
                }
            });
        }

        const media = wrapper.querySelector('#st_cq_always_show_media');
        if (media instanceof HTMLInputElement) {
            media.checked = settings.alwaysShowExternalMedia;
            media.addEventListener('change', () => {
                settings.alwaysShowExternalMedia = media.checked;
                context.saveSettingsDebounced();

                if (activePreview) {
                    renderSections(activePreview);
                    updateSidebar(activePreview);
                }
            });
        }
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

    // The current chat already uses this character: leave the native behavior
    // alone, which opens the character editor panel instead of reloading the chat.
    if (!context.groupId && String(context.characterId) === String(id)) {
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
        activePreview = null;
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
    const preview = createPreviewContent(character, context);
    renderSections(preview);

    const popup = new Popup(preview.root, POPUP_TYPE.TEXT, '', {
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

    preview.popup = popup;
    activePreview = preview;
    updateSidebar(preview);

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
 * Finds the up-to-date character object for the open preview. The `characters`
 * array can be replaced while the popup is open (e.g. after duplicating).
 * @param {NonNullable<typeof activePreview>} preview
 * @returns {object}
 */
function resolvePreviewCharacter(preview) {
    return preview.context.characters.find((candidate) => candidate.avatar === preview.character.avatar)
        ?? preview.character;
}

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

    const favorite = createActionButton('fa-star', 'Favorite', () => toggleFavorite());
    const media = createActionButton('fa-link', 'External media', () => openMediaPreferenceDialog());
    const world = getLinkedWorld(character)
        ? createActionButton('fa-globe', 'World Info', () => openWorldForPreview())
        : null;
    const duplicate = createActionButton('fa-clone', 'Duplicate character', () => duplicatePreviewed());

    actions.append(favorite, media, ...(world ? [world] : []), duplicate);
    element.append(avatar, actions);

    return { element, favorite, media, world, duplicate };
}

/**
 * Creates one native-looking icon button for the sidebar.
 * @param {string} icon Font Awesome icon without the `fa-solid` prefix
 * @param {string} title
 * @param {() => void} onClick
 * @returns {HTMLElement}
 */
function createActionButton(icon, title, onClick) {
    const button = document.createElement('div');
    button.className = `menu_button st-cq-action fa-solid ${icon}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
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
 * @param {NonNullable<typeof activePreview>} preview
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
    sidebar.media.classList.toggle('fa-link', mediaAllowed);
    sidebar.media.classList.toggle('fa-link-slash', !mediaAllowed);

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
 * Returns the linked lorebook name if it is loaded in the World Info list.
 * @param {object} character
 * @returns {string}
 */
function getLinkedWorld(character) {
    const worldName = character?.data?.extensions?.world;
    if (!worldName || !Array.isArray(world_names) || !world_names.includes(worldName)) {
        return '';
    }
    return worldName;
}

/**
 * @param {object} character
 * @returns {boolean}
 */
function isFavorite(character) {
    return character?.fav === true || character?.fav === 'true';
}

/**
 * @param {string} avatar
 * @param {ReturnType<typeof getContext>['powerUserSettings']} powerUser
 * @returns {'global'|'allow'|'forbid'}
 */
function getMediaState(avatar, powerUser) {
    if (powerUser?.external_media_allowed_overrides?.includes(avatar)) {
        return 'allow';
    }
    if (powerUser?.external_media_forbidden_overrides?.includes(avatar)) {
        return 'forbid';
    }
    return 'global';
}

/**
 * Checks whether external media is allowed for this character, mirroring the
 * per-entity override SillyTavern stores for chats. The "always show" setting
 * overrides it for previews only.
 * @param {object} character
 * @param {ReturnType<typeof getContext>} context
 * @returns {boolean}
 */
function isPreviewMediaAllowed(character, context) {
    if (settings.alwaysShowExternalMedia) {
        return true;
    }
    const avatar = character?.avatar;
    const powerUser = context.powerUserSettings;
    if (!avatar) {
        return !powerUser?.forbid_external_media;
    }
    const state = getMediaState(avatar, powerUser);
    if (state === 'allow') {
        return true;
    }
    if (state === 'forbid') {
        return false;
    }
    return !powerUser?.forbid_external_media;
}

/**
 * Toggles the previewed character's favorite state through SillyTavern's own
 * character merge endpoint (the same one the bulk-edit context menu uses).
 */
async function toggleFavorite() {
    const preview = activePreview;
    if (!preview) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const newFavorite = !isFavorite(character);

    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: preview.context.getRequestHeaders(),
            body: JSON.stringify({
                name: character.name,
                avatar: character.avatar,
                data: { extensions: { fav: newFavorite } },
                fav: newFavorite,
            }),
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        character.fav = newFavorite;
        if (character.data?.extensions) {
            character.data.extensions.fav = newFavorite;
        }

        // Refresh the card in the list and the hot-swap row.
        const id = preview.context.characters.indexOf(character);
        document.getElementById(`CharID${id}`)?.classList.toggle('is_fav', newFavorite);
        await favsToHotswap();

        if (activePreview === preview) {
            updateSidebar(preview);
        }
    } catch (error) {
        console.error('[Character QOLs] Failed to update the favorite state.', error);
    }
}

/**
 * Duplicates the previewed character with SillyTavern's own flow (it asks for
 * confirmation first).
 */
async function duplicatePreviewed() {
    const preview = activePreview;
    if (!preview) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const avatar = character.avatar;
    await duplicateCharacter({ avatar });

    if (activePreview === preview) {
        const refreshed = preview.context.characters.find((candidate) => candidate.avatar === avatar);
        if (refreshed) {
            preview.character = refreshed;
            renderSections(preview);
            updateSidebar(preview);
        }
    }
}

/**
 * Opens the character's linked lorebook in SillyTavern's World Info panel. The
 * preview has to close first, since the lorebook editor lives in the drawer
 * behind the popup.
 */
async function openWorldForPreview() {
    const preview = activePreview;
    if (!preview) {
        return;
    }

    const worldName = getLinkedWorld(resolvePreviewCharacter(preview));
    if (!worldName) {
        return;
    }

    await preview.popup.complete(preview.context.POPUP_RESULT.CANCELLED);
    openWorldInfoEditor(worldName);
}

/**
 * Opens SillyTavern's external media preference dialog (the three-state one from
 * the character editor), applied to the previewed character.
 */
async function openMediaPreferenceDialog() {
    const preview = activePreview;
    if (!preview) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const content = createMediaDialogContent(preview.context, character.avatar);

    const dialog = new preview.context.Popup(content, preview.context.POPUP_TYPE.TEXT, '', {
        animation: 'fast',
        leftAlign: true,
    });
    dialog.dlg.classList.add('st-cq-media-popup');
    await dialog.show();
}

/**
 * Builds the body of the external media dialog. Radio changes apply immediately,
 * like they do in the native version.
 * @param {ReturnType<typeof getContext>} context
 * @param {string} avatar
 * @returns {HTMLElement}
 */
function createMediaDialogContent(context, avatar) {
    const powerUser = context.powerUserSettings;
    const current = getMediaState(avatar, powerUser);
    const globalState = powerUser.forbid_external_media ? 'forbidden' : 'allowed';

    const content = document.createElement('div');
    content.className = 'st-cq-media-dialog flex-container flexFlowColumn';

    const title = document.createElement('h4');
    title.className = 'margin0';
    title.textContent = 'Ability of this character to use external media in chats.';

    const subtitle = document.createElement('small');
    subtitle.className = 'marginBot5';
    subtitle.textContent = 'Media: images, videos, audio. External: not hosted on the local server.';

    content.append(title, subtitle);

    const options = [
        { value: 'global', label: `Use global setting (${globalState})` },
        { value: 'forbid', label: 'Always forbidden' },
        { value: 'allow', label: 'Always allowed' },
    ];

    for (const option of options) {
        const id = `st-cq-media-${option.value}`;
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        label.htmlFor = id;

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'st-cq-media-override';
        input.id = id;
        input.value = option.value;
        input.checked = current === option.value;
        input.addEventListener('change', () => {
            if (input.checked) {
                setMediaPreference(option.value);
            }
        });

        const text = document.createElement('span');
        text.textContent = option.label;

        label.append(input, text);
        content.append(label);
    }

    return content;
}

/**
 * Writes the previewed character's media preference to the same settings the
 * native Ext. Media button uses.
 * @param {'global'|'allow'|'forbid'} state
 */
function setMediaPreference(state) {
    const preview = activePreview;
    if (!preview) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const avatar = character.avatar;
    const powerUser = preview.context.powerUserSettings;
    const allowed = powerUser.external_media_allowed_overrides ??= [];
    const forbidden = powerUser.external_media_forbidden_overrides ??= [];

    const allowedIndex = allowed.indexOf(avatar);
    if (allowedIndex !== -1) {
        allowed.splice(allowedIndex, 1);
    }
    const forbiddenIndex = forbidden.indexOf(avatar);
    if (forbiddenIndex !== -1) {
        forbidden.splice(forbiddenIndex, 1);
    }

    if (state === 'allow') {
        allowed.push(avatar);
    } else if (state === 'forbid') {
        forbidden.push(avatar);
    }

    preview.context.saveSettingsDebounced();

    if (activePreview === preview) {
        renderSections(preview);
        updateSidebar(preview);
    }
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
 * Moves media source attributes into `data-*` attributes before sanitizing, so
 * SillyTavern's sanitizer cannot drop them based on the current chat's entity.
 * The values are restored by {@link applyMediaPolicy}.
 * @param {string} html
 * @returns {string}
 */
function encodeMediaAttributes(html) {
    if (!html) {
        return html;
    }

    const template = document.createElement('template');
    template.innerHTML = html;

    const media = template.content.querySelectorAll(MEDIA_SELECTOR);
    if (media.length === 0) {
        return html;
    }

    for (const element of media) {
        for (const attribute of MEDIA_ATTRIBUTES) {
            if (!element.hasAttribute(attribute)) {
                continue;
            }
            element.setAttribute(`${MEDIA_ATTRIBUTE_PREFIX}${attribute}`, element.getAttribute(attribute));
            element.removeAttribute(attribute);
        }
    }

    return template.innerHTML;
}

/**
 * Restores the protected media attributes and applies the previewed character's
 * media setting: external media is removed when that character does not allow it.
 * @param {HTMLElement} element
 * @param {boolean} mediaAllowed
 */
function applyMediaPolicy(element, mediaAllowed) {
    let blocked = false;

    for (const node of element.querySelectorAll(MEDIA_SELECTOR)) {
        restoreMediaAttributes(node);

        if (!mediaAllowed && hasExternalMedia(node)) {
            node.remove();
            blocked = true;
        }
    }

    if (blocked) {
        const note = document.createElement('small');
        note.className = 'st-cq-media-note';
        note.textContent = 'External media is blocked for this character. '
            + 'Use the Ext. Media button in the character editor to allow it.';
        element.append(note);
    }
}

/**
 * Puts back the source attributes that {@link encodeMediaAttributes} moved away,
 * but only for URLs that would have survived sanitization.
 * @param {Element} node
 */
function restoreMediaAttributes(node) {
    for (const attribute of MEDIA_ATTRIBUTES) {
        const key = `${MEDIA_ATTRIBUTE_PREFIX}${attribute}`;
        const value = node.getAttribute(key);
        if (value === null) {
            continue;
        }
        node.removeAttribute(key);

        const safe = attribute === 'srcset' ? isSafeSrcset(value) : isSafeMediaUrl(value);
        if (safe) {
            node.setAttribute(attribute, value);
        }
    }

    // A media element without any source left has nothing to show.
    if (['IMG', 'SOURCE', 'TRACK', 'EMBED'].includes(node.tagName)
        && !node.getAttribute('src') && !node.getAttribute('srcset')) {
        node.remove();
    }
}

/**
 * Rejects URL schemes that DOMPurify would normally have removed. The attributes
 * are sanitized while encoded, so this check has to be done on restore.
 * @param {string} value
 * @returns {boolean}
 */
function isSafeMediaUrl(value) {
    const url = String(value).trim();
    if (!url) {
        return false;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        return /^(https?|blob):/i.test(url) || /^data:(image|video|audio)\//i.test(url);
    }
    // Relative URL: stays on this origin.
    return true;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSafeSrcset(value) {
    return String(value).split(',').every((candidate) => {
        const [url] = candidate.trim().split(/\s+/);
        return !url || isSafeMediaUrl(url);
    });
}

/**
 * Mirrors SillyTavern's own definition of an external media URL.
 * @param {string} url
 * @returns {boolean}
 */
function isExternalMediaUrl(url) {
    return (url.indexOf('://') > 0 || url.indexOf('//') === 0) && !url.startsWith(window.location.origin);
}

/**
 * @param {Element} node
 * @returns {boolean}
 */
function hasExternalMedia(node) {
    const urls = [];
    const src = node.getAttribute('src');
    if (src) {
        urls.push(src);
    }
    const data = node.getAttribute('data');
    if (data) {
        urls.push(data);
    }
    const srcset = node.getAttribute('srcset');
    if (srcset) {
        for (const candidate of srcset.split(',')) {
            const [url] = candidate.trim().split(/\s+/);
            if (url) {
                urls.push(url);
            }
        }
    }
    return urls.some((url) => isExternalMediaUrl(url));
}

/**
 * Renders markdown with SillyTavern's converter and sanitizer, scoping any
 * custom styles inside the character data to this content block.
 * Falls back to plain text if anything goes wrong.
 * @param {HTMLElement} element
 * @param {string} text
 * @param {boolean} [mediaAllowed=true]
 */
function renderInto(element, text, mediaAllowed = true) {
    const html = renderMarkdown(text);
    if (html) {
        element.innerHTML = html;
        applyMediaPolicy(element, mediaAllowed);
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
        const html = encodeMediaAttributes(encodeStyleTags(converter.makeHtml(text)));
        const purifier = window.DOMPurify;
        if (!purifier) {
            return '';
        }
        const sanitized = purifier.sanitize(html, {
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
