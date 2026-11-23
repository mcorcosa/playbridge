import { unsupportedServices, validAnalyticsEvent, type AnalyticsDetails, type AdOutcome, type AdRequest, type LoadingEvent, type Outcome, type PlatformServices, type PurchaseRecord } from '@playbridge/core';

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
  const analyticsEvents: { name: string; details?: AnalyticsDetails }[] = [];
  let analyticsAllowed = false;
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
      analytics: 'available',
      hostLoading: 'available',
      hostGameplay: 'available',
      rewardedAds: adOutcomes ? 'available' : 'unsupported',
      interstitialAds: adOutcomes ? 'available' : 'unsupported',
      purchases: purchaseOutcomes ? 'available' : 'unsupported',
    }),
    analytics: {
      setConsent(allowed) { analyticsAllowed = allowed; },
      track(name, details) {
        if (!analyticsAllowed) return { status: 'unavailable' };
        if (!validAnalyticsEvent(name, details)) return { status: 'failed' };
        analyticsEvents.push({ name, ...(details && { details: structuredClone(details) }) });
        return { status: 'completed', value: undefined };
      },
    },
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
  return { platform, analyticsEvents: analyticsEvents as readonly Readonly<{ name: string; details?: AnalyticsDetails }>[], events: events as readonly Event[], pause: () => { for (const callback of pauses) callback(); } };
}
