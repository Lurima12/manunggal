# PROGRESS.md

## Project Overview
- **Name:** Manunggal (`manunggal@lurim412`)
- **Goal:** A privacy-conscious GNOME Shell extension that unifies clipboard history, emoji, symbols and colour tools in a native panel menu.
- **Tech stack:** GJS / GNOME Shell ESM, St/Clutter, GSettings; Node only for pure-core tests.
- **Target versions:** GNOME Shell 45–51 (only 50.1 is available locally).

## Current Status
- [x] Design docs: `docs/SPEC.md`, `FEASIBILITY.md`, `ARCHITECTURE.md`, `PLAN.md`, `RISKS.md`.
- [x] Generated data: 1,898 emoji, 1,769 symbols, Unicode licence.
- [x] Pure core modules and 32 Node tests (classification, search, colour, data integrity).
- [x] GSettings schema; `glib-compile-schemas --strict` passes.
- [x] Services: settings, history store, clipboard watcher, colour sampler.
- [x] Panel menu UI: clipboard, emoji, symbol, colour tabs; search; privacy mode; dialogs.
- [x] Responsive glyph/swatch layout using `WrapGrid`, square colour wheel, constrained tab height.
- [x] Preferences window and configurable global shortcut.
- [x] Floating-window mode: drag, position persistence, reset, work-area clamp, keep-above layer, workspace visibility, click-outside close.
- [x] Keyboard shortcuts: `Ctrl+1…4`, `Ctrl+F`, `Ctrl+,`, and `Esc` closing the menu/overlay.
- [x] Harness: 27 steps including floating open/close, geometry, drag, layer, workspaces, keyboard, dialogs, accessibility, performance, screenshots.
- [x] Card-style clipboard items: header (kind/time/badges), nested preview sheet, thumbnails, colour swatches, monospaced code, pill search field and Clear button; actions on hover/focus by default.
- [x] Harness seeds text, code, colour and a generated PNG so the card variants are exercised and screenshotted.
- [x] Harness variants pass at 1024×600 and text scale 1.5; floating header/footer stay inside.
- [x] `README.md` with install, pack, privacy and verified-version matrix.
- [x] Async/signal cleanup audit: UI awaits guarded; global signals disconnected; outside-click close deferred out of event dispatch.
- [x] Accessibility audit: 319 buttons, 6 entries, 0 missing accessible names; all focusable actors enumerated (no Orca/Accerciser run).
- [x] Dialog theming: confirmation/editor dialogs inherit `popup-menu-content`; harness verifies a solid background and cancels cleanly.
- [x] Clean-profile bundle install into a temporary HOME; schema compiles on install.
- [x] Performance measured on 50.1 across four runs: menu open with 100 entries 96–103 ms, mapped 100-card rebuild 244–283 ms, symbol search 11–13 ms, emoji search 13–15 ms (headless software rendering).
- [x] Localisation audit: `gettext-domain` removed because no catalogs ship; UI/data documented as English-only 1.0.
- [ ] Runtime-verify versions 45–49 and 51.
- [ ] Verify interactive colour sampling on versions 45–49/51.
- [x] Initial commit on `main` with author identity taken from the connected GitHub account (`Lurima12`, GitHub noreply address); no invented values.
- [x] Published to https://github.com/Lurima12/manunggal (public).
- [x] `LICENSE` (GPL-2.0), metadata `url`/`version-name`, and README version aligned; `v1.0.1` release bundle includes the licence.

## Architecture & Conventions
- **Entry points:** `extension.js`, `prefs.js`; source under `src/{core,data,services,ui}`.
- **Boundaries:** pure logic in `src/core` (Node-testable); Shell APIs in `src/services`; widgets/tabs in `src/ui`.
- **Patterns:** composition over GObject subclassing, optional callbacks for inter-tab actions, all settings/signal IDs stored and disconnected.
- **Floating mode:** one shared `MainView` reparented between the panel menu and a Shell actor; `indicator.detachView()`/`attachView()` own the menu side.
- **Sizing:** CSS in em; `WrapGrid` positions cells manually in a `Clutter.FixedLayout` because `FlowLayout` misallocates after resize. Floating chrome is measured from theme nodes, not hard-coded.
- **Tooling:**
  - Tests: `~/.nvm/versions/node/v26.13.0/bin/node --test tests/*.test.mjs`
  - Schema: `glib-compile-schemas --strict --dry-run schemas`
  - Harness: `./tools/harness/run.sh` (temp profiles; report in `/tmp/opencode/mgtest/out`)
  - Variants: `MG_TEST_MONITOR=1024x600`, `MG_TEST_TEXT_SCALE=1.5`

## Known Issues / Caveats
- On GNOME 50.1, first mapping of the Color tab emits five pairs of `clutter_input_focus_set_cursor_location`/`set_surrounding` assertions. Functional tests pass; source is inside Clutter's focus handling, not reproduced by the extension's focus or visibility code. Document as unverified/benign until reproduced on another version.
- Only GNOME Shell 50.1 has been run. Claims for 45–49/51 remain unverified.
- The floating overlay can never be a real `Meta.Window`; keep-above and all-workspaces are approximations (see `docs/FEASIBILITY.md`).
- The `global.window_group` fallback (when keep-above is off and the window group is missing) cannot be triggered on a normal session; it is guarded.
- Focus return on close is verified as `set_key_focus(null)`; behaviour with a real application window has not been exercised headless.
- `docs/PLAN.md` Stage 5 hardening is now covered (async/signal audit, accessibility names, dialog theming, performance, localisation decision); only cross-version runtime testing remains.
- The harness is a development tool and is not part of the installable extension.

## Exact Next Step
Cross-version work (45–49, 51) stays blocked until those Shell versions are
available. Before future pushes, configure your own GitHub credential for
`git@github.com:Lurima12/manunggal.git` (or switch the remote to HTTPS); the
temporary deploy key used for the initial publish was revoked.
