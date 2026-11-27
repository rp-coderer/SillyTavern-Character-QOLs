/**
 * Popup facade: click claim, opening, the popup shell and the Chat action.
 *
 * Part of the Character QOLs extension.
 */

import { getContext, setActiveCharacter, setActiveGroup } from './st.js';
import { log, settings } from './settings.js';
import { previewState } from './state.js';
import { createPreviewContent, renderSections, updateSidebar } from './popup/view.js';
import { enterEditMode, exitEditMode, guardPreviewClose, savePreviewEdits } from './popup/editor.js';

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

    if (previewState.opening || previewState.popup) {
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
    if (previewState.opening) {
        return;
    }
    previewState.opening = true;

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

        previewState.popup = popup;
        log('opening preview:', id, character.name);

        const result = await popup.show();
        if (result === context.POPUP_RESULT.AFFIRMATIVE) {
            await startChat(id);
        }
    } finally {
        previewState.popup = null;
        previewState.active = null;
        previewState.opening = false;
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
                classes: ['st-cq-close-button'],
            },
        ],
    });

    popup.dlg.classList.add('st-cq-popup');
    popup.dlg.setAttribute('aria-label', `Character details: ${character.name ?? 'character'}`);

    // Edit / Save / Cancel are plain footer buttons: they act in place and must
    // not close the popup, so they are not registered as popup result controls.
    const editButton = createFooterButton('Edit', 'fa-pen', () => enterEditMode(previewState.active));
    editButton.classList.add('st-cq-edit-button');
    const saveButton = createFooterButton('Save', 'fa-floppy-disk', () => savePreviewEdits(preview));
    saveButton.classList.add('st-cq-save-button');
    const cancelButton = createFooterButton('Cancel', 'fa-xmark', () => exitEditMode(preview));
    cancelButton.classList.add('st-cq-cancel-button');

    preview.controls = {
        edit: editButton,
        chat: popup.buttonControls.querySelector('.st-cq-chat-button'),
        close: popup.buttonControls.querySelector('.st-cq-close-button'),
        save: saveButton,
        cancel: cancelButton,
    };
    preview.controls.chat.before(editButton);
    popup.buttonControls.append(saveButton, cancelButton);
    setEditControlsVisible(preview, false);

    popup.onClosing = () => guardPreviewClose(preview);

    preview.popup = popup;

    // Helpers for the editor and the sidebar actions, so those modules can
    // refresh the view without importing it (and without a module cycle).
    preview.refresh = () => {
        renderSections(preview);
        updateSidebar(preview);
    };
    preview.setEditing = (editing) => setEditControlsVisible(preview, editing);

    previewState.active = preview;
    updateSidebar(preview);

    return popup;
}

/**
 * Creates one footer button for the preview popup. These are plain buttons, not
 * popup result controls, so clicking them never closes the popup.
 * @param {string} text
 * @param {string} icon Font Awesome icon name without the `fa-solid` prefix
 * @param {() => void} onClick
 * @returns {HTMLElement}
 */
function createFooterButton(text, icon, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button menu_button_icon st-cq-footer-button';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');

    const iconElement = document.createElement('i');
    iconElement.className = `fa-solid ${icon}`;
    const label = document.createElement('span');
    label.textContent = text;
    button.append(iconElement, label);

    button.addEventListener('click', (event) => {
        event.preventDefault();
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
 * Shows the footer buttons for the current preview mode.
 * @param {object} preview
 * @param {boolean} editing
 */
function setEditControlsVisible(preview, editing) {
    const controls = preview.controls;
    if (!controls) {
        return;
    }

    controls.edit.style.display = editing ? 'none' : '';
    controls.chat.style.display = editing ? 'none' : '';
    controls.close.style.display = editing ? 'none' : '';
    controls.save.style.display = editing ? '' : 'none';
    controls.cancel.style.display = editing ? '' : 'none';
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
 * Closes the preview that is currently open, if any. Used when the extension is
 * disabled from the settings panel; unsaved drafts are dropped without asking.
 */
function closePreview() {
    const popup = previewState.popup;
    if (!popup) {
        return;
    }

    if (previewState.active?.edit) {
        previewState.active.edit = null;
    }

    const context = getContext();
    popup.complete(context.POPUP_RESULT.CANCELLED)?.catch(() => { });
}

export { onDocumentClick, closePreview };
