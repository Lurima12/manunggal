// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * A small modal confirmation dialog drawn above all windows. Used for
 * destructive actions such as clearing history.
 *
 * @param {{title: string, message: string, confirmLabel?: string, destructive?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
    return new Promise(resolve => {
        const overlay = new St.Widget({
            style_class: 'manunggal-modal-overlay',
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: Math.max(1, global.stage.get_width()),
            height: Math.max(1, global.stage.get_height()),
            layout_manager: new Clutter.BinLayout(),
        });

        const box = new St.BoxLayout({
            // Inherit the Shell popup background/border instead of relying on
            // the theme to style a bare St.BoxLayout.
            style_class: 'popup-menu-content manunggal-dialog',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.accessible_role = Atk.Role.DIALOG;
        box.set_accessible_name(`${options.title}. ${options.message}`);

        const title = new St.Label({
            style_class: 'manunggal-dialog-title',
            text: options.title,
        });
        const message = new St.Label({
            style_class: 'manunggal-dialog-message',
            text: options.message,
        });
        message.clutter_text.line_wrap = true;

        const buttons = new St.BoxLayout({
            style_class: 'manunggal-dialog-buttons',
            x_align: Clutter.ActorAlign.END,
        });
        const cancel = new St.Button({
            style_class: 'button manunggal-dialog-button',
            can_focus: true,
            label: 'Cancel',
        });
        const confirm = new St.Button({
            style_class: 'button manunggal-dialog-button' +
                (options.destructive ? ' manunggal-destructive' : ''),
            can_focus: true,
            label: options.confirmLabel ?? 'Confirm',
        });

        let grab = null;
        let done = false;
        const finish = value => {
            if (done)
                return;
            done = true;
            for (const id of signalIds) {
                try {
                    overlay.disconnect(id);
                } catch {
                    // Actor is being destroyed.
                }
            }
            if (grab) {
                try {
                    Main.popModal(grab);
                } catch {
                    // Already released.
                }
                grab = null;
            }
            overlay.destroy();
            resolve(value);
        };
        const signalIds = [];

        cancel.connect('clicked', () => finish(false));
        confirm.connect('clicked', () => finish(true));
        signalIds.push(overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));
        signalIds.push(overlay.connect('button-press-event', (actor, event) => {
            if (event.get_source() === actor) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));

        buttons.add_child(cancel);
        buttons.add_child(confirm);
        box.add_child(title);
        box.add_child(message);
        box.add_child(buttons);
        overlay.add_child(box);

        Main.layoutManager.uiGroup.add_child(overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(overlay, null);
        try {
            grab = Main.pushModal(overlay, {actionMode: Shell.ActionMode.POPUP});
        } catch {
            grab = null;
        }
        cancel.grab_key_focus();
    });
}
