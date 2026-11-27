/**
 * Tabbed Description / First message view for the native character editor.
 *
 * Part of the Character QOLs extension.
 */

import { settings } from './settings.js';

/**
 * Account storage key for the last used tab of the character editor.
 */
const EDITOR_TAB_KEY = 'CharacterQOLs_EditorTab';

/**
 * The tab strip injected into the native character editor, or null before setup.
 * @type {{
 *   form: HTMLFormElement,
 *   tabbar: HTMLElement,
 *   context: ReturnType<typeof getContext>,
 *   tabs: Record<string, { tab: HTMLElement, panel: HTMLElement }>,
 * }|null}
 */
let editorTabs = null;

/**
 * Turns the Description and First Message blocks of the native character editor
 * into tabs, so the active textarea can fill the available height instead of
 * being pinned to a fixed height.
 * @param {ReturnType<typeof getContext>} context
 */
function setupEditorTabs(context) {
    const form = document.getElementById('form_create');
    const description = document.getElementById('descriptionWrapper');
    const firstMessage = document.getElementById('firstMessageWrapper');

    if (!(form instanceof HTMLFormElement) || !(description instanceof HTMLElement) || !(firstMessage instanceof HTMLElement)) {
        console.warn('[Character QOLs] Character editor layout not found; the tabbed editor is disabled.');
        return;
    }

    if (form.querySelector('.st-cq-editor-tabbar')) {
        return;
    }

    const tabbar = document.createElement('div');
    tabbar.className = 'st-cq-editor-tabbar';
    tabbar.setAttribute('role', 'tablist');
    tabbar.setAttribute('aria-label', 'Character text');

    const tabs = {
        description: {
            tab: createEditorTab('Description'),
            panel: description,
        },
        firstMessage: {
            tab: createEditorTab('First message'),
            panel: firstMessage,
        },
    };

    for (const [name, entry] of Object.entries(tabs)) {
        entry.tab.id = `st-cq-editor-tab-${name}`;
        entry.tab.setAttribute('aria-controls', entry.panel.id);
        entry.tab.addEventListener('click', () => selectEditorTab(name));

        entry.panel.classList.add('st-cq-tab-panel');
        entry.panel.setAttribute('role', 'tabpanel');
        entry.panel.setAttribute('aria-labelledby', entry.tab.id);

        tabbar.append(entry.tab);
    }

    form.insertBefore(tabbar, description);

    editorTabs = { form, tabbar, context, tabs };

    const stored = context.accountStorage.getItem(EDITOR_TAB_KEY);
    selectEditorTab(stored === 'firstMessage' ? 'firstMessage' : 'description', { save: false });

    // Spoiler-free mode hides both text blocks with inline styles; the tab strip
    // is pointless while that is active.
    const observer = new MutationObserver(() => applyEditorTabs());
    observer.observe(description, { attributes: true, attributeFilter: ['style'] });
    observer.observe(firstMessage, { attributes: true, attributeFilter: ['style'] });

    applyEditorTabs();
}

/**
 * Creates one tab button for the character editor.
 * @param {string} label
 * @returns {HTMLElement}
 */
function createEditorTab(label) {
    const tab = document.createElement('div');
    tab.className = 'st-cq-editor-tab';
    tab.setAttribute('role', 'tab');
    tab.tabIndex = -1;
    tab.textContent = label;
    tab.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        tab.click();
    });
    return tab;
}

/**
 * Switches the character editor to one of the text tabs.
 * @param {'description'|'firstMessage'} name
 * @param {{ save?: boolean }} [options]
 */
function selectEditorTab(name, { save = true } = {}) {
    if (!editorTabs) {
        return;
    }

    for (const [key, entry] of Object.entries(editorTabs.tabs)) {
        const active = key === name;
        entry.tab.classList.toggle('active', active);
        entry.tab.setAttribute('aria-selected', String(active));
        entry.tab.tabIndex = active ? 0 : -1;
        entry.panel.classList.toggle('st-cq-tab-hidden', !active);
    }

    if (save) {
        editorTabs.context.accountStorage.setItem(EDITOR_TAB_KEY, name);
    }
}

/**
 * Applies the tabbed editor setting and keeps the tab strip in sync with
 * SillyTavern's spoiler-free mode.
 */
function applyEditorTabs() {
    if (!editorTabs) {
        return;
    }

    const { form, tabbar, tabs } = editorTabs;
    const enabled = Boolean(settings.tabbedEditor);
    const spoilerHidden = tabs.description.panel.style.display === 'none'
        && tabs.firstMessage.panel.style.display === 'none';

    form.classList.toggle('st-cq-editor-tabbed', enabled);
    tabbar.classList.toggle('st-cq-tabbar-hidden', !enabled || spoilerHidden);
}

export { setupEditorTabs, applyEditorTabs };
