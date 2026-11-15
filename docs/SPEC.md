# Manunggal — product and interaction specification

**Name:** Manunggal (Javanese/Indonesian: "united, unified")
**UUID:** `manunggal@lurim412`
**Target:** GNOME Shell 45–51
**License:** GPL-2.0-or-later

Manunggal is one keyboard-first place for the four things people constantly
copy: recent clipboard content, emoji, Unicode symbols, and colors. It is a
single GNOME Shell extension. No companion application, network service, or
runtime dependency is required.

## 1. Principles

1. **Quick to dismiss, quick to repeat.** The common path is: open, type, Enter.
   The menu closes and focus returns to the application.
2. **Native first.** A panel menu is the default. Every control is a real Shell
   actor with focus, hover, active, and accessible states.
3. **Private by default.** No network code. History is local, capped, and
   expiring. Private mode is one click away and visibly changes the panel icon.
4. **Honest about ambiguity.** Automatic categories are suggestions. A color is
   only detected from an exact color literal; code detection requires a
   threshold and can be overridden.
5. **No dead ends.** If a capability is unavailable (image capture, screen
   sampling, always-on-top), the UI says so and the rest keeps working.

## 2. Access

| Entry point | Behaviour |
|---|---|
| Panel icon (`edit-paste-symbolic`) | Opens the menu, or toggles the floating window when that mode is on |
| Keyboard shortcut, default `<Super><Shift>v` | Same as the panel icon; opens on the last used tab |
| `Esc` | Clears search first, then closes |
| `Ctrl+1`…`Ctrl+4` | Switch tab |
| `Ctrl+F` | Focus search |
| `Ctrl+,` | Open extension preferences (via `gnome-extensions prefs`) |

`Ctrl+1`…`Ctrl+4` are handled by a key controller on the view so they work in
both menu and floating mode. The global shortcut is registered through
`Main.wm.addKeybinding` and stored in GSettings, so it can be changed in
Preferences and appears in GNOME's keyboard shortcut system.

## 3. Main view

```
┌──────────────────────────────────────────────┐
│  [Manunggal]                    [shield] [⋮] │
│  [🔍 Search Clipboard…          ] [This tab▾]│
│  [Clipboard] [Emoji] [Symbol] [Color]        │
├──────────────────────────────────────────────┤
│  filter chips: All  Text  Code  Color  Emoji │
│  ┌────────────────────────────────────────┐  │
│  │ ★  "Deploy notes"          Text  2m  ⋮ │  │
│  │    ssh deploy@example.com …            │  │
│  └────────────────────────────────────────┘  │
│  …                                           │
└──────────────────────────────────────────────┘
```

- **Tabs:** Clipboard, Emoji, Symbol, Color. Labels can be hidden in Custom
  layout (icons remain, accessible names remain).
- **Search:** one field. Scope is explicit: a button reading **This tab** or
  **All**. `This tab` searches only the active tab. `All` searches clipboard,
  emoji, and symbols and shows grouped results with section headings.
  Search is hidden on the Color tab (nothing textual to search); the scope
  button remains available from the other tabs.
- **Search scope is sticky** across sessions but is always visible as text, not
  only as an icon.
- When no query is present, **All** shows a short hint and the three group
  names, not a giant mixed list.
- The menu width and content height are capped to the monitor work area and
  recomputed on every open, on monitor changes, and when text scaling changes.
  Default size is 27em wide by at most 34em of scrollable content.

## 4. Clipboard tab

### 4.1 Capture

- Listens to `Meta.Selection` `owner-changed` for `SELECTION_CLIPBOARD`.
- Stores UTF-8 text and, when enabled, PNG/JPEG/WebP images.
- Whitespace-only text and entries over the configured size cap are ignored.
- **Best-effort sensitive skip:** content advertising
  `x-kde-passwordManagerHint` is never stored when *Ignore password-manager
  content* is on (default). This convention is honoured by several password
  managers but is not universal; it is a mitigation, not a guarantee.
- **App exclusions:** users can list window `wm_class` values to ignore.
- Copying an item from Manunggal does not create a duplicate entry.
- Re-copying identical text later moves the existing entry to the top.

### 4.2 Categories

`Text`, `Code`, `Color`, `Emoji`, `Image`. Filter chips are always visible.

- **Color:** only when the trimmed entry is a complete color literal in HEX,
  `rgb()`, `rgba()`, `hsl()`, or `hsla()` form. The chip shows a swatch.
- **Emoji:** a short string made only of emoji sequences (including ZWJ,
  keycaps, flags, and variation selectors).
- **Code:** a heuristic score over punctuation, indentation, keywords, JSON,
  markup, and shell prompts. Threshold is deliberately conservative. A single
  word is never code. The item menu offers **Change category → Text / Code /
  Color / Emoji** so a wrong guess is one action away.
- **Image:** PNG, JPEG, and WebP; thumbnail when decodable, generic icon
  otherwise.

### 4.3 Item actions

Each item is a card: a header with the category icon, label, relative time and
state badges, followed by a nested preview sheet. The preview shows a thumbnail
for images, a swatch and value for colours, monospaced text for code, and a
two-line excerpt for text. Secondary actions appear on hover or keyboard focus;
the custom layout can keep them visible.

Click/Enter copies the whole item and closes the view (configurable).
Secondary actions live in the row's `⋮` menu and on the keyboard:

| Action | Shortcut on focused row |
|---|---|
| Copy | `Enter` / `Space` |
| Pin / unpin | `P` |
| Delete | `Delete` |
| Actions menu | `Menu` key or `Shift+F10` |
| Edit text | `E` |
| Accent colour | Actions menu → Accent colour |

- **Pin** keeps an entry at the top and exempts it from trimming and expiry.
- **Edit** opens a modal text editor (multi-line, `Ctrl+Enter` saves, `Esc`
  cancels). Empty text cannot be saved.
- **Accent colour** is presentation only. It paints a narrow bar inside the
  preview sheet. A palette plus the custom colour wheel is available. Accent
  colours are not content and are never copied.
- **Delete** is immediate with an in-menu toast and a single **Undo** action
  (5 seconds). **Clear history** asks for confirmation when the setting is on.
- **Change category** is a manual override stored with the entry; automatic
  detection is not re-applied to it.

### 4.4 Images

- Original bytes are stored once per SHA-256 checksum under
  `$XDG_DATA_HOME/manunggal@lurim412/images/`.
- Thumbnails are generated on demand in
  `$XDG_CACHE_HOME/manunggal@lurim412/thumbs/` at 128 px and displayed through
  `St.TextureCache`.
- Restoring copies the original bytes with the original MIME type.
- If PNG/JPEG decoding fails, the item is still restorable and shows a generic
  image icon. Image capture can be disabled entirely.
- Capture and restore are verified only where noted in `FEASIBILITY.md`.

## 5. Privacy

Privacy is a first-class, visible state, not a submenu.

**Private mode** does all of the following:

1. **Pauses capture immediately.** Nothing copied while it is on is written to
   history, memory, or disk.
2. **Hides existing history.** The Clipboard tab shows a lock panel explaining
   why. There is deliberately no "peek" button; turning private mode off
   restores the list.
3. **Does not delete anything.** Clearing is a separate, explicit action.
4. The panel icon changes to a shield and the menu header says **Private**.

Private mode is **not persisted by default**: a Shell restart returns to normal
capture, avoiding a silently disabled clipboard manager. A setting can keep it
across restarts.

**Storage**

| Data | Location | Format |
|---|---|---|
| History metadata + text | `$XDG_DATA_HOME/manunggal@lurim412/history.json` | JSON, mode 0600 |
| Images | `$XDG_DATA_HOME/manunggal@lurim412/images/` | original bytes, mode 0600 |
| Thumbnails | `$XDG_CACHE_HOME/manunggal@lurim412/thumbs/` | regenerable PNG |
| Settings | GSettings/dconf | `org.gnome.shell.extensions.manunggal` |

Defaults: persist history **on**, 100 items, **7-day** retention, images **on**
(5 MB per image, 20 MB total), password-manager skip **on**, sensitive entries
**memory-only**, clear on screen lock **off**.

**Clear history** removes the JSON file, all images, and all thumbnails. It also
clears the in-memory list. It is available in the panel menu and in
Preferences. **Sensitive** items (manually marked) are masked in the list,
excluded from search, never written to disk, and expire with the session.

No clipboard content, search query, emoji choice, or colour is sent anywhere.
The extension contains no network code.

## 6. Emoji and Symbol tabs

- Category chips with icons; a **Recent** chip appears after first use.
- Responsive grid of large, focusable cells. Arrow keys move spatially; `Tab`
  also works; `Enter`/`Space` activates.
- **Single click** copies the glyph and closes the view (configurable).
- **Shift+click** toggles the glyph in a multi-selection. Selection order is the
  order the user selected. Each selected cell shows a numbered badge.
- **Accessible alternative:** a **Select** toggle button in the tab header.
  While on, a click/`Enter` toggles selection without Shift; a footer shows
  `N selected`, a preview, **Copy**, and **Clear**. `Esc` leaves select mode
  before closing the view.
- **Copy order and separators are predictable:** selection order, concatenated
  with the configured separator — *none* for emoji (default), *space* for
  symbols (default). Both are configurable.
- Search matches names, CLDR keywords, subgroup and category names.
- Each cell's accessible name is its short name and code point, e.g.
  `grinning face, U+1F600`; selected cells say `selected, 2 of 3`.

Emoji data is Unicode Emoji 15.1 with English CLDR annotations, bundled at build
time (see `src/data/LICENSE-UNICODE.txt`). Symbols are a curated set of
monochrome Unicode characters with searchable names and aliases.

## 7. Color tab

- Large preview with a checkerboard for transparency and the current value.
- Three always-visible rows — **HEX**, **RGB**, **RGBA** — each with its value
  and a copy button. The preferred format (Preferences) gets the primary Copy
  button and a highlighted border.
- Swatches: Adwaita palette, recent colours, plus a **Pick from screen** button.
- **Advanced** (collapsible): HSV colour wheel (hue ring + saturation/value
  square), HEX field, and R/G/B/A numeric fields. Every value is editable by
  keyboard; the wheel is an enhancement, never the only way to choose.
- Alpha is shown as 0–100% in the UI and emitted as 0–1 in `rgba()`.
- Copy formats:
  - `#RRGGBB` / `#RRGGBBAA` (uppercase setting)
  - `rgb(255, 0, 0)`
  - `rgba(255, 0, 0, 0.5)`
- **Screen sampling is a separate capability.** It calls Shell's native
  `Shell.Screenshot.pick_color()` so the compositor shows its own crosshair and
  the extension never captures a full-screen image. If the call is denied or
  unavailable (remote/headless sessions, future restrictions), the button shows
  an inline explanation and the wheel remains fully usable. Sampling is never
  presented as a substitute for the wheel.

## 8. Layout and scaling

### Modes

- **Detailed** (default): card layout with a two-line preview, header metadata,
  actions on hover and focus, tab labels, category chips.
- **Compact:** card layout with a one-line preview, no metadata, denser rows,
  tab labels kept while the menu is at least 24em wide.
- **Custom:** a defined, finite set:
  - Preview lines: 1–4
  - Show metadata: on/off
  - Row actions: always / on hover and focus / menu only
  - Tab labels: on/off
  - Density: comfortable / compact
  - Glyph cell size: small / medium / large
  - Menu width: automatic or 280–600 px

All sizes use `em` so GNOME's text-scaling factor enlarges text, icons, padding,
and the colour wheel together. The menu and floating window are clamped to the
current monitor's work area; no fixed pixel height can push content off-screen.
The layout is checked at 1.0, 1.25, 1.5, and 0.8 text scales (the last is the
author's daily setting).

### Accessibility

- Every interactive actor has an accessible name; icon-only buttons describe
  the action, not the icon.
- Tab buttons expose `PAGE_TAB`; list rows expose `LIST_ITEM`; the colour
  preview exposes an image description; the wheel is labelled but all values
  have text alternatives.
- Focus is always visible (`:focus` box-shadow, never colour alone).
- Selection is shown by a check/badge **and** colour, with the count in text.
- `Escape` never traps: it clears search, then exits select mode, then closes.
- No interaction depends on hover, Shift, right-click, or precise pointing.
- Animations respect GNOME's `enable-animations` setting.

## 9. Floating-window mode

Optional, off by default. The same view is hosted in a shell-drawn frameless
panel rather than the popup menu.

- Header: drag handle, title, private-mode indicator, reset-position button,
  close button. The whole header is draggable except its buttons.
- Draggable; position stored in GSettings and clamped to the active monitor's
  work area on every show. **Reset position** centres it.
- `Esc` closes and returns focus to the previously focused application window.
  Search is focused on open. No modal grab: other windows remain usable.
- Size: default 420×560 logical px, clamped to 92% of the work area; it never
  covers the panel or goes off-screen. On monitors shorter than 600 px it takes
  the available height and the content scrolls.
- **Keep above other windows** (default on): the overlay is placed on the Shell
  UI layer, above normal windows. When off, an approximation is used: the
  overlay is placed in the window layer where stacking can cover it. This is
  best-effort and verified only on 50.x (see `FEASIBILITY.md`).
- **Show on every workspace** (default on): the overlay follows the Shell UI and
  is visible everywhere. When off, it is hidden when the active workspace
  changes away from the workspace where it was opened, and restored when the
  user returns.
- In fullscreen, the overlay stays hidden unless the user explicitly opens it;
  opening it is allowed but it never appears over a fullscreen app on its own.

The two floating settings apply **only** to the floating window. The panel menu
ignores them.

## 10. Non-goals for 1.0

- Automatic paste into the focused application (unreliable on Wayland; often a
  security risk). Manunggal copies; the user pastes.
- Cloud sync, accounts, telemetry, OCR, AI tagging, file clipboard entries.
- A companion app. The architecture leaves room for one, but nothing in the
  core depends on it.
- Creating real `Meta.Window`s. Extensions cannot; the floating window is an
  overlay, and the documentation says so.
