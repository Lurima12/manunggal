// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class SearchBar {
    /**
     * @param {{onQueryChanged: Function, onScopeChanged: Function}} callbacks
     */
    constructor(callbacks) {
        this._onQueryChanged = callbacks.onQueryChanged;
        this._onScopeChanged = callbacks.onScopeChanged;
        this._query = '';
        this._scope = 'tab';
        this._focusId = 0;

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-search-bar',
            x_expand: true,
        });

        this._entry = new St.Entry({
            style_class: 'manunggal-search-entry',
            hint_text: 'Search',
            can_focus: true,
            x_expand: true,
        });
        this._entry.set_primary_icon(new St.Icon({
            icon_name: 'system-search-symbolic',
            style_class: 'manunggal-search-icon',
        }));
        this._entry.set_accessible_name('Search');
        this._entry.clutter_text.connect('text-changed', () => {
            const text = this._entry.get_text();
            if (text === this._query)
                return;
            this._query = text;
            this._onQueryChanged?.(text);
        });
        this._entry.clutter_text.connect('key-press-event', (_text, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape && this._query) {
                this.clear();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._scopeButton = new St.Button({
            style_class: 'button manunggal-scope-button',
            can_focus: true,
            toggle_mode: true,
            checked: false,
        });
        this._scopeButton.set_accessible_name('Search scope: this tab');
        this._scopeButton.accessible_role = Atk.Role.TOGGLE_BUTTON;
        this._scopeButton.set_label('This tab');
        this._scopeButton.connect('clicked', () => {
            this.setScope(this._scope === 'tab' ? 'all' : 'tab');
            this._onScopeChanged?.(this._scope);
        });

        this.actor.add_child(this._entry);
        this.actor.add_child(this._scopeButton);
    }

    get scope() {
        return this._scope;
    }

    get query() {
        return this._query;
    }

    setScope(scope, notify = false) {
        this._scope = scope === 'all' ? 'all' : 'tab';
        this._scopeButton.set_label(this._scope === 'all' ? 'All' : 'This tab');
        this._scopeButton.set_checked(this._scope === 'all');
        this._scopeButton.set_accessible_name(
            `Search scope: ${this._scope === 'all' ? 'all tabs' : 'this tab'}. ` +
            'Activate to change.');
        if (notify)
            this._onScopeChanged?.(this._scope);
    }

    setText(text) {
        this._query = text ?? '';
        if (this._entry.get_text() !== this._query)
            this._entry.set_text(this._query);
    }

    clear() {
        this.setText('');
        this._onQueryChanged?.('');
    }

    focus() {
        if (!this.actor.visible)
            return;
        if (this._entry.mapped) {
            this._entry.grab_key_focus();
            this._entry.clutter_text.set_cursor_position(-1);
            return;
        }
        // Switching away from the Color tab unmaps the entry; focus can only
        // be grabbed once it is mapped again.
        if (this._focusId)
            return;
        this._focusId = this._entry.connect('notify::mapped', () => {
            if (!this._entry.mapped)
                return;
            this._entry.disconnect(this._focusId);
            this._focusId = 0;
            this._entry.grab_key_focus();
            this._entry.clutter_text.set_cursor_position(-1);
        });
    }

    setVisible(visible) {
        this.actor.visible = visible;
        if (!visible && this._focusId) {
            this._entry.disconnect(this._focusId);
            this._focusId = 0;
        }
    }

    destroy() {
        if (this._focusId) {
            try {
                this._entry.disconnect(this._focusId);
            } catch {
                // Entry is being destroyed.
            }
            this._focusId = 0;
        }
        this.actor.destroy();
    }
}
