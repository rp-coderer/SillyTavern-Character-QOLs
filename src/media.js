/**
 * Markdown rendering and the external-media policy for preview content.
 *
 * Part of the Character QOLs extension.
 */

import { converter, decodeStyleTags, encodeStyleTags } from './st.js';

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

export { renderInto, renderMarkdown, hasExternalMedia };
