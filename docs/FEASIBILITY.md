# Feasibility and compatibility assessment

This document separates **verified facts** from **source-level expectations** and
**known limits**. A feature is only called "works" for a version after it has run
there. The implementation was exercised on GNOME Shell **50.1** (Ubuntu,
Wayland, GJS 1.88). Versions 45–49 and 51 are covered by source/API review and
defensive coding; they are marked *not runtime-verified*.

## 1. Verification ledger

| Area | 45 | 46 | 47 | 48 | 49 | 50 | 51 | Basis |
|---|---|---|---|---|---|---|---|---|
| ESM extension lifecycle (`Extension`, `getSettings`, `dir`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | API unchanged in Shell sources; run on 50 |
| Panel menu (`PanelMenu.Button`, `PopupMenu`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Constructors/`open()` reviewed 45 and 51 |
| Global shortcut (`Main.wm.addKeybinding`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Run on 50; API unchanged |
| Clipboard text capture (`Meta.Selection`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | `meta-selection-source.h` 45/51; run on 50 |
| Clipboard text restore (`St.Clipboard.set_text`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Header identical 45–51; run on 50 |
| Clipboard image capture/restore | ◐ | ◐ | ◐ | ◐ | ◐ | ✅* | ◐ | *Verified on 50 with a generated PNG* |
| Image thumbnails (`St.TextureCache.load_file_async`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Header signature identical 45–51 |
| Native screen sampling (`Shell.Screenshot.pick_color`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅† | ◐ | †API present; interactive pick cannot run headless |
| Colour wheel (`St.DrawingArea` + Cairo) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Run on 50 |
| Floating overlay (`uiGroup`) | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Run on 50; harness `floating-*` steps |
| Floating overlay in window layer | ? | ? | ? | ? | ? | ✅ | ? | Measured on 50 only; guarded fallback |
| Custom stylesheet / text scaling | ◐ | ◐ | ◐ | ◐ | ◐ | ✅ | ◐ | Run at 0.8/1.0/1.5 on 50 |

Legend: ✅ runtime-verified · ◐ not run here, API reviewed · ? version-sensitive,
needs testing · ✅* / ✅† see notes.

**What "not runtime-verified" means:** the code does not rely on an API that
changed in that release, and version-sensitive calls are feature-detected or
wrapped. It is still not a promise. The README tells users how to report a
version-specific failure.

## 2. Clipboard

### Text

`Meta.Selection` (from `global.display.get_selection()`) emits `owner-changed`
with a `Meta.SelectionSource`. `get_mimetypes()` and `read_async(mimetype)`
exist in Mutter 45 through 51 (headers checked). This is preferable to polling
`St.Clipboard`: it exposes the available MIME types before reading and lets us
skip password-manager content.

`St.Clipboard.set_text(SELECTION_CLIPBOARD, text)` restores text. Setting the
clipboard triggers `owner-changed` again; the watcher suppresses its own write
by checksum.

### Images

- Reading: `selectionSource.read_async('image/png' | 'image/jpeg' | 'image/webp')`.
  Verified on 50 with a PNG copied by the harness.
- Writing: `St.Clipboard.set_content(SELECTION_CLIPBOARD, mimetype, GBytes)`.
  Verified on 50.
- Thumbnails: `GdkPixbuf` decodes and scales; the file is shown with
  `St.TextureCache.load_file_async`. Signature is identical in 45–51.
- Failure modes: remote sessions may not offer an image MIME type; a
  non-decodable image is stored as opaque bytes with a placeholder. If
  `GdkPixbuf` or `TextureCache` is unavailable, only the preview degrades.

**Limit:** an image larger than the configured cap is not stored. The extension
does not transcode or upload it.

### What is not possible / not promised

- There is no reliable "source application" for a clipboard item on Wayland.
  Password-manager detection is MIME-based and best-effort only.
- There is no automatic paste. On Wayland that requires synthesising input or
  grabbing focus; both are fragile and a security risk. Manunggal copies.
- The `x-kde-passwordManagerHint` MIME type is a convention, not a guarantee.
  Some applications do not set it. Private mode remains the dependable control.

## 3. Screen colour sampling

`Shell.Screenshot.pick_color()` is the compositor's native pixel picker. It is
present in 45–51. The return type changed:

| Versions | Return | Normalisation |
|---|---|---|
| 45, 46 | `ClutterColor` (components 0–255) | divide by 255 |
| 47–51 | `CoglColor` (components 0–1 floats) | use as-is |

The implementation reads `red/green/blue/alpha`, then falls back to
`get_red()/get_green()/...`, then to `to_string()`. Values are clamped. If the
call throws (headless, remote, policy change), the Color tab shows an inline
message; nothing else is disabled.

**Restrictions:** sampling captures screen pixels, so it is only offered as an
explicit button press, never automatically. It is not a screenshot: the
extension does not receive or store the screen. In sessions where the Shell
denies the call, sampling is unavailable. The wheel and all text fields remain
the fallback. This cannot be verified interactively in a headless test; the
failure path was verified there.

## 4. Floating window and window-manager semantics

GNOME Shell extensions **cannot create `Meta.Window`s**. There is no supported
API for it in 45–51. A "floating window" is therefore a frameless Shell actor:

- By default it is a child of `Main.layoutManager.uiGroup`: above application
  windows, present on every workspace, not a normal window.
- `Main.pushModal` is **not** used. The overlay does not block other windows and
  does not create a modal grab.
- Focus is moved with `global.stage.set_key_focus`; hiding clears it so the
  previously focused application receives keys again.
- Dragging is implemented with Clutter press/motion/release handlers and
  clamped to `Main.layoutManager.getWorkAreaForMonitor`.
- Sizes are clamped to 92% of the work area; position is clamped on every show
  and on monitor changes.

Verified on 50.1 (headless, 1280×768 work area, harness steps `floating-open`
through `floating-close`):

| Check | Observed |
|---|---|
| Default geometry | 420×560 at (430, 136), fully inside the work area |
| Size clamp | 1200×1200 request → 1178×707 (92% of the work area) |
| Drag | Header drag moved the window; motion past the edge was clamped; the resulting position was persisted to GSettings |
| Reset | Re-centred at (430, 136), matching the computed centre |
| Keep above on | Parent is `Main.layoutManager.uiGroup` |
| Keep above off | Parent is `global.window_group`; no fallback was needed |
| All workspaces on | Visible after workspace change |
| All workspaces off | Hidden when the tracked opening workspace is not active, visible again on return |
| Close outside | `captured-event` handler is connected and removed with the setting |
| Close | Actor detached and destroyed, focus cleared, the shared view returns to the panel menu, and the menu opens normally afterwards |
| Keyboard | `Ctrl+1…4` switches tabs, `Ctrl+F` focuses search (switching away from Color first), `Esc` closes the overlay |
| 1024×600 work area | Requested 420×560 → 420×523; header, content and footer all inside the window |
| Text scale 1.5 | 420×560 fits; the footer stays inside the overlay |

Layout is measured rather than assumed: the header's themed height and the
overlay border are subtracted from the requested size, and the view subtracts
its own padding before allocating the content area. This keeps the footer
inside the overlay at small work areas and large text scales.

The fallback path (`global.window_group` missing) cannot be triggered on a
normal session; it is guarded and leaves the overlay on the UI layer.

### The two floating settings

| Setting | Implemented behaviour | Limitation |
|---|---|---|
| Keep above other windows | On: `uiGroup` (truly above). Off: actor is placed in `global.window_group`, where normal window stacking can cover it. | This is a best-effort approximation of a normal window. It is verified on 50 only. If a future Shell changes the window group, the extension falls back to the UI layer and the preference is shown as unavailable. |
| Show on every workspace | On: visible on all workspaces. Off: hidden when the active workspace changes away from the workspace where it was opened; restored on return. | Shell-drawn chrome is global by nature; "off" is implemented by explicit visibility tracking, not by attaching the actor to a Meta workspace. |

Fullscreen applications: the overlay is not shown automatically over fullscreen
windows. The user can still open it deliberately.

### Why no helper process

A bundled GTK process could create a real window and use
`set_keep_above()`/`stick()`. That would add a second process, a private IPC
protocol, packaging and security surface, and would make the core depend on it.
It is out of scope. A future companion app can provide a real window without
changing the extension's data model (see `ARCHITECTURE.md`).

## 5. Emoji and symbols

- No emoji annotation database is guaranteed to be installed. Bundling data is
  the only dependable route.
- The extension bundles **Unicode Emoji 15.1** (1,898 fully-qualified entries
  without skin-tone duplicates) and English CLDR annotations. Emoji 15.1 is
  chosen because the Noto Color Emoji font shipped with GNOME 45 already
  understands it.
- Rendering uses the system emoji font through `St.Label`. If the font is
  missing, glyphs render as tofu; nothing crashes. The extension does not bundle
  a font (it would be tens of megabytes and duplicate the system).
- Symbols are a curated monochrome set (1,750 entries, 12 categories) generated
  from the Unicode Character Database, with human aliases for common searches.
- Search uses a pure-JS scorer shared by both tabs, so it is unit-tested without
  a Shell.

## 6. Shell API differences that matter

| Change | Impact | Handling |
|---|---|---|
| `Shell.Screenshot.pick_color` returns `ClutterColor` in 45/46, `CoglColor` in 47+ | Naive `.red * 255` would be wrong in 47+ | Normalise both shapes; test both code paths with fake objects |
| `St.ImageContent.set_bytes` gained a `CoglContext` argument | A single signature does not compile/run everywhere | Not used; thumbnails go through `St.TextureCache` |
| `PopupMenu.open()` gained an optional params object in 51 | No-arg calls still work | Always call `open()` with no arguments |
| GNOME 45 introduced ESM extensions | Older `imports.*` style is invalid | Pure ESM, `export default class extends Extension` |
| `St.TextureCache` was reorganised between releases | Signature could drift | Header-checked 45–51; call wrapped in try/catch, placeholder on failure |
| Shell 51 changes key controller internals | `menu` handles keys itself | Our key handling sits on our own view/actors, not Shell internals |

## 7. Known unsupported or degraded cases

1. **Interactive screen sampling** in headless/remote sessions → inline error.
2. **Always-on-top off** is an approximation, not a real normal window.
3. **Password-manager detection** is best-effort.
4. **Emoji skin-tone variants** are intentionally not listed; the base emoji is.
5. **Localised emoji names and UI strings** are English-only in 1.0. No
   translation catalogs are shipped, so `metadata.json` deliberately omits
   `gettext-domain`; adding one without a `locale/` tree would only promise
   translations that do not exist. The data format can accept more locales
   later, and the strings are collected in the UI modules for a future pass.
6. **Text larger than 256 KiB** and **images larger than 5 MiB** are skipped.
7. **Clipboard content from XWayland apps** is visible through the same
   selection mechanism, but behaviour depends on the app advertising a standard
   MIME type. Non-standard private formats are not interpreted.

## 8. Performance measurements

Measured on GNOME Shell 50.1 headless, 1280×800 virtual monitor, GJS 1.88,
software rendering. The harness step `performance` records these in
`report.json` under `timings`; the ranges below are from four runs (default,
1024×600 and text scale 1.5). Treat them as an upper bound for
hardware-accelerated sessions, not as a benchmark.

| Operation | Best | Median | Mean | Notes |
|---|---|---|---|---|
| Menu open with 100 entries | — | — | 96–103 | Click/`open()` to the popup's `open-state-changed`, including the first card build |
| One 100-row rebuild on a mapped view (`refresh()`) | — | — | 244–283 | Single timed rebuild per run; destroys and recreates 100 cards |
| Symbol search over 1,769 items | 8.0–10.6 | 8.6–11.8 | 11.2–13.3 | Pure scorer, query `arrow`, limit 400 |
| Emoji search over 1,898 items | 10.6–12.5 | 11.9–15.1 | 13.1–15.0 | Pure scorer, query `heart`, limit 400 |

Opening the menu with a full history costs roughly 100 ms on this
software-rendered setup, which includes building the 100 cards. Rebuilding the
whole list while it is already mapped costs about 250–280 ms, so actions that
change the store while the menu is open (pin, delete, category change) are the
expensive path. The default limit is 100 entries and the hard cap is 500; at 500
rows the cost scales roughly linearly, which is why the cap exists. Search is
cheap enough to run on every keystroke.

## 9. Localisation status

The 1.0 UI and the bundled emoji/symbol annotations are **English-only**. This
is intentional and recorded in `metadata.json` by *not* declaring a
`gettext-domain`: no `.mo` catalogs exist, and declaring a domain without
shipping them would advertise translations that cannot load.

The audit found:

- no `gettext-domain` mismatch (removed);
- no untranslated runtime string is built from a placeholder whose word order
  depends on the locale — the few multi-line literals are complete English
  sentences joined with explicit spaces;
- user-visible strings live in `extension.js`, `prefs.js` and `src/ui/**`, with
  no strings in `src/core` or `src/services` (those return data, not labels).

A future localisation pass should add `po/`, wrap the strings with
`this.gettext()`/`ngettext()` (or a shared helper bound to the extension
domain), and pack with `--podir=po --gettext-domain=manunggal@lurim412`.
