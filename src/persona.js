/**
 * Resolves and renders the user persona that belongs to a chat.
 *
 * SillyTavern records the persona in the chat's metadata line
 * (`chat_metadata.persona`) when the chat is locked to one. Chats that were
 * never locked fall back to the default persona, then to the current one; those
 * are marked as inferred so the UI can dim them.
 *
 * Part of the Character QOLs extension.
 */

import { user_avatar } from './st.js';

/**
 * @typedef {object} ChatPersona
 * @property {string} avatar Persona avatar file name, empty when unknown
 * @property {string} name Persona name, falls back to the avatar file name
 * @property {'locked'|'default'|'current'|'none'} source Where the persona came from
 * @property {boolean} stored Whether the chat itself recorded this persona
 */

/**
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {{ persona?: string }|undefined|null} chatMetadata
 * @returns {ChatPersona}
 */
function resolveChatPersona(context, chatMetadata) {
    const powerUser = context.powerUserSettings ?? {};
    const storedAvatar = typeof chatMetadata?.persona === 'string' ? chatMetadata.persona : '';

    let avatar = '';
    let source = 'none';
    if (storedAvatar) {
        avatar = storedAvatar;
        source = 'locked';
    } else if (powerUser.default_persona) {
        avatar = powerUser.default_persona;
        source = 'default';
    } else if (user_avatar) {
        avatar = user_avatar;
        source = 'current';
    }

    const name = avatar ? String(powerUser.personas?.[avatar] ?? '') : '';
    return {
        avatar,
        name: name || avatar,
        source,
        stored: source === 'locked',
    };
}

/**
 * Tooltip describing the persona and how it was resolved.
 * @param {ChatPersona} persona
 * @returns {string}
 */
function personaTooltip(persona) {
    if (!persona.avatar) {
        return 'No persona recorded for this chat';
    }

    const suffix = persona.source === 'default'
        ? ' (default persona)'
        : persona.source === 'current'
            ? ' (current persona, not recorded in this chat)'
            : '';
    return `Persona: ${persona.name}${suffix}`;
}

/**
 * Builds the persona avatar element. When the chat did not store a persona, the
 * result gets the inferred class so the caller can dim it.
 * @param {ReturnType<import('../st.js').getContext>} context
 * @param {ChatPersona} persona
 * @param {{ className?: string, inferredClassName?: string, missingClassName?: string }} [options]
 * @returns {HTMLElement}
 */
function createPersonaAvatarElement(context, persona, { className = 'st-cq-persona', inferredClassName = '', missingClassName = '' } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    wrapper.title = personaTooltip(persona);

    if (persona.avatar) {
        wrapper.classList.add('avatar');
        const image = document.createElement('img');
        image.src = context.getThumbnailUrl('persona', persona.avatar);
        image.alt = persona.name ? `Persona: ${persona.name}` : 'Persona';
        image.addEventListener('error', () => {
            wrapper.replaceChildren(createPersonaPlaceholder());
        }, { once: true });
        wrapper.append(image);

        if (!persona.stored && inferredClassName) {
            wrapper.classList.add(inferredClassName);
        }
    } else {
        if (missingClassName) {
            wrapper.classList.add(missingClassName);
        }
        wrapper.append(createPersonaPlaceholder());
    }

    return wrapper;
}

/**
 * Placeholder icon for chats whose persona cannot be resolved.
 * @returns {HTMLElement}
 */
function createPersonaPlaceholder() {
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-user';
    return icon;
}

export { resolveChatPersona, personaTooltip, createPersonaAvatarElement };
