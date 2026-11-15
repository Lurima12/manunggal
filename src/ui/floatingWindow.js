// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {EXTENSION_NAME, PANEL_ICON, PRIVATE_ICON} from '../constants.js';

const WORK_AREA_RATIO = 0.92;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Frameless Shell actor that hosts the shared MainView in floating mode.
 *
 * This is not a Meta.Window: extensions cannot create those. It lives in the
 * Shell UI layer when "keep above" is on, or in the window layer as a
 * best-effort approximation when it is off.
 */
export class FloatingWindow {
    /**
     * @param {{
     *   settings: object,
     *   view: object,
     *   panelButton: object,
     *   onClose: Function,
     *   onTogglePrivate: Function,
     * }} options
     */
    constructor(options) {
        this._options = options;
        this._settings = options.settings;
        this._view = options.view;
        this._destroyed = false;
        this._closed = false;
        this._drag = null;
        this._openedWorkspace = 0;
        this._keepAboveFallback = false;
        this._settingsIds = [];
        this._workspaceId = 0;
        this._stageId = 0;
        this._monitorsId = 0;

        this.actor = new St.BoxLayout({
            style_class: 'popup-menu-content manunggal-floating-window',
            vertical: true,
            reactive: true,
        });

        this._header = new St.BoxLayout({
            style_class: 'manunggal-floating-header',
            x_expand: true,
            // The drag handlers live here, so the header must be a reactive
            // pick target; otherwise presses land on the window background.
            reactive: true,
        });
        const drag = new St.BoxLayout({
            style_class: 'manunggal-floating-drag',
            x_expand: true,
            reactive: true,
        });
        drag.add_child(new St.Icon({
            icon_name: PANEL_ICON,
            style_class: 'manunggal-floating-icon',
        }));
        drag.add_child(new St.Label({
            style_class: 'manunggal-floating-title',
            text: EXTENSION_NAME,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._privateButton = new St.Button({
            style_class: 'icon-button manunggal-floating-button',
            can_focus: true,
            toggle_mode: true,
            child: new St.Icon({icon_name: 'channel-insecure-symbolic'}),
        });
        this._privateButton.set_accessible_name('Turn on private mode');
        this._privateButton.connect('clicked', () => {
            this._options.onTogglePrivate?.();
        });

        this._resetButton = new St.Button({
            style_class: 'icon-button manunggal-floating-button',
            can_focus: true,
            child: new St.Icon({icon_name: 'view-refresh-symbolic'}),
        });
        this._resetButton.set_accessible_name('Reset floating window position');
        this._resetButton.connect('clicked', () => this._resetPosition());

        this._closeButton = new St.Button({
            style_class: 'icon-button manunggal-floating-button',
            can_focus: true,
            child: new St.Icon({icon_name: 'window-close-symbolic'}),
        });
        this._closeButton.set_accessible_name('Close Manunggal');
        this._closeButton.connect('clicked', () => this._options.onClose?.());

        this._header.add_child(drag);
        this._header.add_child(this._privateButton);
        this._header.add_child(this._resetButton);
        this._header.add_child(this._closeButton);
        this.actor.add_child(this._header);

        this._body = new St.BoxLayout({
            style_class: 'manunggal-floating-body',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._body);

        this._header.connect('button-press-event',
            (_actor, event) => this._onPress(event));
        this._header.connect('motion-event',
            (_actor, event) => this._onMotion(event));
        this._header.connect('button-release-event',
            (_actor, event) => this._onRelease(event));

        this._settingsIds.push(this._settings.connect('floating-keep-above',
            () => this._applyLayer()));
        this._settingsIds.push(this._settings.connect('floating-all-workspaces',
            () => this._syncWorkspaceVisibility()));
        this._settingsIds.push(this._settings.connect('floating-close-outside',
            () => this._syncOutsideHandler()));
        this._settingsIds.push(this._settings.connect('floating-width',
            () => this._applyGeometry()));
        this._settingsIds.push(this._settings.connect('floating-height',
            () => this._applyGeometry()));
        this._settingsIds.push(this._settings.connect('floating-x',
            () => this._applyGeometry()));
        this._settingsIds.push(this._settings.connect('floating-y',
            () => this._applyGeometry()));
        this._settingsIds.push(this._settings.connect('private-mode', value => {
            this._setPrivate(Boolean(value));
        }));

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._applyGeometry());
    }

    get keepAboveFallback() {
        return this._keepAboveFallback;
    }

    setView(actor) {
        const parent = actor.get_parent();
        if (parent)
            parent.remove_child(actor);
        this._body.add_child(actor);
    }

    attach() {
        this._applyLayer();
        this._syncOutsideHandler();
    }

    get visible() {
        return this.actor.visible;
    }

    get closed() {
        return this._closed;
    }

    present() {
        if (!this.actor.get_parent())
            return;
        this._openedWorkspace =
            global.workspace_manager.get_active_workspace_index();
        this._applyGeometry();
        this.actor.show();
        this._syncWorkspaceVisibility();
        this._view.open();
        this._view.focusSearch();
    }

    close() {
        if (this._destroyed)
            return;
        this._persistPosition();
        this._viewportCleanup();
        this._view.clearFloatingSize();
        // The view is shared with the panel menu and is destroyed by the
        // indicator, so detach it before this actor takes its children down.
        const viewActor = this._view.actor;
        if (viewActor.get_parent() === this._body)
            this._body.remove_child(viewActor);
        const parent = this.actor.get_parent();
        if (parent)
            parent.remove_child(this.actor);
        this.actor.hide();
        this._closed = true;
        global.stage.set_key_focus(null);
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._viewportCleanup();
        for (const id of this._settingsIds) {
            try {
                this._settings.disconnect(id);
            } catch {
                // Settings is going away.
            }
        }
        this._settingsIds = [];
        if (this._monitorsId) {
            try {
                Main.layoutManager.disconnect(this._monitorsId);
            } catch {
                // Layout manager is going away.
            }
            this._monitorsId = 0;
        }
        if (this._view) {
            const viewActor = this._view.actor;
            if (viewActor.get_parent() === this._body)
                this._body.remove_child(viewActor);
        }
        const parent = this.actor.get_parent();
        if (parent)
            parent.remove_child(this.actor);
        this._view = null;
        this._settings = null;
        this._options = null;
        this.actor.destroy();
    }

    // ------------------------------------------------------------------- layer

    _applyLayer() {
        const keepAbove = this._settings.getBool('floating-keep-above');
        const parent = this.actor.get_parent();

        this._keepAboveFallback = false;
        let target = Main.layoutManager.uiGroup;
        if (!keepAbove) {
            if (global.window_group)
                target = global.window_group;
            else
                this._keepAboveFallback = true;
        }
        if (parent !== target) {
            if (parent)
                parent.remove_child(this.actor);
            target.add_child(this.actor);
        }
        this._applyGeometry();
        this._syncPrivateButton();
    }

    _syncPrivateButton() {
        const privateMode = this._settings.getBool('private-mode');
        this._setPrivate(privateMode);
    }

    _setPrivate(isPrivate) {
        this._privateButton.set_checked(isPrivate);
        this._privateButton.set_child(new St.Icon({
            icon_name: isPrivate ? PRIVATE_ICON : 'channel-insecure-symbolic',
        }));
        this._privateButton.set_accessible_name(isPrivate
            ? 'Turn off private mode'
            : 'Turn on private mode');
        if (isPrivate)
            this._privateButton.add_style_class_name('manunggal-private-on');
        else
            this._privateButton.remove_style_class_name('manunggal-private-on');
    }

    // ---------------------------------------------------------------- geometry

    _workArea() {
        const monitorIndex = global.display.get_focus_window()?.get_monitor?.() ??
            Main.layoutManager.primaryIndex;
        return {
            monitorIndex,
            area: Main.layoutManager.getWorkAreaForMonitor(monitorIndex),
        };
    }

    _applyGeometry() {
        const {area} = this._workArea();
        if (!area)
            return;
        const maxWidth = Math.max(260, Math.round(area.width * WORK_AREA_RATIO));
        const maxHeight = Math.max(240, Math.round(area.height * WORK_AREA_RATIO));
        const width = Math.min(this._settings.getInt('floating-width'), maxWidth);
        const height = Math.min(this._settings.getInt('floating-height'), maxHeight);

        let x = this._settings.getInt('floating-x');
        let y = this._settings.getInt('floating-y');
        if (x < 0)
            x = area.x + Math.round((area.width - width) / 2);
        if (y < 0)
            y = area.y + Math.round((area.height - height) / 2);
        x = clamp(x, area.x, area.x + area.width - width);
        y = clamp(y, area.y, area.y + area.height - height);

        this._width = width;
        this._height = height;
        this._x = x;
        this._y = y;
        this.actor.set_size(width, height);
        this.actor.set_position(x, y);

        // The header and border are themed, so measure them instead of
        // assuming fixed chrome heights.
        const node = this.actor.get_theme_node();
        const borderX = node
            ? node.get_border_width(St.Side.LEFT) + node.get_border_width(St.Side.RIGHT)
            : 0;
        const borderY = node
            ? node.get_border_width(St.Side.TOP) + node.get_border_width(St.Side.BOTTOM)
            : 0;
        const headerHeight = this._header.get_preferred_height(width)[1] || 46;
        this._view.setFloatingSize(
            Math.max(200, width - borderX),
            Math.max(200, height - borderY - headerHeight));
        this._syncWorkspaceVisibility();
    }

    _persistPosition() {
        if (!this._settings || !this.actor.get_parent())
            return;
        this._settings.setInt('floating-x', Math.round(this._x));
        this._settings.setInt('floating-y', Math.round(this._y));
    }

    _resetPosition() {
        this._settings.setInt('floating-x', -1);
        this._settings.setInt('floating-y', -1);
        this._applyGeometry();
    }

    // ------------------------------------------------------------------ drag

    _sourceIsButton(source) {
        let actor = source;
        while (actor && actor !== this._header) {
            if (actor instanceof St.Button)
                return true;
            actor = actor.get_parent();
        }
        return false;
    }

    _onPress(event) {
        if (event.get_button() !== 1 || this._sourceIsButton(event.get_source()))
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._drag = {
            startX: x,
            startY: y,
            actorX: this._x,
            actorY: this._y,
        };
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const {area} = this._workArea();
        if (!area)
            return Clutter.EVENT_STOP;
        this._x = clamp(this._drag.actorX + x - this._drag.startX,
            area.x, area.x + area.width - this._width);
        this._y = clamp(this._drag.actorY + y - this._drag.startY,
            area.y, area.y + area.height - this._height);
        this.actor.set_position(this._x, this._y);
        return Clutter.EVENT_STOP;
    }

    _onRelease() {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        this._drag = null;
        this._persistPosition();
        return Clutter.EVENT_STOP;
    }

    // ------------------------------------------------------------- workspaces

    _syncWorkspaceVisibility() {
        if (!this.actor.get_parent() || this._destroyed)
            return;
        if (this._settings.getBool('floating-all-workspaces')) {
            if (this._workspaceId) {
                try {
                    global.workspace_manager.disconnect(this._workspaceId);
                } catch {
                    // Workspace manager is going away.
                }
                this._workspaceId = 0;
            }
            this.actor.show();
            return;
        }

        if (!this._workspaceId) {
            this._workspaceId = global.workspace_manager.connect(
                'active-workspace-changed', () => {
                    if (this._settings.getBool('floating-all-workspaces'))
                        return;
                    const active =
                        global.workspace_manager.get_active_workspace_index();
                    this.actor.visible = active === this._openedWorkspace;
                });
        }
        const active = global.workspace_manager.get_active_workspace_index();
        this.actor.visible = active === this._openedWorkspace;
    }

    _syncOutsideHandler() {
        if (this._stageId) {
            try {
                global.stage.disconnect(this._stageId);
            } catch {
                // Stage is going away.
            }
            this._stageId = 0;
        }
        if (!this._settings.getBool('floating-close-outside'))
            return;
        this._stageId = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const source = event.get_source();
            if (source === this.actor || this.actor.contains(source) ||
                this._isOwnPanel(source)) {
                return Clutter.EVENT_PROPAGATE;
            }
            // Never destroy the overlay while its event is still dispatching.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._options?.onClose?.();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _isOwnPanel(source) {
        let actor = source;
        while (actor) {
            if (actor === this._options.panelButton)
                return true;
            actor = actor.get_parent();
        }
        return false;
    }

    _viewportCleanup() {
        if (this._workspaceId) {
            try {
                global.workspace_manager.disconnect(this._workspaceId);
            } catch {
                // Already gone.
            }
            this._workspaceId = 0;
        }
        if (this._stageId) {
            try {
                global.stage.disconnect(this._stageId);
            } catch {
                // Already gone.
            }
            this._stageId = 0;
        }
    }
}
