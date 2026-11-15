# Phased implementation plan

The rule for every stage: the extension must still enable, disable, and pass its
checks. A stage that cannot be verified is not marked done.

## Stage 0 — foundation (0.1.0)

**Goal:** a correct, installable extension with a native panel menu, settings,
shortcut, and no feature debt.

Files: `metadata.json`, `extension.js`, `schemas/*`, `src/constants.js`,
`src/services/settings.js`, `src/ui/indicator.js`, minimal `stylesheet.css`.

Checks:
- `glib-compile-schemas --strict` passes.
- Extension enables and disables on 50.1 without warnings.
- Panel icon appears; menu opens/closes; shortcut toggles.
- Disable leaves no actors, settings signals, or keybindings behind.
- `gnome-extensions pack` succeeds.

## Stage 1 — clipboard core and privacy (0.2.0) ← **minimum useful release**

**Goal:** the product is useful without any picker.

Adds: `classify.js`, `search.js`, `clipboardWatcher.js`, `historyStore.js`,
`clipboardTab.js`, `clipboardRow.js`, `searchBar.js`, `toast.js`,
`textEditor.js`, `confirmDialog.js`, privacy header, category filters.

Behaviour: text capture, image capture (best-effort), pin, delete + undo, edit,
accent colour, category override, search within clipboard, scope toggle,
private mode, retention, clear history, app exclusions.

Checks:
- Core classification/search unit tests (Node) pass.
- Text round-trip: copy → appears once → click copies → re-copy does not
  duplicate.
- Image round-trip on 50.1 with a generated PNG; oversized image skipped.
- Private mode: capture paused, list hidden, nothing written; turning it off
  restores the list.
- Restart persists history; retention trims; pinned survives.
- JSON is mode 0600; corrupt file recovery works.
- Keyboard-only path: open, type, Down, Enter, Paste in a text field.
- Screenshot at 1280×800 and 1024×600, text scale 1.0/1.5.

**Ship 0.2.0 after this stage.**

## Stage 2 — emoji and symbols (0.3.0)

Adds: generated data, `emoji.js`, `symbols.js`, `glyphTab.js`, `glyphGrid.js`,
category chips, recents, multi-select (Shift+click + Select toggle).

Checks:
- Data integrity test: no duplicate characters, every group index valid.
- Search: “grin”, “heart”, “flag”, “arrow”, “currency” return sensible hits.
- Shift+click selects in order; badges show 1, 2, 3; copy joins in order.
- Select mode works with keyboard only; Esc exits select mode first.
- Arrow-key spatial navigation reaches every cell in a row/column.
- Copying an emoji closes the view and lands on the clipboard.
- Empty/no-results states.

## Stage 3 — colour (0.4.0)

Adds: `color.js`, `colorTab.js`, `colorWheel.js`, `colorPreview.js`,
`colorSampler.js`, swatches, recents, advanced fields.

Checks:
- Parse/format unit tests: hex 3/4/6/8, rgb/rgba with commas and spaces, hsl,
  clamping, alpha rounding, HSV round-trip.
- Wheel → fields → copy agree; alpha checkerboard renders.
- Invalid fields show an inline error and do not overwrite the last valid value.
- `pick_color` normalisation tested with fake `ClutterColor` and `CoglColor`
  shapes; failure path shows a message and leaves the wheel usable.
- Keyboard-only colour entry and copy.

## Stage 4 — floating window and custom layout (0.5.0)

Adds: `floatingWindow.js`, drag/clamp/reset, workspace tracking, keep-above
layer switch, custom layout controls, floating settings/prefs.

Checks:
- Opens above normal windows; drag stays inside the work area; reset centres.
- Esc closes and returns focus; shortcut toggles; no modal grab.
- Workspace setting off/on hides/restores correctly.
- Keep-above off places the actor in the window layer; fallback is visible in
  the UI if placement fails.
- 92% clamp at 1024×600; header remains reachable; content scrolls.
- Text scale 0.8/1.5 does not clip the header or footer.
- No duplicate search/focus state between panel and floating instances.

## Stage 5 — hardening (1.0.0)

- [x] Localisation audit: no catalogs ship, so `gettext-domain` was removed and
  1.0 is documented as English-only. Strings stay concentrated in the UI
  modules for a later `po/` pass.
- [x] Preferences polish: shortcut field with validation, storage explanation,
  clear actions with confirmation.
- [x] Error handling audit: every async UI call is guarded; every signal has an
  id stored and disconnected.
- [x] Accessibility audit: actor-tree check in the harness (319 buttons, 6
  entries, 0 missing names). No Orca/Accerciser run available.
- [x] Performance measured: menu open with 100 entries 84–92 ms, mapped
  100-row rebuild 225–247 ms, symbol search 10–11 ms, emoji search 12–13 ms
  (headless software rendering).
- [x] Package and install on a clean profile; schema compiles on install.
- [ ] Upgrade from an earlier release with existing history (no earlier release
  exists yet).
- [ ] Runtime testing on GNOME Shell 45–49 and 51.

## Explicitly deferred

- Real `Meta.Window` companion window (needs a separate process; see
  `FEASIBILITY.md`).
- Automatic paste, file clipboard entries, cloud sync, OCR, localisation of the
  emoji dataset, skin-tone variants.
- Highlighted code preview. Classification is already conservative; syntax
  colouring would add a large dependency for little clipboard value.

## Release gates

1. No new runtime dependency.
2. No unguarded async call.
3. No clipboard content in logs, dconf, or error messages.
4. Works with images disabled, sampling unavailable, and floating mode off.
5. `glib-compile-schemas --strict`, core tests, and pack all pass.
6. Version-specific caveats updated in `README.md` and `FEASIBILITY.md`.
