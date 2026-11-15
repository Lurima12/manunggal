// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
} from 'resource:///org/gnome/shell/extensions/prefs.js';

import {EXTENSION_NAME, UUID} from './src/constants.js';

function addSwitch(group, settings, key, title, subtitle = null) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

function addSpin(group, settings, key, title, subtitle, lower, upper, step = 1) {
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: Math.max(step, (upper - lower) / 10),
    });
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment,
        climb_rate: step,
        digits: 0,
    });
    row.set_value(settings.get_int(key));
    row.connect('notify::value', () => {
        const value = Math.round(row.get_value());
        if (settings.get_int(key) !== value)
            settings.set_int(key, value);
    });
    group.add(row);
    return row;
}

function addCombo(group, settings, key, title, options, subtitle = null) {
    const row = new Adw.ComboRow({title, subtitle});
    row.set_model(Gtk.StringList.new(options.map(option => option.label)));
    const current = options.findIndex(option => option.value === settings.get_string(key));
    row.set_selected(current < 0 ? 0 : current);
    row.connect('notify::selected', () => {
        const option = options[row.get_selected()];
        if (option && settings.get_string(key) !== option.value)
            settings.set_string(key, option.value);
    });
    group.add(row);
    return row;
}

function toast(window, message) {
    if (typeof window.add_toast === 'function')
        window.add_toast(new Adw.Toast({title: message, timeout: 4}));
}

function clearDirectory(path) {
    const dir = Gio.File.new_for_path(path);
    if (!dir.query_exists(null))
        return;
    try {
        const enumerator = dir.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const child = dir.get_child(info.get_name());
            try {
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    clearDirectory(child.get_path());
                child.delete(null);
            } catch {
                // Best effort; the extension also cleans its own files.
            }
        }
        enumerator.close(null);
    } catch {
        // Ignore inaccessible directories.
    }
}

function storagePaths() {
    const data = GLib.build_filenamev([GLib.get_user_data_dir(), UUID]);
    const cache = GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, 'thumbs']);
    return {
        data,
        history: GLib.build_filenamev([data, 'history.json']),
        images: GLib.build_filenamev([data, 'images']),
        cache,
    };
}

export default class ManunggalPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_title(EXTENSION_NAME);
        window.set_default_size(680, 760);

        window.add(this._generalPage(settings, window));
        window.add(this._clipboardPage(settings, window));
        window.add(this._layoutPage(settings));
        window.add(this._floatingPage(settings, window));
        window.add(this._pickersPage(settings, window));
        window.add(this._colorPage(settings, window));
        window.add(this._privacyPage(settings, window));
    }

    _generalPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });

        const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
        page.add(behaviour);

        addCombo(behaviour, settings, 'open-mode', 'Presentation', [
            {value: 'menu', label: 'Panel menu (native)'},
            {value: 'floating', label: 'Floating window (overlay)'},
        ], 'Floating mode is drawn by the Shell, not a real window.');

        const shortcut = new Adw.EntryRow({title: 'Global shortcut'});
        shortcut.set_text(settings.get_strv('toggle-shortcut')[0] ?? '');
        shortcut.set_show_apply_button(true);
        shortcut.connect('apply', () => {
            const value = shortcut.get_text().trim();
            if (!/^(<[^>]+>)+[^<>]+$/.test(value)) {
                toast(window, 'Use accelerator syntax such as <Super><Shift>v.');
                shortcut.set_text(settings.get_strv('toggle-shortcut')[0] ?? '');
                return;
            }
            settings.set_strv('toggle-shortcut', [value]);
            toast(window, 'Shortcut updated.');
        });
        behaviour.add(shortcut);

        addSwitch(behaviour, settings, 'remember-last-tab', 'Remember the last tab');
        addSwitch(behaviour, settings, 'close-after-copy', 'Close after copying');
        addSwitch(behaviour, settings, 'detect-categories',
            'Detect colours, emoji and code',
            'Classify clipboard entries to power filters and suggestions.');

        const welcome = new Adw.ActionRow({
            title: 'Welcome message',
            subtitle: 'Show the first-run hint again on the next open.',
        });
        const welcomeButton = new Gtk.Button({
            label: 'Show again',
            valign: Gtk.Align.CENTER,
        });
        welcomeButton.connect('clicked', () => {
            settings.set_boolean('first-run', true);
            toast(window, 'The welcome message will appear on the next open.');
        });
        welcome.add_suffix(welcomeButton);
        behaviour.add(welcome);

        return page;
    }

    _clipboardPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'Clipboard',
            icon_name: 'edit-paste-symbolic',
        });

        const capture = new Adw.PreferencesGroup({
            title: 'Capture',
            description: 'Manunggal reads the clipboard only when its owner changes.',
        });
        page.add(capture);
        addSwitch(capture, settings, 'clipboard-enabled', 'Save clipboard history');
        addSwitch(capture, settings, 'capture-images', 'Capture images',
            'PNG, JPEG and WebP up to the size limit below.');
        addSwitch(capture, settings, 'ignore-password-manager', 'Ignore password-manager content',
            'Skips content advertising x-kde-passwordManagerHint. Best effort only.');
        addSwitch(capture, settings, 'detect-categories', 'Detect colours, emoji and code',
            'Wrong guesses can be changed from an item’s action menu.');
        addSwitch(capture, settings, 'sync-primary', 'Also write copied text to the primary selection');

        const exclusions = new Adw.EntryRow({
            title: 'Excluded applications',
        });
        exclusions.set_text(settings.get_strv('excluded-apps').join(', '));
        exclusions.set_show_apply_button(true);
        exclusions.connect('apply', () => {
            const values = exclusions.get_text()
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
            settings.set_strv('excluded-apps', values);
            toast(window, values.length
                ? 'Application exclusions updated.'
                : 'Application exclusions cleared.');
        });
        capture.add(exclusions);
        capture.add(new Adw.ActionRow({
            title: 'Exclusion format',
            subtitle: 'Comma-separated window WM classes, for example firefox, org.gnome.Nautilus.',
        }));

        const limits = new Adw.PreferencesGroup({title: 'Limits and retention'});
        page.add(limits);
        addSpin(limits, settings, 'max-items', 'Maximum entries', null, 10, 500, 10);
        addSpin(limits, settings, 'retention-days', 'Retention (days)',
            '0 keeps entries until the entry limit is reached.', 0, 3650, 1);
        addSpin(limits, settings, 'max-text-bytes', 'Maximum text size (bytes)',
            'Larger items are ignored.', 4096, 1048576, 4096);
        addSpin(limits, settings, 'max-image-bytes', 'Maximum image size (bytes)',
            'Images are also limited to 20 MiB in total.', 262144, 20971520, 262144);

        const privacy = new Adw.PreferencesGroup({title: 'Sensitive content'});
        page.add(privacy);
        addSwitch(privacy, settings, 'persist-history', 'Save history across sessions',
            'When off, saved text and images are deleted.');
        addSwitch(privacy, settings, 'sensitive-persist', 'Save items marked sensitive',
            'Off by default: sensitive items stay in memory and expire with the session.');
        addSwitch(privacy, settings, 'clear-on-lock', 'Clear history when the screen locks');
        addSwitch(privacy, settings, 'confirm-clear', 'Confirm before clearing history');

        return page;
    }

    _layoutPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Layout',
            icon_name: 'view-grid-symbolic',
        });

        const mode = new Adw.PreferencesGroup({
            title: 'Layout mode',
            description: 'All sizes use em units, so GNOME text scaling enlarges the whole view.',
        });
        page.add(mode);
        addCombo(mode, settings, 'layout-mode', 'Mode', [
            {value: 'detailed', label: 'Detailed'},
            {value: 'compact', label: 'Compact'},
            {value: 'custom', label: 'Custom'},
        ]);
        addSpin(mode, settings, 'view-width', 'Menu width (px)',
            '0 uses the automatic width (27em). Range 280–600 when set.', 0, 600, 20);
        addCombo(mode, settings, 'search-scope', 'Search scope', [
            {value: 'tab', label: 'This tab'},
            {value: 'all', label: 'All tabs'},
        ]);

        const custom = new Adw.PreferencesGroup({
            title: 'Custom mode',
            description: 'These controls only apply when Layout mode is Custom.',
        });
        page.add(custom);
        addSpin(custom, settings, 'custom-preview-lines', 'Preview lines', null, 1, 4, 1);
        addSwitch(custom, settings, 'custom-show-meta', 'Show metadata');
        addCombo(custom, settings, 'custom-show-actions', 'Row actions', [
            {value: 'always', label: 'Always visible'},
            {value: 'hover', label: 'On hover and focus'},
            {value: 'menu', label: 'In the item menu'},
        ]);
        addSwitch(custom, settings, 'custom-tab-labels', 'Show tab labels');
        addCombo(custom, settings, 'custom-density', 'Density', [
            {value: 'comfortable', label: 'Comfortable'},
            {value: 'compact', label: 'Compact'},
        ]);
        addCombo(custom, settings, 'custom-glyph-size', 'Emoji and symbol size', [
            {value: 'small', label: 'Small'},
            {value: 'medium', label: 'Medium'},
            {value: 'large', label: 'Large'},
        ]);
        addSwitch(custom, settings, 'custom-show-chips', 'Show category chips');

        return page;
    }

    _floatingPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'Floating window',
            icon_name: 'window-new-symbolic',
        });

        const note = new Adw.PreferencesGroup({
            title: 'About floating mode',
            description: 'The floating window is a Shell overlay, not a real application ' +
                'window. It cannot appear over fullscreen apps unless you open it after ' +
                'they are fullscreen. “Keep above” and “all workspaces” are best effort.',
        });
        page.add(note);

        const geometry = new Adw.PreferencesGroup({title: 'Size and position'});
        page.add(geometry);
        addSpin(geometry, settings, 'floating-width', 'Width (px)', null, 300, 1200, 10);
        addSpin(geometry, settings, 'floating-height', 'Height (px)', null, 320, 1200, 10);

        const position = new Adw.ActionRow({
            title: 'Position',
            subtitle: this._positionLabel(settings),
        });
        const reset = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        reset.connect('clicked', () => {
            settings.set_int('floating-x', -1);
            settings.set_int('floating-y', -1);
            position.set_subtitle(this._positionLabel(settings));
            toast(window, 'The floating window will open centred.');
        });
        position.add_suffix(reset);
        geometry.add(position);

        const stacking = new Adw.PreferencesGroup({title: 'Stacking and workspaces'});
        page.add(stacking);
        addSwitch(stacking, settings, 'floating-keep-above', 'Keep above other windows',
            'Best effort: uses the Shell UI layer when on, the window layer when off.');
        addSwitch(stacking, settings, 'floating-all-workspaces', 'Show on every workspace',
            'When off, the overlay is hidden while another workspace is active.');
        addSwitch(stacking, settings, 'floating-close-outside', 'Close when clicking outside');

        return page;
    }

    _positionLabel(settings) {
        const x = settings.get_int('floating-x');
        const y = settings.get_int('floating-y');
        return x < 0 || y < 0 ? 'Centred on the active monitor' : `X ${x}, Y ${y}`;
    }

    _pickersPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'Pickers',
            icon_name: 'face-smile-symbolic',
        });

        const emoji = new Adw.PreferencesGroup({title: 'Emoji'});
        page.add(emoji);
        addCombo(emoji, settings, 'emoji-separator', 'Separator for multiple emoji', [
            {value: 'none', label: 'None'},
            {value: 'space', label: 'Space'},
        ]);
        const clearEmoji = new Adw.ActionRow({
            title: 'Recent emoji',
            subtitle: `${settings.get_strv('recent-emoji').length} stored`,
        });
        const clearEmojiButton = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
        clearEmojiButton.connect('clicked', () => {
            settings.set_strv('recent-emoji', []);
            clearEmoji.set_subtitle('0 stored');
        });
        clearEmoji.add_suffix(clearEmojiButton);
        emoji.add(clearEmoji);

        const symbols = new Adw.PreferencesGroup({title: 'Symbols'});
        page.add(symbols);
        addCombo(symbols, settings, 'symbol-separator', 'Separator for multiple symbols', [
            {value: 'space', label: 'Space'},
            {value: 'none', label: 'None'},
        ]);
        const clearSymbols = new Adw.ActionRow({
            title: 'Recent symbols',
            subtitle: `${settings.get_strv('recent-symbols').length} stored`,
        });
        const clearSymbolsButton = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
        clearSymbolsButton.connect('clicked', () => {
            settings.set_strv('recent-symbols', []);
            clearSymbols.set_subtitle('0 stored');
        });
        clearSymbols.add_suffix(clearSymbolsButton);
        symbols.add(clearSymbols);

        return page;
    }

    _colorPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'Colour',
            icon_name: 'color-select-symbolic',
        });

        const copy = new Adw.PreferencesGroup({title: 'Copy format'});
        page.add(copy);
        addCombo(copy, settings, 'color-format', 'Preferred format', [
            {value: 'hex', label: 'HEX'},
            {value: 'rgb', label: 'RGB'},
            {value: 'rgba', label: 'RGBA'},
        ]);
        addSwitch(copy, settings, 'hex-uppercase', 'Uppercase HEX values');

        const recent = new Adw.ActionRow({
            title: 'Recent colours',
            subtitle: `${settings.get_strv('recent-colors').length} stored`,
        });
        const clearRecent = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER});
        clearRecent.connect('clicked', () => {
            settings.set_strv('recent-colors', []);
            recent.set_subtitle('0 stored');
        });
        recent.add_suffix(clearRecent);
        copy.add(recent);

        const sampling = new Adw.PreferencesGroup({
            title: 'Screen sampling',
            description: 'Sampling asks the compositor for one pixel at a time. It never captures ' +
                'or saves a screenshot. Remote and headless sessions may deny it; the wheel and ' +
                'numeric fields always remain available.',
        });
        page.add(sampling);
        addSwitch(sampling, settings, 'color-sampling-enabled', 'Allow picking a colour from the screen');

        return page;
    }

    _privacyPage(settings, window) {
        const page = new Adw.PreferencesPage({
            title: 'Privacy',
            icon_name: 'channel-secure-symbolic',
        });

        const privateMode = new Adw.PreferencesGroup({title: 'Private mode'});
        page.add(privateMode);
        const row = new Adw.SwitchRow({
            title: 'Private mode',
            subtitle: 'Pauses capture and hides history. Nothing is deleted.',
        });
        row.set_active(settings.get_boolean('private-mode'));
        row.connect('notify::active', () => {
            if (settings.get_boolean('private-mode') !== row.get_active())
                settings.set_boolean('private-mode', row.get_active());
        });
        settings.connect('changed::private-mode', () => {
            if (row.get_active() !== settings.get_boolean('private-mode'))
                row.set_active(settings.get_boolean('private-mode'));
        });
        privateMode.add(row);
        addSwitch(privateMode, settings, 'privacy-remember', 'Keep private mode after a Shell restart',
            'Off by default so a restart cannot silently leave capture disabled.');

        const storage = new Adw.PreferencesGroup({
            title: 'Stored data',
            description: 'Files are private to your user account. Text and images never leave ' +
                'this computer; the extension has no network code.',
        });
        page.add(storage);
        const paths = storagePaths();
        storage.add(new Adw.ActionRow({title: 'History file', subtitle: paths.history}));
        storage.add(new Adw.ActionRow({title: 'Images', subtitle: paths.images}));
        storage.add(new Adw.ActionRow({title: 'Thumbnails', subtitle: paths.cache}));
        storage.add(new Adw.ActionRow({
            title: 'Permissions',
            subtitle: 'Directories 0700, files 0600. Sensitive items are never written.',
        }));

        const danger = new Adw.PreferencesGroup({title: 'Clear stored data'});
        page.add(danger);
        const clear = new Adw.ActionRow({
            title: 'Clear clipboard history',
            subtitle: 'Removes text, images and thumbnails. Pinned items are removed too.',
        });
        const clearButton = new Gtk.Button({
            label: 'Clear…',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearButton.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({
                transient_for: window,
                modal: true,
                heading: 'Clear clipboard history?',
                body: 'This removes all entries, pinned items, images and thumbnails. ' +
                    'It cannot be undone.',
            });
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('clear', 'Clear');
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_close_response('cancel');
            dialog.connect('response', (_dialog, response) => {
                if (response !== 'clear')
                    return;
                clearDirectory(paths.images);
                clearDirectory(paths.cache);
                try {
                    const history = Gio.File.new_for_path(paths.history);
                    if (history.query_exists(null))
                        history.delete(null);
                } catch {
                    // The extension will retry on its next save.
                }
                settings.set_int('clear-history-request',
                    settings.get_int('clear-history-request') + 1);
                toast(window, 'Clipboard history cleared.');
            });
            dialog.present();
        });
        clear.add_suffix(clearButton);
        danger.add(clear);

        return page;
    }
}
