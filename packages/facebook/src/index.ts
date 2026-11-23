import { PlatformError, unsupportedServices, validAnalyticsEvent, type Availability, type Lifecycle, type Logger, type PlatformServices } from '@playbridge/core';
import { createFacebookAds, type FacebookAdSdk } from './ads.js';
import { createFacebookLeaderboards, type FacebookLeaderboard } from './leaderboards.js';
import { createFacebookPurchases, type FacebookPayments } from './purchases.js';

export type { RewardedVideo } from './ads.js';
export { createFacebookLeaderboards, type FacebookLeaderboard, type FacebookLeaderboardEntry } from './leaderboards.js';
export { createFacebookPurchases, type FacebookPayments } from './purchases.js';

export interface FacebookSDK extends FacebookAdSdk {
  payments?: FacebookPayments;
  getLeaderboardAsync?(name: string): Promise<FacebookLeaderboard>;
  initializeAsync(): Promise<void>;
  startGameAsync(): Promise<void>;
  setLoadingProgress(progress: number): void;
  getSupportedAPIs?(): string[];
  getLocale?(): string;
  onPause(callback: () => void): void;
  logEvent?(name: string, valueToSum?: number, parameters?: Record<string, string>): unknown;
  player: {
    getID?(): string | null;
    getDataAsync(keys: string[]): Promise<Record<string, unknown>>;
    setDataAsync(data: Record<string, unknown>): Promise<void>;
    flushDataAsync(): Promise<void>;
  };
}

export interface FacebookOptions {
  getSDK: () => FacebookSDK | undefined;
  awaitSDK?: () => Promise<void>;
  rewardedPlacements?: Readonly<Record<string, string>>;
  interstitialPlacement?: string;
  initialRewarded?: string;
  interstitialAllowed?: () => boolean;
  checkoutActive?: () => boolean;
  log?: Logger;
}

export interface FacebookServices extends PlatformServices {
  supports(name: string): boolean;
  ads: ReturnType<typeof createFacebookAds>;
  purchases: ReturnType<typeof createFacebookPurchases>;
}

export function createFacebookPlatform({
  getSDK, awaitSDK = async () => {}, rewardedPlacements = {}, interstitialPlacement = '',
  initialRewarded, interstitialAllowed = () => true, checkoutActive = () => false, log,
}: FacebookOptions): FacebookServices {
  let supported = new Set<string>();
  let consent = false;
  let initialized: Promise<void> | undefined;
  let localeSdk: FacebookSDK | undefined;
  let started: Promise<void> | undefined;
  const pauses = new Set<() => void>();
  const supports = (name: string) => supported.size === 0 || supported.has(name.replace(/^FBInstant\./, ''));
  const requireAPI = (name: string) => {
    if (!supports(name)) throw new PlatformError('unsupported', `Required Facebook API unavailable: ${name}`);
  };
  const api = () => {
    const sdk = getSDK();
    if (!sdk) throw new PlatformError('unavailable', 'Facebook SDK is unavailable. Check your connection and retry.');
    return sdk;
  };
  const lifecycle: Lifecycle = {
    initialize() {
      return initialized ??= (async () => {
        await awaitSDK();
        const sdk = api();
        await sdk.initializeAsync();
        supported = new Set((sdk.getSupportedAPIs?.() ?? []).map(name => name.replace(/^FBInstant\./, '')));
        sdk.onPause(() => { for (const callback of pauses) callback(); });
        lifecycle.loading({ phase: 'finish' });
        localeSdk = sdk;
      })().catch(error => { initialized = undefined; throw error; });
    },
    start() {
      return started ??= api().startGameAsync().then(() => ads.prepareInitial())
        .catch(error => { started = undefined; throw error; });
    },
    loading(event) {
      const progress = event.phase === 'progress' ? event.percent : event.phase === 'finish' ? 100 : 0;
      if (Number.isFinite(progress)) api().setLoadingProgress(Math.min(100, Math.max(0, progress)));
    },
    setPlaying() {},
    onPause(callback) {
      pauses.add(callback);
      return () => { pauses.delete(callback); };
    },
  };
  const fallback = unsupportedServices(lifecycle, {
    async get(key) { requireAPI('player.getDataAsync'); return (await api().player.getDataAsync([key]))[key]; },
    async set(key, value) { requireAPI('player.setDataAsync'); await api().player.setDataAsync({ [key]: value }); },
    async flush() { requireAPI('player.flushDataAsync'); await api().player.flushDataAsync(); },
  });
  const ads = createFacebookAds({ getSDK, supports, rewardedPlacements, interstitialPlacement, initialRewarded, interstitialAllowed, checkoutActive });
  const purchases = createFacebookPurchases(() => getSDK()?.payments);
  const leaderboards = createFacebookLeaderboards(name => {
    requireAPI('getLeaderboardAsync');
    const sdk = api();
    if (!sdk.getLeaderboardAsync) throw new PlatformError('unsupported', 'Facebook leaderboards are unavailable.');
    return sdk.getLeaderboardAsync(name);
  });
  const availability = (name: string, method: unknown, configured = true): Availability => {
    if (!supports(name)) return 'unsupported';
    return getSDK() && typeof method !== 'function' ? 'unsupported' : method && configured ? 'available' : 'unavailable';
  };
  return {
    ...fallback,
    supports, ads, purchases, leaderboards,
    locale() {
      try { return supports('getLocale') ? localeSdk?.getLocale?.() : undefined; }
      catch { return undefined; }
    },
    capabilities() {
      const sdk = getSDK();
      return {
        ...fallback.capabilities(),
        hostLoading: sdk?.setLoadingProgress ? 'available' : sdk ? 'unsupported' : 'unavailable',
        identity: sdk?.player?.getID ? 'available' : sdk ? 'unsupported' : 'unavailable',
        rewardedAds: availability('getRewardedVideoAsync', sdk?.getRewardedVideoAsync, Object.values(rewardedPlacements).some(id => !!id.trim())),
        interstitialAds: availability('getInterstitialAdAsync', sdk?.getInterstitialAdAsync, !!interstitialPlacement.trim()),
        purchases: typeof sdk?.payments?.onReady === 'function' && typeof sdk.payments.getPurchasesAsync === 'function'
          ? 'available' : sdk ? 'unsupported' : 'unavailable',
        leaderboards: availability('getLeaderboardAsync', sdk?.getLeaderboardAsync),
        analytics: availability('logEvent', sdk?.logEvent),
      };
    },
    identity() {
      const sdk = getSDK();
      if (!sdk) return { status: 'unavailable' };
      if (!sdk.player?.getID) return { status: 'unsupported' };
      try { return { status: 'completed', value: sdk.player.getID() }; }
      catch (error) { return { status: 'failed', error }; }
    },
    analytics: {
      setConsent(allowed) { consent = allowed; },
      track(event, details) {
        if (!supports('logEvent')) return { status: 'unsupported' };
        const sdk = getSDK();
        if (!consent || !sdk) return { status: 'unavailable' };
        if (typeof sdk.logEvent !== 'function') return { status: 'unsupported' };
        try {
          if (!validAnalyticsEvent(event, details)) return { status: 'failed' };
          const properties = details?.properties && Object.fromEntries(
            Object.entries(details.properties).map(([key, value]) => [key, String(value)]),
          );
          const result = properties === undefined && details?.value === undefined
            ? sdk.logEvent(event) : sdk.logEvent(event, details?.value, properties);
          if (result === null || result === undefined) return { status: 'completed', value: undefined };
          return { status: 'failed', ...(result && typeof result === 'object' ? { error: result } : {}) };
        } catch (error) {
          log?.('facebook.analytics.failed', error);
          return { status: 'failed', error };
        }
      },
    },
  };
}
