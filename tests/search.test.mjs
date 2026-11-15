import test from 'node:test';
import assert from 'node:assert/strict';

import {tokenize, matchScore, scoreFields, searchItems, excerpt} from '../src/core/search.js';

test('tokenize folds case and accents', () => {
    assert.deepEqual(tokenize('  Café   LATTE '), ['cafe', 'latte']);
    assert.deepEqual(tokenize(''), []);
});

test('match ranking', () => {
    assert.ok(matchScore('face', 'face') > matchScore('face', 'face with tears'));
    assert.ok(matchScore('face', 'face with tears') > matchScore('face', 'smiling face'));
    assert.equal(matchScore('zzz', 'face'), 0);
});

test('all terms must match', () => {
    const fields = [{text: 'smiling face with heart eyes'}];
    assert.ok(scoreFields(['smiling', 'heart'], fields) > 0);
    assert.equal(scoreFields(['smiling', 'rocket'], fields), 0);
});

test('searchItems sorts and limits', () => {
    const items = [
        {name: 'rocket', kind: 'travel'},
        {name: 'rocket launch', kind: 'travel'},
        {name: 'paper plane', kind: 'objects'},
    ];
    const result = searchItems(items, 'rocket', item => [{text: item.name}], {limit: 1});
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'rocket');
});

test('weighted fields prefer names over keywords', () => {
    const items = [
        {name: 'heart', keywords: 'love'},
        {name: 'love letter', keywords: 'heart'},
    ];
    const result = searchItems(items, 'heart', item => [
        {text: item.name, weight: 3},
        {text: item.keywords, weight: 1},
    ]);
    assert.equal(result[0].name, 'heart');
});

test('excerpt collapses whitespace', () => {
    assert.equal(excerpt('  a\n b\t c  '), 'a b c');
    assert.ok(excerpt('x'.repeat(50), 10).endsWith('…'));
});
