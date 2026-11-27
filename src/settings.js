/**
 * Extension settings, module identity and the settings panel.
 *
 * Part of the Character QOLs extension.
 */

import { renderExtensionTemplateAsync } from '../../../../extensions.js';

const MODULE_NAME = 'SillyTavern-Character-QOLs';
const EXTENSION_PATH = 'third-party/SillyTavern-Character-QOLs';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    alwaysShowExternalMedia: false,
    tabbedEditor: true,
});

/**
 * The live settings object. Initialized as a copy of the defaults and swapped
 * for the object stored in `extensionSettings` once the app is ready, so every
 * mutation is saved by SillyTavern's own settings persistence.
 * @type {{ enabled: boolean, alwaysShowExternalMedia: boolean, tabbedEditor: boolean }}
 */
export let settings = { ...DEFAULT_SETTINGS };

/**
 * Small helper so debug output is easy to filter.
 * @param {...any} args
 */
function log(...args) {
    console.debug('[Character QOLs]', ...args);
}

/**
 * Fills in missing defaults and points `settings` at the stored object.
 * @param {ReturnType<import('../../../../extensions.js').getContext>} context
 */
function initSettings(context) {
    const stored = context.extensionSettings[MODULE_NAME] ??= {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (stored[key] === undefined) {
            stored[key] = value;
        }
    }
    settings = stored;
}

/**
 * Adds the extension settings drawer.
 * @param {ReturnType<import('../../../../extensions.js').getContext>} context
 * @param {{
 *   closePreview?: () => void,
 *   refreshPreview?: () => void,
 *   applyEditorTabs?: () => void,
 * }} handlers Callbacks supplied by the extension entry point, so this module
 *   does not have to know about the popup or the editor tabs.
 */
async function renderSettingsPanel(context, handlers = {}) {
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
                    handlers.closePreview?.();
                }
            });
        }

        const media = wrapper.querySelector('#st_cq_always_show_media');
        if (media instanceof HTMLInputElement) {
            media.checked = settings.alwaysShowExternalMedia;
            media.addEventListener('change', () => {
                settings.alwaysShowExternalMedia = media.checked;
                context.saveSettingsDebounced();
                handlers.refreshPreview?.();
            });
        }

        const tabbedEditor = wrapper.querySelector('#st_cq_tabbed_editor');
        if (tabbedEditor instanceof HTMLInputElement) {
            tabbedEditor.checked = settings.tabbedEditor;
            tabbedEditor.addEventListener('change', () => {
                settings.tabbedEditor = tabbedEditor.checked;
                context.saveSettingsDebounced();
                handlers.applyEditorTabs?.();
            });
        }
    } catch (error) {
        console.error('[Character QOLs] Failed to render the settings template.', error);
    }
}

export { MODULE_NAME, EXTENSION_PATH, DEFAULT_SETTINGS, initSettings, renderSettingsPanel, log };
