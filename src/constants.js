// SPDX-License-Identifier: GPL-2.0-or-later
//
// Manunggal — shared constants. No Shell imports: safe for tests.

export const UUID = 'manunggal@lurim412';
export const SCHEMA_ID = 'org.gnome.shell.extensions.manunggal';
export const EXTENSION_NAME = 'Manunggal';

export const PANEL_ICON = 'edit-paste-symbolic';
export const PRIVATE_ICON = 'channel-secure-symbolic';

export const LIMITS = {
    // Hard upper bounds. GSettings values are clamped to these.
    textBytes: 262144,
    imageBytes: 5 * 1024 * 1024,
    totalImageBytes: 20 * 1024 * 1024,
    entries: 500,
    previewChars: 400,
    searchQuery: 80,
};

export const MIME = {
    text: [
        'text/plain;charset=utf-8',
        'text/plain;charset=UTF-8',
        'UTF8_STRING',
        'text/plain',
        'STRING',
    ],
    image: ['image/png', 'image/jpeg', 'image/webp'],
    sensitiveHint: 'x-kde-passwordManagerHint',
    uriList: 'text/uri-list',
};

export const TAB_IDS = ['clipboard', 'emoji', 'symbol', 'color'];

export const CATEGORY_IDS = ['text', 'code', 'color', 'emoji', 'image'];

export const CATEGORY_META = {
    text: {icon: 'text-x-generic-symbolic', label: 'Text'},
    code: {icon: 'applications-engineering-symbolic', label: 'Code'},
    color: {icon: 'color-select-symbolic', label: 'Color'},
    emoji: {icon: 'face-smile-symbolic', label: 'Emoji'},
    image: {icon: 'image-x-generic-symbolic', label: 'Image'},
};

// Adwaita palette, used for swatches and per-entry accents.
export const PALETTE = [
    '#3584e4', '#1c71d8', '#1a5fb4',
    '#33d17a', '#2ec27e', '#26a269',
    '#f6d32d', '#f5c211', '#e5a50a',
    '#ff7800', '#e66100', '#c64600',
    '#e01b24', '#c01c28', '#a51d2d',
    '#9141ac', '#813d9c', '#613583',
    '#986a44', '#865e3c', '#63452c',
    '#deddda', '#c0bfbc', '#9a9996',
    '#77767b', '#5e5c64', '#3d3846',
];
