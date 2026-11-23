import assert from 'node:assert/strict';
import test from 'node:test';
import { createFacebookPlatform } from '../dist/index.js';
import { createTestPlatform } from '../../testing/dist/index.js';
import { createCrazyGamesPlatform } from '../../crazygames/dist/index.js';

test('Meta receives bounded scalars only after consent and SDK errors remain failures', () => {
  const calls = [];
  let result = null;
  const { analytics } = createFacebookPlatform({ getSDK: () => ({
    logEvent(...args) {
      calls.push(args);
      if (result instanceof Error) throw result;
      return result;
    },
  }) });
  assert.equal(analytics.track('launch').status, 'unavailable');
  analytics.setConsent(true);
  assert.equal(analytics.track('launch').status, 'completed');
  assert.equal(analytics.track('move', { value: 0, properties: { level: 3, rewarded: false, phase: 'open' } }).status, 'completed');
  assert.deepEqual(calls, [['launch'], ['move', 0, { level: '3', rewarded: 'false', phase: 'open' }]]);
  for (const details of [{ value: Infinity }, { properties: { big: 'x'.repeat(101) } }, { properties: { nested: [] } },
    { properties: Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['key' + i, i])) }]) {
    assert.equal(analytics.track('move', details).status, 'failed');
  }
  assert.equal(analytics.track('bad event').status, 'failed');
  assert.equal(calls.length, 2);
  result = { code: 'INVALID_PARAM' };
  assert.deepEqual(analytics.track('move'), { status: 'failed', error: result });
  result = Error('throw');
  assert.deepEqual(analytics.track('move'), { status: 'failed', error: result });
  analytics.setConsent(false);
  assert.equal(analytics.track('move').status, 'unavailable');
  assert.equal(calls.length, 4);
});

test('testing captures copies deterministically and CrazyGames has no custom analytics', () => {
  const { platform, analyticsEvents } = createTestPlatform();
  const details = { properties: { approved: true } };
  assert.equal(platform.analytics.track('before').status, 'unavailable');
  platform.analytics.setConsent(true);
  platform.analytics.track('kept', details);
  details.properties.approved = false;
  platform.analytics.setConsent(false);
  platform.analytics.track('after');
  assert.deepEqual(analyticsEvents, [{ name: 'kept', details: { properties: { approved: true } } }]);
  const crazy = createCrazyGamesPlatform({ getSDK: () => undefined });
  crazy.analytics.setConsent(true);
  assert.equal(crazy.analytics.track('any').status, 'unsupported');
});
