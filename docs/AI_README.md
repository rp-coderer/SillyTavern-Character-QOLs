# SillyTavern-Character-QOLs

Quality-of-life fixes for how SillyTavern handles characters and chats.

**Phase 1 — character preview.** Clicking a character card in the character list opens a
details popup instead of immediately loading (or resuming) that character's chat. You
decide to chat from the popup, and can make quick text edits to the card without opening
its chat.

## Why

Opening a character card always starts a chat, which makes browsing a large library
awkward and can silently change which character is loaded on the next page refresh.
This extension turns the card click into a preview, rendered with SillyTavern's own
popup, markdown converter and theme, so it looks and feels native.

## Features

- Native popup dialog (the same `Popup` component SillyTavern uses for its own dialogs).
- Native look: theme colors, fonts, avatar shapes, tag markup and `inline-drawer` sections.
- Two-column layout on desktop: a sidebar with the avatar and the action buttons, and the
  character text next to it. On narrow screens it collapses into a single scrolling column.
- Sidebar actions mirrored from the character editor toolbar:
  - **⭐ Favorite** — toggles the favorite state through SillyTavern's character merge
    endpoint, and refreshes the hot-swap row.
  - **🖼️ Ext. Media** — the same three-state external media preference as the character
    editor (global / always forbidden / always allowed), applied to this character.
  - **🌐 World Info** — opens the linked lorebook in the World Info panel (shown only when
    the character has a linked lorebook).
  - **⧉ Duplicate** — SillyTavern's own duplicate flow, including its confirmation dialog.
- Shows description, first message and alternate greetings (with a pager), scenario,
  personality, example dialogue, main prompt, post-history instructions, character's note
  and creator's notes — empty fields are omitted.
- Markdown rendered with SillyTavern's own converter and sanitizer. No CDN, no bundled
  markdown library.
- Tags, version and author in the header, using the same tag colors as the character list.
- Clicking a card no longer changes the active character, so the chat you had open stays
  the one that auto-loads on refresh.
- Clicking the card of the character whose chat is already open is left to SillyTavern:
  it opens the native character editor panel instead of the preview.
- Images in descriptions, greetings and creator notes are shown according to that
  character's own **Ext. Media** setting (the button in the character editor), not the
  setting of whatever chat happens to be open. Blocked external media is replaced with a
  short note instead of disappearing silently. A setting can force all external media to
  be shown in previews regardless of the character setting.
- **Minimal in-popup editor.** The popup's **Edit** button turns the same view into a
  text editor for the card, so a character can be tweaked without leaving the current chat
  or loading that character's chat first. It edits creator's notes, description, first
  message and alternate greetings, scenario, personality, example dialogue, main prompt,
  post-history instructions and character's note. Only the changed fields are written, via
  SillyTavern's character merge endpoint, so the chats are never touched. Empty fields are
  shown in edit mode so they can be filled in. **Save** writes the changes; **Cancel**
  discards them; closing the popup with unsaved changes asks before discarding. Every
  field has a maximize button, like the native editor's **Expand the editor**, which opens
  a full-screen textarea; typing there updates the draft live.
- Bulk-edit mode, group member lists, hot-swap avatars and the card context menu keep
  their original behavior.
- **Tabbed character editor.** Description and First message in the native character
  editor (the two big text boxes) become two tabs, so the active textarea fills the panel
  instead of being a fixed-height box that has to be resized. The last used tab is
  remembered per account. Spoiler-free mode is respected: when it hides both text blocks,
  the tab strip hides too. Can be turned off in the settings.

## Project layout

`index.js` only wires the extension together; the implementation lives under `src/` as
ES modules (the manifest still points at `index.js`).

| File | Responsibility |
| --- | --- |
| `index.js` | Entry point: initializes the settings, renders the settings panel, binds the card-click listener and sets up the editor tabs on `APP_READY`. |
| `src/st.js` | Single bridge to SillyTavern's own modules, so the relative path depth lives in one place. |
| `src/settings.js` | Module identity, defaults, the live `settings` object and the settings panel. |
| `src/state.js` | Shared `previewState` (active preview, open popup, opening guard). |
| `src/tabs.js` | Tabbed Description / First message view for the native character editor. |
| `src/character.js` | Character field normalization helpers. |
| `src/media.js` | Markdown rendering, sanitizing and the external-media policy. |
| `src/sections.js` | Shared drawer and nav-button UI kit. |
| `src/popup.js` | Click claim, popup shell, footer buttons and the Chat action. |
| `src/popup/view.js` | Read-only preview content: header, sidebar, tags and sections. |
| `src/popup/editor.js` | Minimal in-popup editor and the expanded editor. |
| `src/popup/actions.js` | Sidebar actions: favorite, external media, World Info and duplicate. |
| `style.css` | All styles, still loaded from `manifest.json`. |

The preview object created in `src/popup.js` also carries `preview.refresh()` and
`preview.setEditing()`, so the editor and the sidebar actions can update the view without
importing it (which would create a module cycle).

## Installation

1. Copy the `SillyTavern-Character-QOLs` folder into
   `SillyTavern/public/scripts/extensions/third-party/`.
2. Reload the SillyTavern page.
3. The settings appear in *Extensions* → *Character QOLs*:
   - "Preview characters in a popup"
   - "Always show external media in previews" (ignores each character's Ext. Media setting
     in previews only; chats are unaffected)
   - "Tabbed Description / First message editor" (on by default)

## Usage

- Click a character card → preview popup. If that character's chat is already open, the
  native character editor opens instead.
- **Chat** → continues that character's most recent chat (or creates one), exactly like a
  normal card click used to.
- **Edit** → edits the card text inside the popup (see above). **Save** writes, **Cancel**
  discards. The maximize icon next to a field (or next to the greeting pager) opens a
  full-screen editor for long text.
- **Close** / `Esc` → back to the character list, unchanged. If the editor has unsaved
  changes, a confirmation asks whether to discard them.
- Sidebar buttons act on the previewed character: Favorite, Ext. Media, World Info and
  Duplicate. They are disabled while editing.
- Saving from the popup leaves the open chat exactly as it is: the character's chat opener
  is not regenerated and no `CHARACTER_EDITED` event is emitted.

## Notes / limitations

- The minimal editor only covers text fields. Name, tags, avatar, version, creator and
  alternate greeting *management* (adding/removing greetings) stay in the native editor.
- Character text is shown as authored; macros such as `{{char}}` are not substituted in
  the preview.
- Custom CSS embedded in creator notes is scoped to the preview content so it cannot leak
  into the rest of the interface.
- Lazy-loaded character lists are handled: shallow characters are fetched before the
  preview is shown.

## Roadmap

- Full native-editor-in-popup is intentionally not planned: the native form is bound to the
  current chat's character (`this_chid`), so its toolbar would act on the wrong card, its
  autosave would reset the open chat's opener, and its body-level popovers (tags, export,
  World Info) cannot render above a dialog. The minimal editor covers the common quick
  edits instead. Possible follow-ups: editing tags and alternate greeting management.

## Compatibility

- SillyTavern 1.19.0 (developed against this version). Older versions that already use the
  current `Popup` dialog API and the `#rm_print_characters_block` list should work too.
- If the older `ST-CharacterPreview` extension is installed, disable it: both intercept
  character card clicks.
