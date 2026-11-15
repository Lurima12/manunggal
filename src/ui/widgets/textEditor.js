// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Multi-line text editor. Uses the entry's internal ClutterText with
 * single-line mode off; Ctrl+Enter saves, Escape cancels.
 *
 * @param {{title?: string, text: string}} options
 * @returns {Promise<string|null>} null on cancel
 */
export function editText(options) {
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
            style_class: 'popup-menu-content manunggal-dialog manunggal-editor-dialog',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.accessible_role = Atk.Role.DIALOG;

        const title = new St.Label({
            style_class: 'manunggal-dialog-title',
            text: options.title ?? 'Edit text',
        });

        const entry = new St.Entry({
            style_class: 'manunggal-editor-entry',
            can_focus: true,
            text: options.text ?? '',
            x_expand: true,
        });
        const clutterText = entry.clutter_text;
        clutterText.set_single_line_mode(false);
        clutterText.set_line_wrap(true);
        clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        clutterText.set_cursor_position(-1);
        entry.set_accessible_name('Clipboard text');

        const scroll = new St.ScrollView({
            style_class: 'manunggal-editor-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        scroll.set_child(entry);

        const error = new St.Label({
            style_class: 'manunggal-dialog-error',
            text: '',
            visible: false,
        });

        const hint = new St.Label({
            style_class: 'manunggal-dialog-hint dim-label',
            text: 'Ctrl+Enter saves · Esc cancels',
        });

        const buttons = new St.BoxLayout({
            style_class: 'manunggal-dialog-buttons',
            x_align: Clutter.ActorAlign.END,
        });
        const cancel = new St.Button({
            style_class: 'button manunggal-dialog-button',
            can_focus: true,
            label: 'Cancel',
        });
        const save = new St.Button({
            style_class: 'button manunggal-dialog-button manunggal-suggested',
            can_focus: true,
            label: 'Save',
        });

        let grab = null;
        let done = false;
        const signalIds = [];
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
        const trySave = () => {
            const text = entry.get_text();
            if (!text.trim()) {
                error.text = 'Text cannot be empty.';
                error.show();
                return;
            }
            finish(text);
        };

        cancel.connect('clicked', () => finish(null));
        save.connect('clicked', trySave);
        signalIds.push(clutterText.connect('key-press-event', (_text, event) => {
            const symbol = event.get_key_symbol();
            const state = event.get_state();
            if (symbol === Clutter.KEY_Escape) {
                finish(null);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                if (state & Clutter.ModifierType.CONTROL_MASK) {
                    trySave();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }));
        signalIds.push(overlay.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));
        signalIds.push(overlay.connect('button-press-event', (actor, event) => {
            if (event.get_source() === actor) {
                finish(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));

        buttons.add_child(hint);
        buttons.add_child(cancel);
        buttons.add_child(save);
        box.add_child(title);
        box.add_child(scroll);
        box.add_child(error);
        box.add_child(buttons);
        overlay.add_child(box);

        Main.layoutManager.uiGroup.add_child(overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(overlay, null);
        try {
            grab = Main.pushModal(overlay, {actionMode: Shell.ActionMode.POPUP});
        } catch {
            grab = null;
        }
        entry.grab_key_focus();
        clutterText.set_cursor_position(-1);
    });
}
