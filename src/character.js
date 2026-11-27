/**
 * Character data helpers shared by the preview, the editor and the actions.
 *
 * Part of the Character QOLs extension.
 */

/** Shown when a character has no avatar file of its own. */
const FALLBACK_AVATAR = 'img/ai4.png';

/**
 * Normalizes the handful of character fields the preview needs.
 * Older cards store creator notes as `creatorcomment`.
 * @param {object} character
 */
function getCharacterData(character) {
    const data = character.data ?? {};
    const alternateGreetings = Array.isArray(data.alternate_greetings)
        ? data.alternate_greetings.filter((greeting) => typeof greeting === 'string' && greeting.trim())
        : [];

    return {
        name: character.name ?? '',
        description: character.description ?? '',
        personality: character.personality ?? '',
        scenario: character.scenario ?? '',
        firstMessage: character.first_mes ?? '',
        alternateGreetings,
        exampleDialogue: character.mes_example ?? '',
        creatorNotes: data.creator_notes ?? character.creatorcomment ?? '',
        creator: data.creator ?? '',
        version: data.character_version ?? '',
        systemPrompt: data.system_prompt ?? '',
        postHistoryInstructions: data.post_history_instructions ?? '',
        depthPrompt: data.extensions?.depth_prompt?.prompt ?? '',
        depthDepth: data.extensions?.depth_prompt?.depth,
        depthRole: data.extensions?.depth_prompt?.role ?? '',
    };
}

/**
 * Finds the up-to-date character object for the open preview. The `characters`
 * array can be replaced while the popup is open (e.g. after duplicating).
 * @param {object} preview
 * @returns {object}
 */
function resolvePreviewCharacter(preview) {
    return preview.context.characters.find((candidate) => candidate.avatar === preview.character.avatar)
        ?? preview.character;
}

/**
 * Formats the depth prompt metadata shown next to the character's note.
 * @param {number|string|undefined} depth
 * @param {string} role
 * @returns {string}
 */
function formatDepthMeta(depth, role) {
    const parts = [];
    if (depth !== undefined && depth !== null && depth !== '') {
        parts.push(`depth ${depth}`);
    }
    if (role) {
        parts.push(role);
    }
    return parts.join(' · ');
}

export { FALLBACK_AVATAR, getCharacterData, resolvePreviewCharacter, formatDepthMeta };
