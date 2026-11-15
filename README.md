# Manunggal

Clipboard history, emoji, symbols and colour in one private GNOME panel menu.

Manunggal is a single GNOME Shell extension (`manunggal@lurim412`). It has no
companion process, no network access, and no npm/runtime dependencies. The
default presentation is the native panel menu; an optional floating overlay is
available for people who prefer a movable window.

## Status and verified versions

Version **1.0.1**. Declared support is GNOME Shell **45–51**, but only **50.1**
has been run end to end. The other versions are covered by API review and
defensive coding, not by runtime testing. Do not treat them as guaranteed.

| GNOME Shell | State |
|---|---|
| 45 | Not runtime-verified |
| 46 | Not runtime-verified |
| 47 | Not runtime-verified |
| 48 | Not runtime-verified |
| 49 | Not runtime-verified |
| 50.1 | Verified (Ubuntu, Wayland, GJS 1.88) |
| 51 | Not runtime-verified |

See [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) for the per-API ledger and the
known limits. If you test another version, please report what worked and what
did not.

## Features

- **Clipboard** — card-style entries with a header (kind, relative time, state),
  a nested preview sheet, thumbnails for images, swatches for colours and
  monospaced code. Text, code, emoji and colour entries, plus images when the
  selection offers a standard image MIME type. Pin, delete (with undo), edit,
  assign an accent colour, and override the detected category.
- **Emoji** — 1,898 Unicode Emoji 15.1 entries with English CLDR annotations,
  category chips, search, keyboard navigation, and ordered multi-select
  (Shift+click, or Select mode for keyboard/accessibility users).
- **Symbols** — a curated set of 1,769 monochrome symbols in 13 categories with
  searchable aliases.
- **Colour** — wheel and advanced fields, HEX/RGB/RGBA preview and copy, recent
  and palette swatches, and optional screen sampling through the compositor.
- **Search** — current tab or all tabs, with the scope shown next to the entry.
- **Private mode** — pauses capture and hides the list without deleting it; the
  panel icon becomes a shield.
- **Floating mode** — an optional draggable overlay with keep-above and
  all-workspaces settings, position persistence, and reset.

The 1.0 interface is English-only; no translation catalogs are shipped. See
[`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) §9.

## Install

### From a release bundle

Download `manunggal@lurim412.zip` from the
[latest release](https://github.com/Lurima12/manunggal/releases/latest), then:

```bash
gnome-extensions install --force manunggal@lurim412.zip
```

Log out and back in (Wayland cannot reload the Shell in place), then enable it:

```bash
gnome-extensions enable manunggal@lurim412
```

### From a source checkout

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r manunggal@lurim412 ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/manunggal@lurim412/schemas
```

Log out and back in, then enable the extension. During development a symlink
works too; remember to recompile the schema after editing the XML.

### Build a bundle

```bash
gnome-extensions pack --force \
  --extra-source=src \
  --extra-source=schemas \
  --extra-source=LICENSE \
  --out-dir=dist .
```

The archive is written to `dist/manunggal@lurim412.shell-extension.zip`; the
GitHub release publishes the same archive under the shorter name
`manunggal@lurim412.zip`. `gnome-extensions install` accepts either name and
compiles the schema automatically.

## Use

- Click the panel icon, or press **Super+Shift+V** by default.
- **Ctrl+1…4** switches tabs; **Ctrl+F** focuses search; **Esc** clears search,
  then closes.
- The shortcut is configurable in Preferences → General.
- Copying an entry puts it back on the clipboard. There is no automatic paste;
  on Wayland that would require synthesising input.
- Preferences are available from the menu or with
  `gnome-extensions prefs manunggal@lurim412`.

### Floating mode

Choose **Presentation → Floating window** in Preferences, or set
`open-mode` to `floating`. The overlay:

- opens at 420×560 logical pixels, centred, clamped to 92% of the work area;
- is dragged by its header and remembers its position;
- has **Reset** to re-centre it and **Close** to return to the panel menu;
- can stay above other windows and/or follow every workspace;
- can close when you click outside, if that option is enabled.

This is a Shell-drawn overlay, **not a real application window**. Extensions
cannot create `Meta.Window`s. “Keep above” uses the Shell UI layer; turning it
off moves the overlay to the window layer, where normal window stacking can
cover it. Fullscreen applications may cover it. See
[`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) §4.

## Privacy and storage

- Clipboard history is stored only on your machine:
  - `$XDG_DATA_HOME/manunggal@lurim412/history.json` (default
    `~/.local/share/...`)
  - images beside it in `images/`
  - thumbnails in `$XDG_CACHE_HOME/manunggal@lurim412/thumbs/`
- Directories are created with mode `0700`; files are written with
  `Gio.FileCreateFlags.PRIVATE` (`0600`).
- Defaults: persistence on, 100 entries, 7-day retention, images on
  (5 MiB per image, ~20 MiB total). Pinned entries survive trimming.
- Private mode pauses capture and hides the list without deleting it. It is
  remembered across restarts only if **Remember private mode** is enabled.
- Password-manager content is skipped when the source advertises
  `x-kde-passwordManagerHint`; this is best-effort. Entries marked sensitive are
  kept in memory only by default.
- **Clear history** removes entries and image files. Capture can be disabled
  entirely in Preferences.

Nothing is logged with clipboard contents, sent over the network, or written to
dconf beyond settings.

## Development

Requirements: GNOME Shell 50.1 for the harness, GJS, `glib-compile-schemas`,
and Node 20+ for the pure-core tests.

```bash
# Pure logic tests (classification, search, colour, bundled data)
node --test tests/*.test.mjs

# GSettings schema check
glib-compile-schemas --strict --dry-run schemas

# Headless Shell harness (test-only; not shipped)
./tools/harness/run.sh

# Small work area and large text
MG_TEST_MONITOR=1024x600 ./tools/harness/run.sh
MG_TEST_TEXT_SCALE=1.5 ./tools/harness/run.sh
```

The harness starts an isolated headless Shell, installs the extension and a test
driver, exercises the menu, pickers, privacy mode, keyboard shortcuts and
floating window, then writes `report.json` and screenshots to
`/tmp/opencode/mgtest/out/`.

Repository layout and design decisions are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/SPEC.md`](docs/SPEC.md). Current work is tracked in
[`PROGRESS.md`](PROGRESS.md).

## Troubleshooting

- **Extension does not appear:** confirm the directory is
  `~/.local/share/gnome-shell/extensions/manunggal@lurim412` and that
  `schemas/gschemas.compiled` exists.
- **Settings schema missing:** run
  `glib-compile-schemas ~/.local/share/gnome-shell/extensions/manunggal@lurim412/schemas`.
- **After an update:** log out and back in. On Wayland, `Alt+F2` → `r` is not
  available.
- **Read Shell errors:**
  `journalctl -f -o cat /usr/bin/gnome-shell` (or the session log).
- **Disable:** `gnome-extensions disable manunggal@lurim412`.

## Licence

The extension is licensed under **GPL-2.0-or-later**; see [`LICENSE`](LICENSE).
Bundled Unicode data is covered by the Unicode licence in
[`src/data/LICENSE-UNICODE.txt`](src/data/LICENSE-UNICODE.txt).
