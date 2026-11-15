// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {CATEGORY_META} from '../constants.js';
import {effectiveCategory} from '../core/classify.js';
import {searchEmoji} from '../core/emoji.js';
import {excerpt, searchItems} from '../core/search.js';
import {searchSymbols} from '../core/symbols.js';
import {EmptyState} from './widgets/emptyState.js';

const CLIPBOARD_LIMIT = 8;
const GLYPH_LIMIT = 12;

/**
 * Grouped results for "All" search scope. This is deliberately compact: it is
 * a launcher for the three tabs, not a fourth clipboard list.
 */
export class SearchResultsView {
    constructor(options) {
        this._store = options.store;
        this._options = options;
        this._query = '';
        this._rows = [];
        this._nodes = [];
        this._private = false;
        this._destroyed = false;

        this.actor = new St.ScrollView({
            style_class: 'manunggal-tab manunggal-search-results',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._content = new St.BoxLayout({
            style_class: 'manunggal-search-content',
            vertical: true,
            x_expand: true,
        });
        this.actor.set_child(this._content);

        this._empty = new EmptyState({title: '', description: ''});
        this._content.add_child(this._empty.actor);

        this._onStoreChanged = () => {
            if (this.actor.visible && this._query)
                this.refresh();
        };
        this._store.connect(this._onStoreChanged);
    }

    setQuery(query) {
        this._query = query;
        this.refresh();
    }

    setPrivate(isPrivate) {
        this._private = Boolean(isPrivate);
        if (this.actor.visible)
            this.refresh();
    }

    refresh() {
        if (this._destroyed)
            return;
        for (const row of this._rows)
            row.destroy();
        this._rows = [];
        for (const node of this._nodes)
            node.destroy();
        this._nodes = [];

        const query = this._query.trim();
        if (!query) {
            this._content.hide();
            return;
        }
        this._content.show();

        const clipboard = this._searchClipboard(query);
        const emoji = searchEmoji(query, GLYPH_LIMIT);
        const symbols = searchSymbols(query, GLYPH_LIMIT);
        const total = clipboard.length + emoji.length + symbols.length;

        if (!total) {
            this._empty.setText(
                `No results for “${excerpt(query, 40)}”`,
                'Search clipboard text, emoji names and symbol names.');
            this._empty.actor.show();
            return;
        }
        this._empty.actor.hide();

        if (clipboard.length)
            this._addSection('Clipboard', clipboard.length);
        for (const entry of clipboard)
            this._addClipboardRow(entry);

        if (emoji.length)
            this._addSection('Emoji', emoji.length);
        for (const item of emoji)
            this._addGlyphRow(item, 'Emoji', () => this._options.onCopyText?.(item.char));

        if (symbols.length)
            this._addSection('Symbols', symbols.length);
        for (const item of symbols)
            this._addGlyphRow(item, 'Symbol', () => this._options.onCopyText?.(item.char));
    }

    _searchClipboard(query) {
        if (this._private)
            return [];
        const candidates = this._store.entries.filter(entry => !entry.sensitive);
        return searchItems(candidates, query, entry => {
            const category = CATEGORY_META[effectiveCategory(entry)]?.label ?? 'Text';
            return [
                {text: entry.kind === 'image' ? 'image' : entry.text ?? '', weight: 1},
                {text: category, weight: 0.4},
            ];
        }, {
            limit: CLIPBOARD_LIMIT,
            sort: (a, b) => b.lastUsedAt - a.lastUsedAt,
        });
    }

    _addSection(title, count) {
        const label = new St.Label({
            style_class: 'manunggal-search-section-title dim-label',
            text: `${title} · ${count}`,
        });
        this._content.add_child(label);
        this._nodes.push(label);
    }

    _makeRow(accessibleName) {
        const button = new St.Button({
            style_class: 'popup-menu-item manunggal-search-row',
            can_focus: true,
            x_expand: true,
        });
        button.accessible_role = Atk.Role.LIST_ITEM;
        button.set_accessible_name(accessibleName);
        return button;
    }

    _addClipboardRow(entry) {
        const category = effectiveCategory(entry);
        const meta = CATEGORY_META[category] ?? CATEGORY_META.text;
        const preview = entry.kind === 'image'
            ? 'Image'
            : excerpt(entry.text ?? '', 110);
        const button = this._makeRow(`${meta.label}: ${preview}`);
        const box = new St.BoxLayout({
            style_class: 'manunggal-search-row-content',
            x_expand: true,
        });
        box.add_child(new St.Icon({
            icon_name: meta.icon,
            style_class: 'manunggal-search-row-icon dim-label',
        }));
        const text = new St.BoxLayout({vertical: true, x_expand: true});
        text.add_child(new St.Label({
            text: preview,
            style_class: 'manunggal-search-row-title',
            x_expand: true,
        }));
        text.add_child(new St.Label({
            text: meta.label,
            style_class: 'manunggal-search-row-meta dim-label',
        }));
        box.add_child(text);
        button.set_child(box);
        button.connect('clicked', () => this._copyEntry(entry));
        this._content.add_child(button);
        this._rows.push(button);
    }

    _addGlyphRow(item, kind, callback) {
        const name = item.name ? item.name[0].toUpperCase() + item.name.slice(1) : item.char;
        const button = this._makeRow(`${name}, ${kind}`);
        const box = new St.BoxLayout({
            style_class: 'manunggal-search-row-content',
            x_expand: true,
        });
        box.add_child(new St.Label({
            text: item.char,
            style_class: 'manunggal-search-glyph',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const text = new St.BoxLayout({vertical: true, x_expand: true});
        text.add_child(new St.Label({
            text: name,
            style_class: 'manunggal-search-row-title',
            x_expand: true,
        }));
        text.add_child(new St.Label({
            text: kind,
            style_class: 'manunggal-search-row-meta dim-label',
        }));
        box.add_child(text);
        button.set_child(box);
        button.connect('clicked', () => {
            if (callback()) {
                if (this._options.settings.getBool('close-after-copy'))
                    this._options.onClose?.();
            }
        });
        this._content.add_child(button);
        this._rows.push(button);
    }

    async _copyEntry(entry) {
        try {
            const ok = await this._options.onCopyEntry?.(entry);
            if (!ok) {
                this._options.onToast?.('Could not copy this item.');
                return;
            }
            if (this._options.settings.getBool('close-after-copy'))
                this._options.onClose?.();
        } catch (e) {
            console.error(`Manunggal: copy failed (${e.message})`);
            this._options.onToast?.('Could not copy this item.');
        }
    }

    focusFirst() {
        this._rows[0]?.grab_key_focus();
    }

    scrollToTop() {
        const adjustment = this.actor.get_vadjustment();
        if (adjustment)
            adjustment.value = 0;
    }

    destroy() {
        this._destroyed = true;
        this._store.disconnect(this._onStoreChanged);
        for (const row of this._rows)
            row.destroy();
        this._rows = [];
        this._options = null;
        this.actor.destroy();
    }
}
