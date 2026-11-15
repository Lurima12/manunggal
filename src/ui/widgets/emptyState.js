// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

export class EmptyState {
    /**
     * @param {{icon?: string, title: string, description?: string, actionLabel?: string, onAction?: Function}} options
     */
    constructor(options = {}) {
        this.actor = new St.BoxLayout({
            style_class: 'manunggal-empty',
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (options.icon) {
            this.actor.add_child(new St.Icon({
                icon_name: options.icon,
                style_class: 'manunggal-empty-icon',
                icon_size: 32,
            }));
        }

        this._title = new St.Label({
            style_class: 'manunggal-empty-title',
            text: options.title ?? '',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._title);

        this._description = new St.Label({
            style_class: 'manunggal-empty-description dim-label',
            text: options.description ?? '',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._description.clutter_text.line_wrap = true;
        this._description.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._description.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.actor.add_child(this._description);

        this._action = null;
        if (options.actionLabel) {
            this._action = new St.Button({
                style_class: 'button manunggal-empty-action',
                can_focus: true,
                label: options.actionLabel,
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._action.set_accessible_name(options.actionLabel);
            this._action.connect('clicked', () => options.onAction?.());
            this.actor.add_child(this._action);
        }

        this.setAccessible(options.title, options.description);
    }

    setAccessible(title, description) {
        this.actor.set_accessible_name(
            [title, description].filter(Boolean).join('. '));
    }

    setText(title, description) {
        this._title.text = title ?? '';
        this._description.text = description ?? '';
        this.setAccessible(title, description);
    }

    setActionLabel(label) {
        if (this._action)
            this._action.set_label(label ?? '');
    }

    destroy() {
        this.actor.destroy();
    }
}
