// SPDX-License-Identifier: GPL-2.0-or-later

import {
    EMOJI_CATEGORIES,
    EMOJI_ITEMS,
    codepointLabel,
    displayName,
    emojiByChar,
    emojiForGroup,
    searchEmoji,
} from '../core/emoji.js';
import {
    SYMBOL_GROUPS,
    SYMBOL_ITEMS,
    searchSymbols,
    symbolByChar,
    symbolCodepoint,
    symbolDisplayName,
    symbolForGroup,
} from '../core/symbols.js';

const emojiChars = new Set(EMOJI_ITEMS.map(item => item.char));
const symbolChars = new Set(SYMBOL_ITEMS.map(item => item.char));

export const EMOJI_CONFIG = {
    id: 'emoji',
    itemName: 'emoji',
    groups: EMOJI_CATEGORIES,
    groupItems: emojiForGroup,
    search: searchEmoji,
    itemForChar: emojiByChar,
    displayName,
    codepoint: codepointLabel,
    recentKey: 'recent-emoji',
    separatorKey: 'emoji-separator',
    allChars: () => emojiChars,
};

export const SYMBOL_CONFIG = {
    id: 'symbol',
    itemName: 'symbol',
    groups: SYMBOL_GROUPS,
    groupItems: symbolForGroup,
    search: searchSymbols,
    itemForChar: symbolByChar,
    displayName: symbolDisplayName,
    codepoint: symbolCodepoint,
    recentKey: 'recent-symbols',
    separatorKey: 'symbol-separator',
    allChars: () => symbolChars,
};
