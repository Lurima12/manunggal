// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * In-view status message with one optional action ("Undo"). It is not a
 * notification and it never steals focus.
 */
export class Toast {
    constructor() {
        this._timeoutId = 0;
        this._onAction = null;

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-toast',
            x_expand: true,
            visible: false,
        });
        this._label = new St.Label({
            style_class: 'manunggal-toast-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._action = new St.Button({
            style_class: 'button manunggal-toast-action',
            can_focus: true,
            visible: false,
        });
        this._action.set_accessible_name('Toast action');
        this._action.connect('clicked', () => {
            const callback = this._onAction;
            this.hide();
            callback?.();
        });

        this.actor.add_child(this._label);
        this.actor.add_child(this._action);
    }

    show(message, {actionLabel = null, onAction = null, timeout = DEFAULT_TIMEOUT_MS} = {}) {
        this._cancelTimer();
        this._label.text = message;
        this._onAction = onAction;
        this._action.visible = Boolean(actionLabel);
        if (actionLabel)
            this._action.set_label(actionLabel);
        this._action.set_accessible_name(actionLabel ?? '');
        this.actor.set_accessible_name(
            actionLabel ? `${message}. Action: ${actionLabel}` : message);
        this.actor.show();

        if (timeout > 0) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
                this._timeoutId = 0;
                this.hide();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    hide() {
        this._cancelTimer();
        this._onAction = null;
        this.actor.hide();
        this.actor.set_accessible_name('');
    }

    _cancelTimer() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    destroy() {
        this._cancelTimer();
        this.actor.destroy();
    }
}
