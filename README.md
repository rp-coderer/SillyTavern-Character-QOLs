# SillyTavern-Character-QOLs

Quality-of-life fixes for how SillyTavern handles characters and chats.

**Phase 1 — character preview.** Clicking a character card in the character list opens a
details popup instead of immediately loading (or resuming) that character's chat. You
decide to chat from the popup.

## Why

Opening a character card always starts a chat, which makes browsing a large library
awkward and can silently change which character is loaded on the next page refresh.
This extension turns the card click into a preview, rendered with SillyTavern's own
popup, markdown converter and theme, so it looks and feels native.

## Features

- Native popup dialog (the same `Popup` component SillyTavern uses for its own dialogs).
- Native look: theme colors, fonts, avatar shapes, tag markup and `inline-drawer` sections.
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
  short note instead of disappearing silently.
- Bulk-edit mode, group member lists, hot-swap avatars and the card context menu keep
  their original behavior.

## Installation

1. Copy the `SillyTavern-Character-QOLs` folder into
   `SillyTavern/public/scripts/extensions/third-party/`.
2. Reload the SillyTavern page.
3. The setting "Preview characters in a popup" appears in *Extensions* → *Character QOLs*.

## Usage

- Click a character card → preview popup. If that character's chat is already open, the
  native character editor opens instead.
- **Chat** → continues that character's most recent chat (or creates one), exactly like a
  normal card click used to.
- **Close** / `Esc` → back to the character list, unchanged (pending edits are saved).

## Notes / limitations

- Character text is shown as authored; macros such as `{{char}}` are not substituted in
  the preview.
- Custom CSS embedded in creator notes is scoped to the preview content so it cannot leak
  into the rest of the interface.
- Lazy-loaded character lists are handled: shallow characters are fetched before the
  preview is shown.

## Roadmap

- Phase 2: edit mode inside the popup, using SillyTavern's real character editor
  (`#rm_ch_create_block` and the advanced definitions popup) instead of reimplementing it.

## Compatibility

- SillyTavern 1.19.0 (developed against this version). Older versions that already use the
  current `Popup` dialog API and the `#rm_print_characters_block` list should work too.
- If the older `ST-CharacterPreview` extension is installed, disable it: both intercept
  character card clicks.
