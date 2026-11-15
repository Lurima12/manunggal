// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {CATEGORY_META} from '../../constants.js';
import {effectiveCategory} from '../../core/classify.js';
import {scoreFields, tokenize} from '../../core/search.js';
import {ChipBar} from '../widgets/chipBar.js';
import {ClipboardRow} from '../widgets/clipboardRow.js';
import {EmptyState} from '../widgets/emptyState.js';
import {editText} from '../widgets/textEditor.js';

const CHIPS = [
    {id: 'all', label: 'All'},
    {id: 'text', label: 'Text'},
    {id: 'code', label: 'Code'},
    {id: 'color', label: 'Color'},
    {id: 'emoji', label: 'Emoji'},
    {id: 'image', label: 'Image'},
];

export class ClipboardTab {
    /**
     * @param {object} options
     */
    constructor(options) {
        this._store = options.store;
        this._settings = options.settings;
        this._options = options;
        this._category = 'all';
        this._query = '';
        this._scope = 'tab';
        this._private = false;
        this._rows = [];
        this._layout = {
            previewLines: 2,
            showMeta: true,
            actionsMode: 'always',
            showChips: true,
        };

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-tab manunggal-clipboard-tab',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        this._chips = new ChipBar(CHIPS, 'all', id => {
            this._category = id;
            this.refresh();
        });
        this.actor.add_child(this._chips.actor);

        this._scroll = new St.ScrollView({
            style_class: 'manunggal-list-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._list = new St.BoxLayout({
            style_class: 'manunggal-list',
            vertical: true,
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this.actor.add_child(this._scroll);

        this._empty = new EmptyState({title: '', description: ''});
        this.actor.add_child(this._empty.actor);

        this._privatePanel = new EmptyState({
            icon: 'channel-secure-symbolic',
            title: 'Private mode is on',
            description: 'Clipboard capture is paused and history is hidden. ' +
                'Nothing is deleted while private mode is on.',
            actionLabel: 'Turn off private mode',
            onAction: () => this._options.onPrivateOff?.(),
        });
        this._privatePanel.actor.add_style_class_name('manunggal-private-panel');
        this.actor.add_child(this._privatePanel.actor);

        this._onStoreChanged = () => {
            if (this._options.visible?.() !== false)
                this.refresh();
            else
                this._dirty = true;
        };
        this._store.connect(this._onStoreChanged);

        this.refresh();
    }

    get id() {
        return 'clipboard';
    }

    setPrivate(isPrivate) {
        if (this._private === isPrivate)
            return;
        this._private = isPrivate;
        this.refresh();
    }

    setSearch(query, scope) {
        this._query = scope === 'tab' ? query : '';
        this._scope = scope;
        this.refresh();
    }

    setLayout(layout) {
        this._layout = {...this._layout, ...layout};
        this._chips.actor.visible = this._layout.showChips;
        this.refresh();
    }

    clearFilter() {
        this._category = 'all';
        this._chips.select('all');
        this.refresh();
    }

    focusFirst() {
        this._rows[0]?.actor.grab_key_focus();
    }

    focusSearchResult() {
        this._rows[0]?.actor.grab_key_focus();
    }

    scrollToTop() {
        const adjustment = this._scroll.get_vadjustment();
        if (adjustment)
            adjustment.value = 0;
    }

    refresh() {
        if (!this._store.loaded) {
            this._showEmpty('Loading history…', '');
            return;
        }

        if (this._private) {
            this._chips.actor.hide();
            this._scroll.hide();
            this._empty.actor.hide();
            this._privatePanel.actor.show();
            return;
        }

        this._privatePanel.actor.hide();
        this._chips.actor.visible = this._layout.showChips;

        const focusedId = this._rows.find(row => row.actor.has_key_focus())?.entry.id ?? null;
        for (const row of this._rows)
            row.destroy();
        this._rows = [];

        const entries = this._filteredEntries();
        if (!entries.length) {
            this._scroll.hide();
            this._showEmptyForReason();
            return;
        }

        this._empty.actor.hide();
        this._scroll.show();

        for (const entry of entries) {
            const row = new ClipboardRow(entry, {
                previewLines: this._layout.previewLines,
                showMeta: this._layout.showMeta,
                actionsMode: this._layout.actionsMode,
                previewFile: entry.kind === 'image'
                    ? this._store.previewFile(entry)
                    : null,
                onCopy: entryToCopy => this._copy(entryToCopy),
                onPin: entryToPin => this._store.togglePin(entryToPin.id),
                onDelete: entryToDelete => this._delete(entryToDelete),
                onEdit: entryToEdit => this._edit(entryToEdit),
                onCategory: (entryToChange, category) =>
                    this._store.setCategory(entryToChange.id, category),
                onAccent: (entryToChange, color) =>
                    this._store.setAccent(entryToChange.id, color),
                onSensitive: (entryToChange, sensitive) =>
                    this._store.setSensitive(entryToChange.id, sensitive),
                onNavigate: (direction, fromEntry) => this._navigate(direction, fromEntry),
            });
            this._rows.push(row);
            this._list.add_child(row.actor);
        }

        if (focusedId !== null) {
            const restored = this._rows.find(row => row.entry.id === focusedId);
            if (restored)
                restored.actor.grab_key_focus();
        }
        this._dirty = false;
    }

    _filteredEntries() {
        const query = this._query.trim();
        let entries = this._store.entries;

        if (query) {
            const terms = tokenize(query);
            // Sensitive entries are excluded from search by design.
            entries = entries.filter(entry => {
                if (entry.sensitive)
                    return false;
                if (entry.kind === 'image')
                    return scoreFields(terms, [{text: 'image'}]) > 0;
                return scoreFields(terms, [{text: entry.text ?? ''}]) > 0;
            });
        }

        if (this._category !== 'all')
            entries = entries.filter(entry => effectiveCategory(entry) === this._category);

        // Pinned first, otherwise most-recently-used order from the store.
        return [...entries].sort((a, b) => {
            if (a.pinned !== b.pinned)
                return a.pinned ? -1 : 1;
            return b.lastUsedAt - a.lastUsedAt;
        });
    }

    _showEmpty(title, description) {
        this._chips.actor.hide();
        this._scroll.hide();
        this._privatePanel.actor.hide();
        this._empty.setText(title, description);
        this._empty.actor.show();
    }

    _showEmptyForReason() {
        if (this._query.trim()) {
            this._showEmpty('No matching entries',
                'Sensitive entries are never included in search.');
            this._setEmptyAction('Clear search', () => this._options.onClearSearch?.());
            return;
        }
        if (this._category !== 'all') {
            this._showEmpty(`No ${CATEGORY_META[this._category]?.label ?? ''} entries`,
                'Try another category or show all entries.');
            this._setEmptyAction('Show all', () => this.clearFilter());
            return;
        }
        this._showEmpty('No clipboard history yet',
            'Copy text, code, a colour or an image and it will appear here.');
        this._setEmptyAction(null, null);
    }

    _setEmptyAction(label, callback) {
        // EmptyState owns its action button; rebuild it when the action changes.
        const old = this._empty._action;
        if (old)
            old.destroy();
        this._empty._action = null;
        if (!label)
            return;
        const button = new St.Button({
            style_class: 'button manunggal-empty-action',
            can_focus: true,
            label,
            x_align: Clutter.ActorAlign.CENTER,
        });
        button.set_accessible_name(label);
        button.connect('clicked', () => callback?.());
        this._empty._action = button;
        this._empty.actor.add_child(button);
    }

    async _copy(entry) {
        try {
            const ok = await this._options.onCopyEntry?.(entry);
            if (!ok) {
                this._options.onToast?.('Could not copy this item.');
                return;
            }
            if (this._settings.getBool('close-after-copy'))
                this._options.onClose?.();
        } catch (e) {
            console.error(`Manunggal: copy failed (${e.message})`);
            this._options.onToast?.('Could not copy this item.');
        }
    }

    _delete(entry) {
        const removed = this._store.remove(entry.id);
        if (!removed)
            return;
        this._options.onToast?.('Entry deleted', {
            actionLabel: 'Undo',
            onAction: () => this._store.restore(removed),
        });
    }

    async _edit(entry) {
        try {
            const text = await editText({title: 'Edit clipboard text', text: entry.text});
            if (text === null)
                return;
            if (!this._store.updateText(entry.id, text))
                this._options.onToast?.('Text was not changed.');
        } catch (e) {
            console.error(`Manunggal: edit failed (${e.message})`);
            this._options.onToast?.('Could not edit this item.');
        }
    }

    _navigate(direction, fromEntry) {
        const index = this._rows.findIndex(row => row.entry.id === fromEntry.id);
        if (index < 0)
            return;
        let target;
        if (direction === -Infinity)
            target = 0;
        else if (direction === Infinity)
            target = this._rows.length - 1;
        else
            target = Math.max(0, Math.min(this._rows.length - 1, index + direction));
        this._rows[target]?.actor.grab_key_focus();
    }

    destroy() {
        this._store.disconnect(this._onStoreChanged);
        for (const row of this._rows)
            row.destroy();
        this._rows = [];
        this._options = null;
        this.actor.destroy();
    }
}
