# Risks and mitigations

## Privacy

| Risk | Impact | Mitigation |
|---|---|---|
| Clipboard history contains secrets | Serious | Private mode with one-click pause + hidden list; default 7-day retention; explicit clear; no network code; mode 0600 files; sensitive entries memory-only |
| Password-manager content captured | High | Skip `x-kde-passwordManagerHint` by default; document that it is best-effort; private mode is the reliable control |
| History persists after the user forgets | Medium | Visible item count, retention setting, **Clear history** in menu and prefs, optional clear-on-lock |
| Clipboard written by the extension is re-captured | Low | Checksum suppression; deduplication; no recursion |
| Screen sampling leaks screen content | Medium | Uses the compositor's native picker (one pixel, explicit action); no screenshot stored; no automatic sampling |
| Logs/debug files leak content | High | Never log text, image bytes, or queries. Errors include operation names only. |
| Future companion app reads history | Medium | Documented storage format; the user opts into the app; the extension works without it; file permissions 0600 |

## Accessibility

| Risk | Impact | Mitigation |
|---|---|---|
| Tab/arrow navigation gaps | High | Explicit spatial grid navigation, focus ring, row keyboard shortcuts, Tab fallback |
| Shift+click only multi-select | High | **Select** toggle; Enter toggles; numbered badges; textual count |
| Colour wheel only | Medium | HEX/RGB/RGBA/HSV text fields are equally capable; wheel is an enhancement |
| Tiny targets / hover-only actions | Medium | Actions available in the `⋮`/Menu key; targets ≥ 1.6em; actions mode configurable |
| Text scaling clips layout | High | `em` units, work-area clamps, scrollable content, tested at 0.8/1.0/1.5 |
| Screen reader labels missing | High | Accessible names on every control; roles for tabs/rows; selected state in the label |
| Escape traps focus | Medium | Escape order: clear search → leave select mode → dismiss dialog → close view |

## Platform

| Risk | Impact | Mitigation |
|---|---|---|
| Shell API drift in 45–51 | High | Version-sensitive calls isolated and feature-detected; API headers checked; 50.1 runtime tests; graceful fallback |
| `pick_color` return type differs | Medium | Normalise `ClutterColor`/`CoglColor`/string; unit-test both |
| Image MIME/decode unavailable | Low | Generic placeholder; restore still works; images can be disabled |
| Floating "keep above" unavailable | Medium | UI explains the approximation; fallback to UI layer; never blocks the application |
| Floating overlay in window layer behaves differently | Medium | Verified on 50; guarded; documented; default remains UI layer |
| Workspace semantics | Low | Explicit workspace-index tracking; hide/restore |
| Fullscreen apps hidden/covered | Medium | Never auto-show over fullscreen; explicit open only |
| XWayland/remote clipboard differences | Low | Standard MIME handling; no private formats |
| Performance with 1,750 symbols | Low | Category browsing limits the rendered set; search is indexed over plain arrays; grid rebuilds only on column changes |
| 100-row clipboard rebuild on every store change | Low | Measured at ~230 ms on a mapped view (headless, software rendering); default limit 100, hard cap 500; row reuse is a possible later optimisation |
| Emoji font missing | Low | Tofu, no crash; documented |

## Maintenance

| Risk | Mitigation |
|---|---|
| Generated data rots | Generator scripts committed with exact sources; data version in file header; regeneration is one command |
| UI and prefs settings drift | Single schema; prefs uses the same keys; a startup check can warn on unknown `open-mode` values |
| Large monolithic files | Feature folders; `MainView` routes but does not implement tabs |
| Tests depend on GNOME | Pure core tested in Node; Shell-specific behaviour tested in a headless Shell harness kept outside the shipped extension |
| Translation debt | 1.0 is English-only and ships no catalogs, so `metadata.json` omits `gettext-domain`; strings are concentrated in the UI modules for a later `po/` pass |
| Version claims become stale | Verification ledger updated per release; README states the last runtime-tested version |
