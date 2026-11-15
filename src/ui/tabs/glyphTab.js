// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {ChipBar} from '../widgets/chipBar.js';
import {EmptyState} from '../widgets/emptyState.js';
import {GlyphGrid} from '../widgets/glyphGrid.js';

const MAX_RECENT = 24;

/**
 * Shared implementation for the Emoji and Symbol tabs. Differences live in the
 * config object (data access, separators, labels).
 */
export class GlyphTab {
    constructor(config, options) {
        this._config = config;
        this._options = options;
        this._settings = options.settings;
        this._query = '';
        this._scope = 'tab';
        this._selected = [];
        this._selectMode = false;
        this._layout = {glyphSize: 'medium', showChips: true};
        this._emptyAction = null;

        this.actor = new St.BoxLayout({
            style_class: `manunggal-tab manunggal-${config.id}-tab`,
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        const recent = this._recentItems();
        const chipItems = [
            {id: 'recent', label: 'Recent', icon: 'document-open-recent-symbolic'},
            ...config.groups.map(group => ({
                id: group.id,
                label: group.label,
                icon: group.icon,
            })),
        ];
        this._groupId = recent.length ? 'recent' : (config.groups[0]?.id ?? 'recent');

        this._chips = new ChipBar(chipItems, this._groupId, id => {
            this._groupId = id;
            this._refreshItems();
        });
        this._chips.setItemVisible('recent', recent.length > 0);

        this._chipScroll = new St.ScrollView({
            style_class: 'manunggal-chip-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._chipScroll.set_child(this._chips.actor);
        this.actor.add_child(this._chipScroll);

        this._toolbar = new St.BoxLayout({
            style_class: 'manunggal-glyph-toolbar',
            x_expand: true,
        });
        this._groupLabel = new St.Label({
            style_class: 'manunggal-glyph-group-label dim-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._selectButton = new St.Button({
            style_class: 'button manunggal-select-button',
            can_focus: true,
            toggle_mode: true,
            label: 'Select',
        });
        this._selectButton.accessible_role = Atk.Role.TOGGLE_BUTTON;
        this._selectButton.set_accessible_name(`Select multiple ${config.itemName}`);
        this._selectButton.connect('clicked', () => {
            this._selectMode = this._selectButton.get_checked();
            if (!this._selectMode)
                this._clearSelection();
            this._updateFooter();
        });
        this._toolbar.add_child(this._groupLabel);
        this._toolbar.add_child(this._selectButton);
        this.actor.add_child(this._toolbar);

        this._grid = new GlyphGrid({
            accessibleName: (item, state) => this._accessibleName(item, state),
            onActivate: (item, activation) => this._activate(item, activation),
        });
        this.actor.add_child(this._grid.actor);

        this._empty = new EmptyState({title: '', description: ''});
        this.actor.add_child(this._empty.actor);

        this._footer = new St.BoxLayout({
            style_class: 'manunggal-glyph-footer',
            x_expand: true,
            visible: false,
        });
        this._countLabel = new St.Label({
            style_class: 'manunggal-glyph-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._previewLabel = new St.Label({
            style_class: 'manunggal-glyph-selection-preview dim-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearButton = new St.Button({
            style_class: 'button manunggal-glyph-footer-button',
            can_focus: true,
            label: 'Clear',
        });
        this._copyButton = new St.Button({
            style_class: 'button manunggal-glyph-footer-button manunggal-suggested',
            can_focus: true,
            label: 'Copy',
        });
        this._clearButton.set_accessible_name(`Clear ${config.itemName} selection`);
        this._copyButton.set_accessible_name(`Copy selected ${config.itemName}`);
        this._clearButton.connect('clicked', () => this._clearSelection());
        this._copyButton.connect('clicked', () => this._copySelection());
        this._footer.add_child(this._countLabel);
        this._footer.add_child(this._previewLabel);
        this._footer.add_child(this._clearButton);
        this._footer.add_child(this._copyButton);
        this.actor.add_child(this._footer);

        this._grid.setSize(this._layout.glyphSize);
        this._refreshItems();

        this._mappedId = this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped)
                this._queueResize();
        });
    }

    get id() {
        return this._config.id;
    }

    /**
     * Keep the whole tab inside the menu so the glyph list scrolls instead of
     * stretching the popup past the screen edge.
     */
    setContentHeight(height) {
        this._contentHeight = Math.max(160, Math.round(height));
        this.actor.set_style(`height: ${this._contentHeight}px;`);
        this._queueResize();
    }

    _queueResize() {
        if (this._resizeId)
            return;
        this._resizeId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._resizeId = 0;
            this._resizeGrid();
            return GLib.SOURCE_REMOVE;
        });
    }

    _resizeGrid() {
        // Measuring before the menu is on screen produces theme warnings and
        // useless values; the mapped handler retries once it is visible.
        if (!this._contentHeight || !this.actor.get_stage())
            return;
        let used = 0;
        for (const child of this.actor.get_children()) {
            if (child === this._grid.actor || !child.visible)
                continue;
            const [, natural] = child.get_preferred_height(this.actor.width || -1);
            used += natural;
        }
        this._grid.actor.set_height(
            Math.max(120, this._contentHeight - used - 8));
    }

    setSearch(query, scope) {
        this._query = scope === 'tab' ? query : '';
        this._scope = scope;
        this._refreshItems();
    }

    setLayout(layout) {
        this._layout = {...this._layout, ...layout};
        this._grid.setSize(this._layout.glyphSize);
        this._updateChipVisibility();
    }

    handleEscape() {
        if (this._selectMode) {
            this._selectMode = false;
            this._selectButton.set_checked(false);
            this._clearSelection();
            return true;
        }
        if (this._selected.length) {
            this._clearSelection();
            return true;
        }
        return false;
    }

    focusFirst() {
        this._grid.focusFirst();
    }

    focusSearchResult() {
        this._grid.focusFirst();
    }

    scrollToTop() {
        const adjustment = this._grid.actor.get_vadjustment();
        if (adjustment)
            adjustment.value = 0;
    }

    _updateChipVisibility() {
        const visible = !this._query.trim() && this._layout.showChips;
        this._chipScroll.visible = visible;
    }

    _refreshItems() {
        this._updateChipVisibility();

        let items;
        let label;
        if (this._query.trim()) {
            items = this._config.search(this._query, 400);
            label = `${items.length} ${this._config.itemName} result${items.length === 1 ? '' : 's'}`;
        } else {
            items = this._itemsForGroup(this._groupId);
            const group = this._config.groups.find(g => g.id === this._groupId);
            label = group
                ? `${group.label} · ${items.length}`
                : `${items.length}`;
        }

        this._groupLabel.text = label;
        this._grid.setItems(items);
        this._grid.setSelection(
            this._selected.map(item => item.id),
            this._selected.map(item => item.id));

        if (!items.length) {
            this._grid.actor.hide();
            this._empty.actor.show();
            this._showEmptyForReason();
        } else {
            this._empty.actor.hide();
            this._grid.actor.show();
        }

        this._updateFooter();
    }

    _itemsForGroup(groupId) {
        if (groupId === 'recent')
            return this._recentItems();
        return this._config.groupItems(groupId);
    }

    _recentItems() {
        const chars = this._settings.getStrv(this._config.recentKey);
        return chars
            .map(char => this._config.itemForChar(char))
            .filter(Boolean)
            .slice(0, MAX_RECENT);
    }

    _showEmptyForReason() {
        if (this._query.trim()) {
            this._showEmpty(
                `No matching ${this._config.itemName}s`,
                'Try a different word, or clear the search.');
            this._setEmptyAction('Clear search', () => this._options.onClearSearch?.());
            return;
        }
        if (this._groupId === 'recent') {
            this._showEmpty(
                `No recent ${this._config.itemName}s yet`,
                `Copy one from a category and it will appear here.`);
            this._setEmptyAction(null, null);
            return;
        }
        this._showEmpty(`No ${this._config.itemName}s`, 'Nothing to show.');
        this._setEmptyAction(null, null);
    }

    _showEmpty(title, description) {
        this._empty.setText(title, description);
        this._empty.actor.show();
    }

    _setEmptyAction(label, callback) {
        if (this._emptyAction) {
            this._emptyAction.destroy();
            this._emptyAction = null;
        }
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
        this._emptyAction = button;
        this._empty.actor.add_child(button);
    }

    _accessibleName(item, state = {}) {
        const base = `${this._config.displayName(item)}, ` +
            `${this._config.codepoint(item.char)}`;
        if (state.selected)
            return `${base}, selected, ${state.index} of ${state.total}`;
        return base;
    }

    _activate(item, {shift = false} = {}) {
        if (this._selectMode || shift || this._selected.length) {
            this._toggleSelection(item);
            return;
        }
        this._copyChars([item.char]);
    }

    _toggleSelection(item) {
        const index = this._selected.findIndex(selected => selected.id === item.id);
        if (index >= 0)
            this._selected.splice(index, 1);
        else
            this._selected.push(item);

        this._grid.setSelection(
            this._selected.map(selected => selected.id),
            this._selected.map(selected => selected.id));
        this._updateFooter();
    }

    _clearSelection() {
        this._selected = [];
        this._grid.setSelection([], []);
        this._updateFooter();
    }

    _updateFooter() {
        const count = this._selected.length;
        const show = count > 0 || this._selectMode;
        this._footer.visible = show;
        this._countLabel.text = count === 1 ? '1 selected' : `${count} selected`;
        this._footer.set_accessible_name(`${count} selected`);
        this._previewLabel.text = this._selected
            .map(item => item.char)
            .join(this._separator());
        const enabled = count > 0;
        this._copyButton.set_reactive(enabled);
        this._copyButton.opacity = enabled ? 255 : 120;
        this._clearButton.set_reactive(enabled);
        this._clearButton.opacity = enabled ? 255 : 120;
        this._resizeGrid();
    }

    _separator() {
        const value = this._settings.getString(this._config.separatorKey);
        return value === 'space' ? ' ' : '';
    }

    _copySelection() {
        if (!this._selected.length)
            return;
        this._copyChars(this._selected.map(item => item.char));
    }

    _copyChars(chars) {
        const text = chars.join(this._separator());
        const ok = this._options.onCopyText?.(text);
        if (!ok) {
            this._options.onToast?.(`Could not copy the ${this._config.itemName}.`);
            return;
        }
        this._updateRecent(chars);

        if (this._selectMode) {
            this._selectMode = false;
            this._selectButton.set_checked(false);
            this._clearSelection();
        }

        if (this._settings.getBool('close-after-copy'))
            this._options.onClose?.();
    }

    _updateRecent(chars) {
        const known = new Set(this._config.allChars());
        const current = this._settings.getStrv(this._config.recentKey)
            .filter(char => known.has(char));
        const updated = [...new Set([...chars.filter(c => known.has(c)), ...current])]
            .slice(0, MAX_RECENT);
        this._settings.setStrv(this._config.recentKey, updated);
        this._chips.setItemVisible('recent', updated.length > 0);
        if (this._groupId === 'recent' && !this._query)
            this._refreshItems();
    }

    destroy() {
        this._options = null;
        if (this._resizeId) {
            GLib.source_remove(this._resizeId);
            this._resizeId = 0;
        }
        if (this._mappedId) {
            this.actor.disconnect(this._mappedId);
            this._mappedId = 0;
        }
        if (this._emptyAction) {
            this._emptyAction.destroy();
            this._emptyAction = null;
        }
        this._grid.destroy();
        this._chips.destroy();
        this.actor.destroy();
    }
}
