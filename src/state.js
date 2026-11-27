/**
 * Shared mutable state of the preview popup. Kept in its own module because
 * imported `let` bindings are read-only for importers.
 *
 * Part of the Character QOLs extension.
 */

/**
 * @type {{
 *   active: any|null,
 *   popup: any|null,
 *   opening: boolean,
 * }}
 */
const previewState = {
    /** The preview view that is currently open, or null. */
    active: null,
    /** The popup that is currently open, or null. */
    popup: null,
    /** True while a preview is being opened or shown, so clicks cannot stack popups. */
    opening: false,
};

export { previewState };
