/**
 * Minimal in-popup editor for the card text fields, plus the expanded editor.
 *
 * Part of the Character QOLs extension.
 */

import { createNavButton, createSection } from '../sections.js';
import { formatDepthMeta, getCharacterData, resolvePreviewCharacter } from '../character.js';
import { getContext } from '../st.js';
import { closeChatsView } from './chats.js';

/**
 * Fields the minimal editor can change. Each entry maps a preview section to
 * the card paths SillyTavern's own editor saves, so a merge request updates the
 * same places without touching the rest of the card.
 * @type {Record<string, {
 *   title: string,
 *   get: (character: object) => string,
 *   apply: (payload: object, value: string) => void,
 *   meta?: (character: object) => string,
 * }>}
 */
const EDITABLE_FIELDS = {
    creatorNotes: {
        title: "Creator's Notes",
        get: (character) => getCharacterData(character).creatorNotes,
        apply: (payload, value) => {
            payload.data.creator_notes = value;
            payload.creatorcomment = value;
        },
    },
    description: {
        title: 'Description',
        get: (character) => getCharacterData(character).description,
        apply: (payload, value) => {
            payload.data.description = value;
            payload.description = value;
        },
    },
    scenario: {
        title: 'Scenario',
        get: (character) => getCharacterData(character).scenario,
        apply: (payload, value) => {
            payload.data.scenario = value;
            payload.scenario = value;
        },
    },
    personality: {
        title: 'Personality',
        get: (character) => getCharacterData(character).personality,
        apply: (payload, value) => {
            payload.data.personality = value;
            payload.personality = value;
        },
    },
    exampleDialogue: {
        title: 'Example dialogue',
        get: (character) => getCharacterData(character).exampleDialogue,
        apply: (payload, value) => {
            payload.data.mes_example = value;
            payload.mes_example = value;
        },
    },
    systemPrompt: {
        title: 'Main Prompt',
        get: (character) => getCharacterData(character).systemPrompt,
        apply: (payload, value) => {
            payload.data.system_prompt = value;
        },
    },
    postHistoryInstructions: {
        title: 'Post-History Instructions',
        get: (character) => getCharacterData(character).postHistoryInstructions,
        apply: (payload, value) => {
            payload.data.post_history_instructions = value;
        },
    },
    depthPrompt: {
        title: "Character's Note",
        get: (character) => getCharacterData(character).depthPrompt,
        meta: (character) => {
            const data = getCharacterData(character);
            return formatDepthMeta(data.depthDepth, data.depthRole);
        },
        apply: (payload, value) => {
            payload.data.extensions = { depth_prompt: { prompt: value } };
        },
    },
};

/**
 * Section order of the edit mode. `greetings` is the shared first message /
 * alternate greetings editor; everything else is a plain text field.
 */
const EDIT_SECTION_LAYOUT = [
    'creatorNotes',
    'description',
    'greetings',
    'scenario',
    'personality',
    'exampleDialogue',
    'systemPrompt',
    'postHistoryInstructions',
    'depthPrompt',
];

/**
 * Switches the preview to its minimal editor. Everything stays inside the open
 * popup; no chat is started and SillyTavern's own editor form is not involved.
 * @param {object|null} preview
 */
function enterEditMode(preview) {
    if (!preview || preview.edit) {
        return;
    }

    if (preview.chats) {
        closeChatsView(preview);
    }

    const character = resolvePreviewCharacter(preview);
    const data = getCharacterData(character);
    const drafts = new Map();
    const originals = new Map();

    for (const [key, field] of Object.entries(EDITABLE_FIELDS)) {
        const value = field.get(character);
        drafts.set(key, value);
        originals.set(key, value);
    }

    const alternates = Array.isArray(character.data?.alternate_greetings)
        ? character.data.alternate_greetings.filter((greeting) => typeof greeting === 'string')
        : [];
    const greetings = [data.firstMessage, ...alternates];

    preview.edit = {
        drafts,
        originals,
        greetings,
        originalGreetings: [...greetings],
        index: 0,
        dirty: false,
        saving: false,
    };

    preview.root.classList.add('st-cq-editing');
    renderEditSections(preview);
    updateEditDirty(preview);
    preview.setEditing?.(true);

    // On touch devices focusing the first field would open the keyboard and hide
    // most of the popup, so only desktop pointers get the automatic focus.
    if (window.matchMedia?.('(pointer: fine)')?.matches) {
        preview.body.querySelector('.st-cq-edit-field')?.focus({ preventScroll: true });
    }
}

/**
 * Leaves the edit mode and restores the read-only preview. Drafts are dropped.
 * @param {object} preview
 */
function exitEditMode(preview) {
    if (!preview.edit || preview.edit.saving) {
        return;
    }

    preview.edit = null;
    preview.root.classList.remove('st-cq-editing');
    preview.setEditing?.(false);
    preview.refresh?.();
}

/**
 * Rebuilds the popup body with one textarea per editable section. Unlike the
 * read view, empty fields are shown too, so they can be filled in.
 * @param {object} preview
 */
function renderEditSections(preview) {
    const character = resolvePreviewCharacter(preview);
    preview.body.replaceChildren();

    for (const key of EDIT_SECTION_LAYOUT) {
        if (key === 'greetings') {
            preview.body.append(createGreetingsEditor(preview));
            continue;
        }

        const field = EDITABLE_FIELDS[key];
        const textarea = createEditTextarea(preview, key);
        const { drawer, content } = createSection(field.title, {
            open: true,
            meta: field.meta?.(character) ?? '',
            actions: [createExpandButton(textarea, field.title)],
        });
        content.append(textarea);
        preview.body.append(drawer);
    }
}

/**
 * Creates the textarea bound to one editable field.
 * @param {object} preview
 * @param {string} key A key of {@link EDITABLE_FIELDS}
 * @returns {HTMLTextAreaElement}
 */
function createEditTextarea(preview, key) {
    const textarea = document.createElement('textarea');
    textarea.className = 'st-cq-edit-field';
    textarea.rows = 4;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', EDITABLE_FIELDS[key].title);
    textarea.value = preview.edit.drafts.get(key) ?? '';

    textarea.addEventListener('input', () => {
        preview.edit.drafts.set(key, textarea.value);
        updateEditDirty(preview);
    });

    return textarea;
}

/**
 * Builds the shared greetings editor: the first message plus a pager over the
 * alternate greetings, mirroring the read-only greetings section.
 * @param {object} preview
 * @returns {HTMLElement}
 */
function createGreetingsEditor(preview) {
    const edit = preview.edit;
    const count = edit.greetings.length;
    const hasPager = count > 1;
    const title = hasPager ? 'Greetings' : 'First Message';

    const textarea = document.createElement('textarea');
    textarea.className = 'st-cq-edit-field';
    textarea.rows = 5;
    textarea.spellcheck = false;

    const expand = createExpandButton(textarea, hasPager ? 'Greeting' : 'First message');
    const { drawer, content } = createSection(title, {
        open: true,
        meta: hasPager ? `${count} greetings` : '',
        // Without a pager row, the header is the only place for the expand button.
        actions: hasPager ? [] : [expand],
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'st-cq-greetings';

    let label = null;

    const sync = () => {
        textarea.value = edit.greetings[edit.index] ?? '';
        textarea.setAttribute('aria-label', count > 1 ? `Greeting ${edit.index + 1}` : 'First message');
        if (label) {
            label.textContent = `${edit.index + 1} / ${count}`;
        }
    };

    textarea.addEventListener('input', () => {
        edit.greetings[edit.index] = textarea.value;
        updateEditDirty(preview);
    });

    if (hasPager) {
        const nav = document.createElement('div');
        nav.className = 'st-cq-greeting-nav';

        const pager = document.createElement('div');
        pager.className = 'st-cq-greeting-pager';

        const previous = createNavButton('fa-chevron-left', 'Previous greeting');
        label = document.createElement('span');
        label.className = 'st-cq-greeting-label';
        const next = createNavButton('fa-chevron-right', 'Next greeting');

        previous.addEventListener('click', () => {
            edit.index = (edit.index - 1 + count) % count;
            sync();
        });
        next.addEventListener('click', () => {
            edit.index = (edit.index + 1) % count;
            sync();
        });

        pager.append(previous, label, expand, next);
        nav.append(pager);
        wrapper.append(nav);
    }

    wrapper.append(textarea);
    sync();
    content.append(wrapper);
    return drawer;
}

/**
 * Recomputes whether the draft differs from the loaded card and enables or
 * disables the Save button accordingly.
 * @param {object} preview
 */
function updateEditDirty(preview) {
    const edit = preview.edit;
    if (!edit) {
        return;
    }

    const fieldsDirty = Object.keys(EDITABLE_FIELDS)
        .some((key) => (edit.drafts.get(key) ?? '') !== edit.originals.get(key));
    const greetingsDirty = edit.greetings.length !== edit.originalGreetings.length
        || edit.greetings.some((greeting, index) => greeting !== edit.originalGreetings[index]);

    edit.dirty = fieldsDirty || greetingsDirty;

    const disabled = !edit.dirty || edit.saving;
    preview.controls?.save?.classList.toggle('st-cq-disabled', disabled);
    preview.controls?.save?.setAttribute('aria-disabled', String(disabled));
}

/**
 * Saves the edited fields with SillyTavern's merge endpoint, which updates only
 * the given card attributes. This avoids the native editor's side effects (the
 * opener reset and the `CHARACTER_EDITED` event of the current chat).
 * @param {object} preview
 */
async function savePreviewEdits(preview) {
    const edit = preview.edit;
    if (!edit || edit.saving || !edit.dirty) {
        return;
    }

    const character = resolvePreviewCharacter(preview);
    const payload = { avatar: character.avatar, data: {} };
    let hasChanges = false;

    for (const [key, field] of Object.entries(EDITABLE_FIELDS)) {
        const value = edit.drafts.get(key) ?? '';
        if (value !== edit.originals.get(key)) {
            field.apply(payload, value);
            hasChanges = true;
        }
    }

    const greetingsChanged = edit.greetings.length !== edit.originalGreetings.length
        || edit.greetings.some((greeting, index) => greeting !== edit.originalGreetings[index]);
    if (greetingsChanged) {
        payload.data.first_mes = edit.greetings[0] ?? '';
        payload.first_mes = payload.data.first_mes;
        if (edit.greetings.length > 1) {
            payload.data.alternate_greetings = edit.greetings.slice(1);
        }
        hasChanges = true;
    }

    if (!hasChanges) {
        updateEditDirty(preview);
        return;
    }

    edit.saving = true;
    const saveLabel = preview.controls.save.querySelector('span');
    const previousLabel = saveLabel?.textContent ?? 'Save';
    if (saveLabel) {
        saveLabel.textContent = 'Saving…';
    }
    preview.controls.save.classList.add('st-cq-disabled');
    preview.controls.cancel.classList.add('st-cq-disabled');

    try {
        const response = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: preview.context.getRequestHeaders(),
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        await preview.context.getOneCharacter(character.avatar);
        const refreshed = preview.context.characters.find((candidate) => candidate.avatar === character.avatar);
        if (refreshed) {
            preview.character = refreshed;
        }

        preview.edit = null;
        preview.root.classList.remove('st-cq-editing');
        if (saveLabel) {
            saveLabel.textContent = previousLabel;
        }
        preview.controls.save.classList.remove('st-cq-disabled');
        preview.controls.cancel.classList.remove('st-cq-disabled');
        preview.setEditing?.(false);
        preview.refresh?.();
        toastr.success('Character saved.');
    } catch (error) {
        console.error('[Character QOLs] Failed to save the character changes.', error);
        toastr.error('Could not save the character. Check the console for details.');
        edit.saving = false;
        if (saveLabel) {
            saveLabel.textContent = previousLabel;
        }
        preview.controls.save.classList.remove('st-cq-disabled');
        preview.controls.cancel.classList.remove('st-cq-disabled');
        updateEditDirty(preview);
    }
}

/**
 * Asks for confirmation before dropping unsaved edits.
 * @param {object} preview
 * @param {string} question
 * @returns {Promise<boolean>}
 */
async function confirmDiscardChanges(preview, question) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = preview.context;
    const confirm = new Popup(question, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Discard',
        cancelButton: 'Keep editing',
        animation: 'fast',
    });

    return await confirm.show() === POPUP_RESULT.AFFIRMATIVE;
}

/**
 * Leaves the editor through the sidebar Edit button: unsaved drafts are only
 * dropped after the user confirms.
 * @param {object|null} preview
 */
async function requestExitEditMode(preview) {
    if (!preview?.edit || preview.edit.saving) {
        return;
    }
    if (preview.edit.dirty && !await confirmDiscardChanges(preview, '<p>You have unsaved changes. Discard them?</p>')) {
        return;
    }

    exitEditMode(preview);
}

/**
 * Confirms discarding unsaved edits when the popup is closed by Escape or by
 * a closing action.
 * @param {object} preview
 * @returns {Promise<boolean>}
 */
async function guardPreviewClose(preview) {
    const edit = preview.edit;
    if (!edit) {
        return true;
    }
    if (edit.saving) {
        return false;
    }
    if (!edit.dirty) {
        return true;
    }

    return confirmDiscardChanges(preview, '<p>You have unsaved changes. Discard them and close the preview?</p>');
}

/**
 * Creates the "expand editor" icon shown next to an editable field in the popup,
 * mirroring SillyTavern's own `.editor_maximize` button.
 * @param {HTMLTextAreaElement} textarea The textarea this button expands
 * @param {string} title Accessible name of the edited field
 * @returns {HTMLElement}
 */
function createExpandButton(textarea, title) {
    const button = document.createElement('div');
    button.className = 'st-cq-expand interactable fa-solid fa-maximize';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.title = 'Expand the editor';
    button.setAttribute('aria-label', `Expand the editor: ${title}`);

    button.addEventListener('click', (event) => {
        // The button sits inside the drawer header, so its click must not reach
        // the native inline-drawer toggle (that would collapse the section).
        event.preventDefault();
        event.stopPropagation();
        openExpandedEditor(textarea, title).catch((error) => {
            console.error('[Character QOLs] Failed to open the expanded editor.', error);
        });
    });

    return button;
}

/**
 * Opens a full-screen editor for one of the popup textareas. This mirrors the
 * popup opened by SillyTavern's `.editor_maximize` handler, without relying on
 * its delegated document click (see {@link createExpandButton}).
 * @param {HTMLTextAreaElement} textarea
 * @param {string} title
 */
async function openExpandedEditor(textarea, title) {
    const { Popup, POPUP_TYPE } = getContext();

    const wrapper = document.createElement('div');
    wrapper.className = 'height100p wide100p flex-container flexFlowColumn justifyCenter alignitemscenter';

    const expanded = document.createElement('textarea');
    expanded.className = 'height100p wide100p maximized_textarea';
    expanded.spellcheck = false;
    expanded.value = textarea.value;
    expanded.setAttribute('aria-label', `Expand the editor: ${title}`);

    // Keep the preview's textarea (and therefore the draft) in sync while typing.
    expanded.addEventListener('input', () => {
        textarea.value = expanded.value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    wrapper.append(expanded);

    await new Popup(wrapper, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        animation: 'fast',
    }).show();

    textarea.focus();
}

export { enterEditMode, exitEditMode, requestExitEditMode, savePreviewEdits, guardPreviewClose };
