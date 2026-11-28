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
 * A minimal editor
 * -----------------
 * The footer's Edit button turns the same popup into a small editor for the card
 * text fields. It deliberately does not reuse SillyTavern's own editor form: that
 * form is bound to `this_chid`, the character of the *current chat*, so its toolbar
 * would act on the wrong character, its autosave would reset the active chat's
 * opener, and its body-level popovers (tags, export, World Info) cannot render
 * above a `<dialog>`. Instead the drafts live in the popup and are saved with the
 * `/api/characters/merge-attributes` endpoint, which updates only the given card
 * attributes and leaves the chat alone.
 *
 * Module layout
 * -------------
 * This file only wires the extension together. The implementation lives under
 * `src/`: settings and the settings panel, the native editor tabs, the popup
 * shell (`src/popup.js`), its read view, its minimal editor and its sidebar
 * actions, plus the shared markdown/media helpers and character helpers.
 */

import { getContext } from './src/st.js';
import { applyEditorTabs, setupEditorTabs } from './src/tabs.js';
import { log, initSettings, renderSettingsPanel, settings } from './src/settings.js';
import { closePreview, onDocumentClick } from './src/popup.js';
import { previewState } from './src/state.js';
import { applyWelcomeOverhaul, refreshWelcomeOverhaul, setupWelcomeOverhaul } from './src/welcome/index.js';

let initialized = false;

/**
 * Initializes the extension once the app is ready.
 */
async function init() {
    if (initialized) {
        return;
    }
    initialized = true;

    const context = getContext();
    initSettings(context);

    await renderSettingsPanel(context, {
        closePreview,
        refreshPreview: () => previewState.active?.refresh?.(),
        applyEditorTabs,
        applyWelcomeOverhaul: () => applyWelcomeOverhaul(context, settings.overhaulWelcome),
        refreshWelcomeList: refreshWelcomeOverhaul,
    });

    // Capture phase: this runs before SillyTavern's delegated document handlers.
    document.addEventListener('click', onDocumentClick, true);

    setupEditorTabs(context);

    if (settings.overhaulWelcome) {
        setupWelcomeOverhaul(context);
    }

    log('ready');
}

const context = getContext();
context.eventSource.on(context.eventTypes.APP_READY, init);
