/**
 * Sidebar actions: favorite, external media preference, World Info and duplicate.
 *
 * Part of the Character QOLs extension.
 */

import { duplicateCharacter, favsToHotswap, openWorldInfoEditor, world_names } from '../st.js';
import { settings } from '../settings.js';
import { resolvePreviewCharacter } from '../character.js';
import { previewState } from '../state.js';

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
    const preview = previewState.active;
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

        if (previewState.active === preview) {
            preview.refresh?.();
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
    const preview = previewState.active;
    if (!preview) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const avatar = character.avatar;
    await duplicateCharacter({ avatar });

    if (previewState.active === preview) {
        const refreshed = preview.context.characters.find((candidate) => candidate.avatar === avatar);
        if (refreshed) {
            preview.character = refreshed;
            preview.refresh?.();
        }
    }
}

/**
 * Opens the character's linked lorebook in SillyTavern's World Info panel. The
 * preview has to close first, since the lorebook editor lives in the drawer
 * behind the popup.
 */
async function openWorldForPreview() {
    const preview = previewState.active;
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
    const preview = previewState.active;
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
    const preview = previewState.active;
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

    if (previewState.active === preview) {
        preview.refresh?.();
    }
}

export {
    toggleFavorite,
    duplicatePreviewed,
    openWorldForPreview,
    openMediaPreferenceDialog,
    isPreviewMediaAllowed,
    getLinkedWorld,
    getMediaState,
    isFavorite,
};
