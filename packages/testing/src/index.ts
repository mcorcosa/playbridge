import { unsupportedServices, type AdOutcome, type AdRequest, type LoadingEvent, type Outcome, type PlatformServices, type PurchaseRecord } from '@playbridge/core';

type Event = LoadingEvent | 'initialize' | 'start' | 'flush' | 'play' | 'stop';

export function createTestPlatform({
  adOutcomes, purchaseOutcomes,
}: {
  adOutcomes?: ReadonlyArray<AdOutcome>;
  purchaseOutcomes?: ReadonlyArray<Outcome<PurchaseRecord>>;
} = {}) {
  const ads = [...adOutcomes ?? []];
  const purchases = [...purchaseOutcomes ?? []];
  const events: Event[] = [];
  const data = new Map<string, unknown>();
  const pauses = new Set<() => void>();
  let playing = false;
  const unsupported = unsupportedServices({
    async initialize() { events.push('initialize'); },
    async start() { events.push('start'); },
    loading(event) { events.push(event); },
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      events.push(playing ? 'play' : 'stop');
    },
    onPause(callback) {
      pauses.add(callback);
      return () => { pauses.delete(callback); };
    },
  }, {
    async get(key) { return structuredClone(data.get(key)); },
    async set(key, value) { data.set(key, structuredClone(value)); },
    async flush() { events.push('flush'); },
  });
  const platform: PlatformServices = {
    ...unsupported,
    capabilities: () => ({
      ...unsupported.capabilities(),
      hostLoading: 'available',
      hostGameplay: 'available',
      rewardedAds: adOutcomes ? 'available' : 'unsupported',
      interstitialAds: adOutcomes ? 'available' : 'unsupported',
      purchases: purchaseOutcomes ? 'available' : 'unsupported',
    }),
    ads: { async request(request: AdRequest) {
      if (!adOutcomes) return unsupported.ads.request(request);
      if (request.isCurrent?.() === false) return { status: 'cancelled', attempted: false };
      const outcome = ads.shift() ?? { status: 'unavailable', attempted: false };
      if (outcome.attempted) request.onAttempt?.();
      return outcome;
    } },
    purchases: {
      ...unsupported.purchases,
      async checkout(productId, isCurrent) {
        if (!purchaseOutcomes) return unsupported.purchases.checkout(productId);
        if (isCurrent?.() === false) return { status: 'cancelled' };
        return purchases.shift() ?? { status: 'unavailable' };
      },
    },
  };
  return { platform, events: events as readonly Event[], pause: () => { for (const callback of pauses) callback(); } };
}
