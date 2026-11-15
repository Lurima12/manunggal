// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PANEL_ICON, PRIVATE_ICON, TAB_IDS} from '../constants.js';
import {confirmDialog} from './widgets/confirmDialog.js';
import {SearchBar} from './widgets/searchBar.js';
import {TabBar} from './widgets/tabBar.js';
import {Toast} from './widgets/toast.js';
import {ClipboardTab} from './tabs/clipboardTab.js';
import {ColorTab} from './tabs/colorTab.js';
import {GlyphTab} from './tabs/glyphTab.js';
import {EMOJI_CONFIG, SYMBOL_CONFIG} from './glyphConfig.js';
import {SearchResultsView} from './searchResults.js';

const TABS = [
    {id: 'clipboard', label: 'Clipboard', icon: PANEL_ICON},
    {id: 'emoji', label: 'Emoji', icon: 'face-smile-symbolic'},
    {id: 'symbol', label: 'Symbol', icon: 'font-x-generic-symbolic'},
    {id: 'color', label: 'Color', icon: 'color-select-symbolic'},
];

const LAYOUT_KEYS = new Set([
    'layout-mode',
    'custom-preview-lines',
    'custom-show-meta',
    'custom-show-actions',
    'custom-tab-labels',
    'custom-density',
    'custom-glyph-size',
    'custom-show-chips',
    'view-width',
    'search-scope',
    'persist-history',
]);

export class MainView {
    /**
     * @param {object} options
     */
    constructor(options) {
        this._options = options;
        this._settings = options.settings;
        this._store = options.store;
        this._activeTab = 'clipboard';
        this._private = false;
        this._settingsIds = [];
        this._destroyed = false;
        this._floatingSize = null;

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-view',
            vertical: true,
            x_expand: true,
        });

        this._buildHeader();
        this._buildSearch();
        this._buildTabs();
        this._buildFooter();
        this._buildSettingsConnections();

        const last = this._settings.getBool('remember-last-tab')
            ? this._settings.getString('last-tab')
            : 'clipboard';
        this._selectTab(TAB_IDS.includes(last) ? last : 'clipboard', {fromUser: false});
        this._applyLayout();
    }

    // ------------------------------------------------------------------- build

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'manunggal-header',
            x_expand: true,
        });
        this._title = new St.Label({
            style_class: 'manunggal-title',
            text: 'Manunggal',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._privateLabel = new St.Label({
            style_class: 'manunggal-private-label',
            text: 'Private',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._privateButton = new St.Button({
            style_class: 'icon-button manunggal-header-button',
            can_focus: true,
            toggle_mode: true,
            child: new St.Icon({icon_name: 'channel-insecure-symbolic'}),
        });
        this._privateButton.set_accessible_name('Turn on private mode');
        this._privateButton.accessible_role = Atk.Role.TOGGLE_BUTTON;
        this._privateButton.connect('clicked', () => this._options.onTogglePrivate?.());

        this._prefsButton = new St.Button({
            style_class: 'icon-button manunggal-header-button',
            can_focus: true,
            child: new St.Icon({icon_name: 'emblem-system-symbolic'}),
        });
        this._prefsButton.set_accessible_name('Open Manunggal preferences');
        this._prefsButton.connect('clicked', () => this._options.onOpenPreferences?.());

        header.add_child(this._title);
        header.add_child(this._privateLabel);
        header.add_child(this._privateButton);
        header.add_child(this._prefsButton);
        this._header = header;
        this.actor.add_child(header);
    }

    _buildSearch() {
        this._searchBar = new SearchBar({
            onQueryChanged: () => this._applySearch(),
            onScopeChanged: () => {
                this._settings.setString('search-scope', this._searchBar.scope);
                this._applySearch();
            },
        });
        this._searchBar.setScope(this._settings.getString('search-scope'));
        this.actor.add_child(this._searchBar.actor);
    }

    _buildTabs() {
        this._tabBar = new TabBar(TABS, this._activeTab, id => {
            this._selectTab(id, {fromUser: true});
        });
        this.actor.add_child(this._tabBar.actor);

        this._contentArea = new St.Widget({
            style_class: 'manunggal-content',
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._clipboardTab = new ClipboardTab({
            store: this._store,
            settings: this._settings,
            onCopyEntry: entry => this._options.copyEntry?.(entry),
            onClose: () => this._options.onClose?.(),
            onToast: (message, toastOptions) => this._toast?.show(message, toastOptions),
            onPrivateOff: () => this._options.onTogglePrivate?.(),
            onClearSearch: () => this._searchBar.clear(),
            visible: () => this.actor.visible && this._activeTab === 'clipboard',
        });

        const glyphOptions = {
            settings: this._settings,
            onCopyText: text => this._options.copyText?.(text) ?? false,
            onClose: () => this._options.onClose?.(),
            onToast: message => this._toast?.show(message),
            onClearSearch: () => this._searchBar.clear(),
        };
        this._emojiTab = new GlyphTab(EMOJI_CONFIG, glyphOptions);
        this._symbolTab = new GlyphTab(SYMBOL_CONFIG, glyphOptions);

        this._colorTab = new ColorTab({
            settings: this._settings,
            onCopyText: text => this._options.copyText?.(text) ?? false,
            onClose: () => this._options.onClose?.(),
            onToast: message => this._toast?.show(message),
            onPickScreen: () => this._options.onPickScreen?.(),
        });

        this._tabs = {
            clipboard: this._clipboardTab,
            emoji: this._emojiTab,
            symbol: this._symbolTab,
            color: this._colorTab,
        };

        for (const tab of Object.values(this._tabs))
            this._contentArea.add_child(tab.actor);

        this._results = new SearchResultsView({
            store: this._store,
            settings: this._settings,
            onCopyEntry: entry => this._options.copyEntry?.(entry),
            onCopyText: text => this._options.copyText?.(text) ?? false,
            onClose: () => this._options.onClose?.(),
            onToast: message => this._toast?.show(message),
            isPrivate: () => this._private,
        });
        this._contentArea.add_child(this._results.actor);

        this.actor.add_child(this._contentArea);

        this._toast = new Toast();
        this.actor.add_child(this._toast.actor);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            style_class: 'manunggal-footer',
            x_expand: true,
        });
        this._statusLabel = new St.Label({
            style_class: 'manunggal-status dim-label',
            text: '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearButton = new St.Button({
            style_class: 'button manunggal-clear-button',
            can_focus: true,
        });
        const clearBox = new St.BoxLayout({style_class: 'manunggal-clear-content'});
        clearBox.add_child(new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 16}));
        clearBox.add_child(new St.Label({
            text: 'Clear history',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._clearButton.set_child(clearBox);
        this._clearButton.set_accessible_name('Clear clipboard history');
        this._clearButton.connect('clicked', () => this._clearHistory());

        footer.add_child(this._statusLabel);
        footer.add_child(this._clearButton);
        this.actor.add_child(footer);
    }

    _buildSettingsConnections() {
        this._settingsIds.push(this._settings.connectAll(key => {
            if (!LAYOUT_KEYS.has(key))
                return;
            if (key === 'search-scope') {
                this._searchBar.setScope(this._settings.getString('search-scope'));
                this._applySearch();
                return;
            }
            if (key === 'view-width')
                this.updateGeometry();
            if (key === 'persist-history')
                this._updateStatus();
            this._applyLayout();
        }));
        this.actor.connect('key-press-event',
            (_actor, event) => this._handleKeyPress(event));
        this._updateStatus();
    }

    _handleKeyPress(event) {
        const symbol = event.get_key_symbol();
        const control =
            (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if (control) {
            const tabIndex = symbol - Clutter.KEY_1;
            if (tabIndex >= 0 && tabIndex < TAB_IDS.length) {
                this.setActiveTab(TAB_IDS[tabIndex]);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_f || symbol === Clutter.KEY_F) {
                // The search entry is hidden on the Color tab.
                if (this._activeTab === 'color')
                    this.setActiveTab('clipboard');
                this.focusSearch();
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_comma) {
                this._options.onOpenPreferences?.();
                return Clutter.EVENT_STOP;
            }
        }

        if (symbol !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        if (this._searchBar.query) {
            this._searchBar.clear();
            return Clutter.EVENT_STOP;
        }
        if (this._activeTab === 'clipboard' && this._clipboardTab.handleEscape?.())
            return Clutter.EVENT_STOP;
        if ((this._activeTab === 'emoji' || this._activeTab === 'symbol') &&
            this._tabs[this._activeTab].handleEscape())
            return Clutter.EVENT_STOP;
        // Nothing left to dismiss locally: close the menu or overlay.
        this._options.onClose?.();
        return Clutter.EVENT_STOP;
    }

    // ------------------------------------------------------------------ sizing

    setFloatingSize(width, height) {
        this._floatingSize = {
            width: Math.max(240, Math.round(width)),
            height: Math.max(220, Math.round(height)),
        };
        this._header.visible = false;
        this.updateGeometry();
    }

    clearFloatingSize() {
        if (!this._floatingSize)
            return;
        this._floatingSize = null;
        this._header.visible = true;
        this.updateGeometry();
    }

    get privateMode() {
        return this._private;
    }

    updateGeometry() {
        if (this._destroyed)
            return;
        if (this._floatingSize) {
            this._applyFloatingGeometry();
            return;
        }
        const monitorIndex = global.display.get_focus_window()?.get_monitor?.() ??
            Main.layoutManager.primaryIndex;
        const monitor = Main.layoutManager.monitors[monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const maxWidth = Math.max(280, Math.round(monitor.width * 0.94));
        const maxHeight = Math.max(280, Math.round(monitor.height * 0.86));
        const widthSetting = this._settings.getInt('view-width');
        const width = widthSetting > 0
            ? Math.min(widthSetting, maxWidth)
            : null;

        let style = `max-width: ${maxWidth}px; max-height: ${maxHeight}px;`;
        if (width) {
            style += ` width: ${width}px; max-width: ${width}px;`;
        } else {
            style += ' width: 27em; max-width: 27em;';
        }
        this.actor.set_style(style);
        // Header, search, tabs, toast and footer occupy roughly 210px; keep
        // the remaining space for the active tab so the menu stays inside the
        // monitor height.
        const contentHeight = Math.max(180, maxHeight - 210);
        this._contentArea.set_style(
            `height: ${contentHeight}px; max-height: ${contentHeight}px;`);
        this._emojiTab?.setContentHeight(contentHeight);
        this._symbolTab?.setContentHeight(contentHeight);
    }

    _applyFloatingGeometry() {
        const {width, height} = this._floatingSize;
        // `height` is the space the floating body gives us. CSS height is the
        // content box, so subtract this view's own padding to keep the footer
        // inside the overlay.
        const node = this.actor.get_theme_node();
        const padLeft = node?.get_padding(St.Side.LEFT) ?? 0;
        const padRight = node?.get_padding(St.Side.RIGHT) ?? 0;
        const padTop = node?.get_padding(St.Side.TOP) ?? 0;
        const padBottom = node?.get_padding(St.Side.BOTTOM) ?? 0;
        const contentWidth = Math.max(200, width - padLeft - padRight);
        const contentBox = Math.max(140, height - padTop - padBottom);
        this.actor.set_style(
            `width: ${contentWidth}px; max-width: ${contentWidth}px; ` +
            `height: ${contentBox}px; max-height: ${contentBox}px;`);

        let chrome = 0;
        if (this.actor.get_stage()) {
            for (const child of this.actor.get_children()) {
                if (child === this._contentArea || !child.visible)
                    continue;
                const [, natural] = child.get_preferred_height(contentWidth);
                const childNode = child.get_theme_node();
                chrome += natural;
                if (childNode) {
                    chrome += childNode.get_margin(St.Side.TOP) +
                        childNode.get_margin(St.Side.BOTTOM);
                }
            }
        } else {
            chrome = 150;
        }
        const contentHeight = Math.max(120, contentBox - chrome);
        this._contentArea.set_style(
            `height: ${contentHeight}px; max-height: ${contentHeight}px;`);
        this._emojiTab?.setContentHeight(contentHeight);
        this._symbolTab?.setContentHeight(contentHeight);
    }

    // ------------------------------------------------------------------- state

    setPrivate(isPrivate) {
        this._private = Boolean(isPrivate);
        this._privateLabel.visible = this._private;
        this._privateButton.set_checked(this._private);
        this._privateButton.set_accessible_name(
            this._private ? 'Turn off private mode' : 'Turn on private mode');
        const icon = this._private ? PRIVATE_ICON : 'channel-insecure-symbolic';
        this._privateButton.set_child(new St.Icon({icon_name: icon}));
        if (this._private)
            this._privateButton.add_style_class_name('manunggal-private-on');
        else
            this._privateButton.remove_style_class_name('manunggal-private-on');
        this._clipboardTab.setPrivate(this._private);
        this._results?.setPrivate(this._private);
        if (this._private)
            this._results?.refresh();
        this._updateStatus();
    }

    _updateStatus() {
        if (!this._statusLabel)
            return;
        if (this._private)
            this._statusLabel.text = 'Private mode: capture paused, history hidden';
        else if (!this._settings.getBool('persist-history'))
            this._statusLabel.text = 'History is not saved across sessions';
        else
            this._statusLabel.text = '';
    }

    _selectTab(id, {fromUser = false} = {}) {
        if (!this._tabs[id])
            return;
        if (fromUser && this._searchBar.scope === 'all' && this._searchBar.query) {
            this._searchBar.setScope('tab');
            this._settings.setString('search-scope', 'tab');
        }
        this._activeTab = id;
        this._tabBar.select(id);
        this._showingResults = false;
        for (const [tabId, tab] of Object.entries(this._tabs))
            tab.actor.visible = tabId === id;
        this._results.actor.hide();
        this._searchBar.setVisible(id !== 'color');
        this._settings.setString('last-tab', id);
        this._tabBar.setLabelsVisible(this._tabLabelsVisible ?? true);

        if (id === 'color') {
            this._colorTab.setSearch('');
        } else {
            this._tabs[id].setSearch(this._searchBar.query, this._searchBar.scope);
        }
        for (const [tabId, tab] of Object.entries(this._tabs)) {
            if (tabId !== id && tabId !== 'color')
                tab.setSearch('', 'tab');
        }
        this._updateStatus();
    }

    _applySearch() {
        const query = this._searchBar.query;
        const scope = this._searchBar.scope;
        this._searchBar.setVisible(this._activeTab !== 'color');

        if (scope === 'all' && query.trim()) {
            this._showingResults = true;
            for (const tab of Object.values(this._tabs))
                tab.actor.hide();
            this._results.actor.show();
            this._results.setQuery(query);
            this._results.scrollToTop();
            return;
        }

        this._showingResults = false;
        this._results.actor.hide();
        for (const [tabId, tab] of Object.entries(this._tabs))
            tab.actor.visible = tabId === this._activeTab;
        if (this._activeTab !== 'color')
            this._tabs[this._activeTab].setSearch(query, scope);
        for (const [tabId, tab] of Object.entries(this._tabs)) {
            if (tabId !== this._activeTab && tabId !== 'color')
                tab.setSearch('', 'tab');
        }
        if (query)
            this._tabs[this._activeTab].scrollToTop?.();
    }

    _applyLayout() {
        const mode = this._settings.getString('layout-mode');
        const custom = mode === 'custom';
        const cramped = mode === 'compact';
        const density = custom ? this._settings.getString('custom-density') : 'comfortable';

        for (const cls of ['manunggal-mode-detailed', 'manunggal-mode-compact',
            'manunggal-mode-custom', 'manunggal-density-compact'])
            this.actor.remove_style_class_name(cls);
        this.actor.add_style_class_name(`manunggal-mode-${['detailed', 'compact', 'custom'].includes(mode) ? mode : 'detailed'}`);
        if (custom && density === 'compact')
            this.actor.add_style_class_name('manunggal-density-compact');

        const previewLines = custom
            ? this._settings.getInt('custom-preview-lines')
            : cramped ? 1 : 2;
        const showMeta = custom
            ? this._settings.getBool('custom-show-meta')
            : !cramped;
        const actionsMode = custom
            ? this._settings.getString('custom-show-actions')
            : 'hover';
        const showChips = custom
            ? this._settings.getBool('custom-show-chips')
            : true;
        const glyphSize = custom
            ? this._settings.getString('custom-glyph-size')
            : 'medium';
        this._tabLabelsVisible = custom
            ? this._settings.getBool('custom-tab-labels')
            : true;

        this._clipboardTab.setLayout({
            previewLines,
            showMeta,
            actionsMode: ['always', 'hover', 'menu'].includes(actionsMode)
                ? actionsMode : 'hover',
            showChips,
        });
        this._emojiTab.setLayout({glyphSize, showChips});
        this._symbolTab.setLayout({glyphSize, showChips});
        this._tabBar.setLabelsVisible(this._tabLabelsVisible);
        this.updateGeometry();
    }

    // ----------------------------------------------------------------- opening

    open() {
        if (this._destroyed)
            return;
        this.updateGeometry();
        this._applyLayout();
        this._searchBar.clear();
        this._showingResults = false;
        this._results.actor.hide();
        for (const [tabId, tab] of Object.entries(this._tabs))
            tab.actor.visible = tabId === this._activeTab;
        this._searchBar.setVisible(this._activeTab !== 'color');

        if (this._activeTab === 'clipboard')
            this._clipboardTab.refresh();
        else if (this._activeTab === 'emoji' || this._activeTab === 'symbol')
            this._tabs[this._activeTab]._refreshItems?.();

        if (this._activeTab === 'color') {
            this._colorTab.focusFirst();
        } else {
            this._searchBar.focus();
        }
        this._tabs[this._activeTab].scrollToTop?.();
    }

    focusSearch() {
        if (this._activeTab === 'color')
            this._colorTab.focusFirst();
        else
            this._searchBar.focus();
    }

    setActiveTab(id) {
        this._selectTab(id, {fromUser: false});
    }

    get activeTab() {
        return this._activeTab;
    }

    get colorTab() {
        return this._colorTab;
    }

    showToast(message, options) {
        this._toast.show(message, options);
    }

    // ----------------------------------------------------------------- actions

    async _clearHistory() {
        try {
            const confirm = this._settings.getBool('confirm-clear');
            if (confirm) {
                const accepted = await confirmDialog({
                    title: 'Clear clipboard history?',
                    message: 'This removes all entries, pinned items, images and thumbnails. ' +
                        'It cannot be undone.',
                    confirmLabel: 'Clear',
                    destructive: true,
                });
                if (!accepted)
                    return;
            }
            this._store.clear();
            this._store.purgeFiles().catch(() => {});
            this._toast.show('Clipboard history cleared');
        } catch (e) {
            console.error(`Manunggal: clear history failed (${e.message})`);
            this._toast?.show('Could not clear history.');
        }
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._toast?.destroy();
        this._results?.destroy();
        this._clipboardTab?.destroy();
        this._emojiTab?.destroy();
        this._symbolTab?.destroy();
        this._colorTab?.destroy();
        this._tabBar?.destroy();
        this._searchBar?.destroy();
        this._options = null;
        this.actor.destroy();
    }
}
