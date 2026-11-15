# Architecture

## 1. Shape

```
extension.js                     lifecycle, wiring, keybinding, error boundary
prefs.js                         Adw preferences (separate process)
metadata.json
stylesheet.css                   namespaced .manunggal-* styles only
schemas/…gschema.xml             settings, all keys and defaults

src/
  constants.js                   UUID, paths, limits, palette
  core/                          no Shell imports; unit-testable
    color.js                     parse / format / HSV, pure
    classify.js                  text → color | emoji | code | text, pure
    search.js                    tokenizer + scorer, pure
    emoji.js                     EMOJI data → items, categories, search
    symbols.js                   SYMBOL data → items, "popular", search
    categories.js                clipboard category ids and icons
  services/
    settings.js                  typed wrapper + signal bookkeeping
    clipboardWatcher.js          Meta.Selection, size caps, dedupe
    historyStore.js              JSON persistence, images, trimming
    colorSampler.js              Shell.Screenshot.pick_color normalisation
  ui/
    indicator.js                 PanelMenu.Button + menu hosting + geometry
    mainView.js                  header, search, tabs, privacy, routing
    floatingWindow.js            overlay, drag, clamp, focus, workspace logic
    toast.js                     in-view transient status
    confirmDialog.js             modal confirmation
    textEditor.js                modal multi-line editor
    tabs/clipboardTab.js
    tabs/glyphTab.js             shared by Emoji and Symbol
    tabs/colorTab.js
    widgets/searchBar.js
    widgets/clipboardRow.js
    widgets/glyphGrid.js
    widgets/colorWheel.js
    widgets/colorPreview.js
    widgets/swatchRow.js
    widgets/emptyState.js
    widgets/segmented.js
  data/
    emojiData.js                 generated, Unicode 15.1 + CLDR
    symbolData.js                generated, curated Unicode
    palette.js                   Adwaita colour palette
    LICENSE-UNICODE.txt
```

Boundaries:

- `core/*` must not import `gi://St` or Shell resources. It can be imported by
  Node tests.
- `services/*` may use GLib/Gio/Meta/Shell but no `St` widgets.
- `ui/*` may use `St`, `Clutter`, and Shell `PopupMenu`. UI talks to services;
  services never import UI.
- `extension.js` is the only place that constructs the graph and owns teardown.
- `prefs.js` shares only the GSettings schema with the extension. It never
  imports runtime modules.

## 2. Runtime graph

```
Extension
├─ Settings (GSettings wrapper)
├─ HistoryStore ──────────────┐
├─ ClipboardWatcher ──────────┤ (adds entries)
├─ ColorSampler               │
├─ Indicator (panel)          │
│   └─ MainView ◀─────────────┘
│       ├─ ClipboardTab  (reads store, subscribes 'changed')
│       ├─ GlyphTab(emoji)
│       ├─ GlyphTab(symbol)
│       ├─ ColorTab      (ColorSampler, recents)
│       └─ SearchResults (All scope)
└─ FloatingWindow (lazy; reuses MainView definition)
```

`MainView` is a factory: the panel creates one instance in the PopupMenu; the
floating window creates a second instance. Both share the same store, settings,
and services. State that must be unique (search query, select mode) lives in
`MainView`, not in the services.

Alternatively the floating window moves the single view between parents. That
avoids duplicate actors but makes reparenting/focus brittle across versions.
Two instances with shared models is simpler and predictable; the cost is one
extra idle view when floating mode is on.

## 3. Lifecycle

```
enable()
  settings = new Settings(this)
  store = new HistoryStore(settings); store.init()        // async, UI shows loading
  watcher = new ClipboardWatcher(settings, store)
  watcher.start()
  indicator = new Indicator(ext)                          // builds MainView
  Main.panel.addToStatusArea(uuid, indicator, 0, 'right')
  keybinding registered from 'toggle-shortcut'
  if open-mode == floating → floating = new FloatingWindow(ext) (built lazily)
  connect settings changes that need live rebuild (layout mode, panel visibility)

disable()
  removeKeybinding
  floating?.destroy()
  indicator.destroy()
  watcher.destroy()
  store.flush()                                           // last chance, sync
  store.destroy()
  settings.destroy()
```

Every optional subsystem (images, sampler, floating layer) is initialised inside
`try/catch`; a failure logs once and disables that subsystem, not the extension.
`disable()` is idempotent and never assumes an object exists.

## 4. Clipboard data flow

```
Meta.Selection 'owner-changed'
  → SELECTION_CLIPBOARD only
  → source.get_mimetypes()
  → skip if x-kde-passwordManagerHint (setting) or wm_class excluded
  → read image (preferred) or text with a byte cap
  → compute checksum; if it is our own write, stop
  → classify text (color / emoji / code / text)
  → store.add({kind, text|bytes, category, ...})
      → dedupe: same checksum → touch existing entry
      → trim: expiry + item cap + byte caps (pinned exempt)
      → write image once by checksum
      → schedule debounced JSON save
  → emit 'changed' → ClipboardTab re-renders (only if visible)
```

Copying an entry:

```
clipboard.set_text / set_content
  → remember checksum in watcher._expected
  → touch entry (lastUsedAt)
  → close view (setting) / toast
```

`HistoryStore.add` is synchronous in memory; disk writes are debounced (1.5 s)
and atomic (write temp file, then replace, mode 0600). Images are written before
the JSON references them; orphan files are removed on trim/clear and at startup.

## 5. Storage format

`history.json`:

```json
{
  "version": 1,
  "nextId": 42,
  "entries": [
    {
      "id": 41,
      "kind": "text",
      "text": "…",
      "category": "code",
      "categoryOverride": null,
      "pinned": false,
      "sensitive": false,
      "accent": null,
      "createdAt": 1710000000000,
      "lastUsedAt": 1710000000000
    },
    {
      "id": 40,
      "kind": "image",
      "mimetype": "image/png",
      "image": "ab12….png",
      "width": 800,
      "height": 600,
      "bytes": 48321,
      "category": "image",
      "pinned": true,
      "createdAt": 1710000000000,
      "lastUsedAt": 1710000000000
    }
  ]
}
```

Rules:

- Text is stored as-is, up to `max-text-bytes` (UTF-8). Oversized content is
  ignored rather than truncated, so a copied item is never silently altered.
- `categoryOverride` wins over automatic classification and survives reload.
- `sensitive` entries are never serialised (default) and are dropped on reload.
- Missing/corrupt JSON is moved aside to `history.corrupt-<timestamp>.json` and
  the store starts empty; the user is told once in Preferences.
- Unknown fields are preserved on rewrite where practical (forward compatibility
  for a future companion app).

## 6. Settings groups

| Prefix | Keys |
|---|---|
| general | `toggle-shortcut`, `open-mode`, `remember-last-tab`, `last-tab`, `close-after-copy`, `layout-mode`, `view-width`, … |
| clipboard | `clipboard-enabled`, `capture-images`, `max-items`, `retention-days`, `persist-history`, `ignore-password-manager`, `excluded-apps`, `sync-primary`, `clear-on-lock`, `sensitive-persist` |
| privacy | `privacy-remember` |
| layout | `layout-mode`, `custom-*` |
| floating | `floating-width`, `floating-height`, `floating-keep-above`, `floating-all-workspaces`, `floating-close-outside`, `floating-x`, `floating-y` |
| pickers | `emoji-separator`, `symbol-separator`, `recent-emoji`, `recent-symbols` |
| color | `color-format`, `hex-uppercase`, `recent-colors` |

GSettings stores only small values. Clipboard content never goes into dconf.
`recent-*` arrays are bounded (24 entries).

## 7. Companion-app path

Nothing in the core assumes a companion. If one is added later:

- It reads the same `history.json` versioned schema and image directory, using
  the documented format above. The extension remains the writer while enabled;
  the app should open read-only or use a single-instance handoff.
- It provides bulk management, import/export, and a real resizable window with
  proper `Meta.Window` semantics.
- Settings remain in GSettings, so both processes share them without a new
  protocol.
- The extension does not spawn the app and works if it is absent.

This is why storage is a documented file format rather than an opaque in-memory
blob or a private database.

## 8. Dependency policy

Runtime dependencies: GNOME Shell, Mutter, GLib/Gio, GJS, GdkPixbuf, Cairo, and
the system emoji font. All of these are part of a GNOME desktop.

No npm packages, no highlight.js downloads, no Gtk/Granite, no D-Bus service, no
network. The two data files are generated at development time and committed.
The only tooling dependencies are Node (data generation + core tests) and
Python 3 (symbol data), neither of which ships to users.
