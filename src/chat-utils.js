/**
 * Small shared helpers for chat lists: timestamps, date formatting and the
 * date buckets used by the welcome screen's recent list.
 *
 * Part of the Character QOLs extension.
 */

const EMPTY_PREVIEWS = new Set(['[The message is empty]', '[The chat is empty]']);

/**
 * The date sections of the welcome screen's recent list, in display order.
 * @type {{ key: string, title: string }[]}
 */
const DATE_BUCKETS = [
    { key: 'today', title: 'Today' },
    { key: 'yesterday', title: 'Yesterday' },
    { key: 'thisWeek', title: 'This week' },
    { key: 'thisMonth', title: 'This month' },
    { key: 'older', title: 'Long time ago' },
];

/**
 * Parses a chat timestamp into a Date, or null when it is not usable.
 * @param {string|number|Date|undefined|null} value
 * @returns {Date|null}
 */
function toDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Millisecond timestamp of a chat's last message, for sorting.
 * @param {{ last_mes?: string|number }} chat
 * @returns {number}
 */
function chatTimestamp(chat) {
    return toDate(chat?.last_mes)?.getTime() ?? 0;
}

/**
 * Short date label for a chat row: time for today, month/day for this year,
 * full date otherwise.
 * @param {string|number|Date|undefined} value
 * @returns {string}
 */
function formatChatDate(value) {
    const date = toDate(value);
    if (!date) {
        return '';
    }

    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Full date label used as a tooltip.
 * @param {string|number|Date|undefined} value
 * @returns {string}
 */
function formatChatDateLong(value) {
    const date = toDate(value);
    return date ? date.toLocaleString() : '';
}

/**
 * Returns the date bucket key for a chat timestamp.
 * @param {string|number|Date|undefined} value
 * @returns {'today'|'yesterday'|'thisWeek'|'thisMonth'|'older'}
 */
function getDateBucket(value) {
    const date = toDate(value);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOfMonth = startOfToday - 29 * 24 * 60 * 60 * 1000;
    const time = date ? date.getTime() : 0;

    if (time >= startOfToday) {
        return 'today';
    }
    if (time >= startOfYesterday) {
        return 'yesterday';
    }
    if (time >= startOfWeek) {
        return 'thisWeek';
    }
    if (time >= startOfMonth) {
        return 'thisMonth';
    }
    return 'older';
}

/**
 * Turns a raw last message into a short one-paragraph preview.
 * @param {string|undefined} message
 * @param {number} [limit=220]
 * @returns {string}
 */
function getPreviewText(message, limit = 220) {
    if (typeof message !== 'string') {
        return '';
    }

    const text = message.replace(/\s+/g, ' ').trim();
    if (!text || EMPTY_PREVIEWS.has(text)) {
        return '';
    }

    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export { DATE_BUCKETS, chatTimestamp, formatChatDate, formatChatDateLong, getDateBucket, getPreviewText };
