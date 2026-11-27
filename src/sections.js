/**
 * Small shared UI kit: drawers and nav buttons.
 *
 * Part of the Character QOLs extension.
 */

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
 * Adds a collapsible section shell.
 * @param {string} title
 * @param {{ open?: boolean, meta?: string, actions?: HTMLElement[] }} [options]
 * @param {HTMLElement[]} [options.actions] Extra header controls, placed before the chevron
 * @returns {{ drawer: HTMLElement, content: HTMLElement }}
 */
function createSection(title, { open = false, meta = '', actions = [] } = {}) {
    const drawer = document.createElement('div');
    drawer.className = 'inline-drawer st-cq-section';

    const header = document.createElement('div');
    header.className = 'inline-drawer-toggle inline-drawer-header';

    const heading = document.createElement('div');
    heading.className = 'st-cq-section-heading';

    const label = document.createElement('b');
    label.textContent = title;
    heading.append(label);

    // Header controls sit right next to the title, like the native editor's
    // expand button sits next to its label.
    for (const action of actions) {
        heading.append(action);
    }

    header.append(heading);

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

export { createNavButton, createSection };
