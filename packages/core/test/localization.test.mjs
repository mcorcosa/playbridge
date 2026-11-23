import assert from 'node:assert/strict';
import test from 'node:test';
import { Localization } from '../dist/index.js';

const languages = { de: { formatLocale: 'de-DE' }, it: {}, 'zh-Hant': {}, he: { direction: 'rtl' } };
const catalog = {
  de: { greeting: 'Hallo {name}', retry: 'Erneut versuchen' },
  it: { greeting: 'Ciao {name}' },
  he: { greeting: 'שלום {name}' },
};
const translate = (language, source) => catalog[language]?.[source];

test('another game can supply its own languages, defaults, and message catalog', () => {
  const locale = new Localization({ languages, fallbackLanguage: 'de', preferredLocales: ['xx', 'it_CH'], translate });
  assert.equal(locale.preference, 'automatic');
  assert.equal(locale.language, 'it');
  assert.equal(locale.tag, 'it-CH');
  assert.equal(locale.text('greeting', { name: 'Ada' }), 'Ciao Ada');
  assert.equal(locale.text('retry'), 'Erneut versuchen');
  assert.equal(locale.hasTranslation('retry'), false);
  assert.equal(locale.text('Unlisted {item}', { item: 'card' }), 'Unlisted card');
  assert.equal(locale.text('Unlisted {item}', {}), 'Unlisted {item}');
  assert.equal(locale.number(1234567.89), new Intl.NumberFormat('it-CH').format(1234567.89));
  assert.equal(locale.digits(1234), '1234');
  locale.setPlatformLocale('zh_Hant_TW');
  assert.equal(locale.language, 'zh-Hant');
  assert.equal(locale.tag, 'zh-Hant-TW');
  locale.setPlatformLocale(undefined, 'default');
  assert.equal(locale.tag, 'de-DE');
});

test('isolates saved preferences by key and keeps the current choice when storage is blocked', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const options = { languages, fallbackLanguage: 'de', preferredLocales: ['it'], translate };
  const first = { ...options, preferenceStore: { storage, key: 'first-game.language' } };
  const second = { ...options, preferenceStore: { storage, key: 'second-game.language' } };
  new Localization(first).select('he');
  const restored = new Localization(first);
  restored.setPlatformLocale('de_AT');
  assert.equal(restored.language, 'he');
  assert.equal(restored.rtl, true);
  assert.equal(restored.text('greeting', { name: 'Ada' }), 'שלום \u2068Ada\u2069');
  assert.equal(new Localization(second).language, 'it');
  restored.select('automatic');
  assert.equal(restored.tag, 'de-AT');
  assert.equal(new Localization(first).preference, 'automatic');

  const deny = () => { throw new Error('Storage blocked'); };
  const blocked = new Localization({ ...options, preferenceStore: { storage: { getItem: deny, setItem: deny }, key: 'language' } });
  blocked.select('he');
  assert.equal(blocked.language, 'he');
});
