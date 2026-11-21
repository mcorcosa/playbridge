import type { AdOutcome, AdRequest } from '@playbridge/core';

export interface RewardedVideo {
  loadAsync(): Promise<void>;
  showAsync(): Promise<void>;
}

export interface FacebookAdSdk {
  getRewardedVideoAsync?(placementID: string): Promise<RewardedVideo>;
  getInterstitialAdAsync?(placementID: string): Promise<RewardedVideo>;
}

interface AdSlot {
  placementId: string;
  apiName: keyof FacebookAdSdk;
  ad?: RewardedVideo;
  preparing?: Promise<void>;
  loadEpoch: number;
  retryAt: number;
}

interface FacebookAdsOptions {
  getSDK: () => FacebookAdSdk | undefined;
  supports: (name: string) => boolean;
  rewardedPlacements: Readonly<Record<string, string>>;
  interstitialPlacement: string;
  initialRewarded?: string;
  interstitialAllowed: () => boolean;
  checkoutActive: () => boolean;
}

function makeSlot(placementId: string, apiName: keyof FacebookAdSdk): AdSlot {
  return { placementId, apiName, loadEpoch: 0, retryAt: 0 };
}

function adFailure(error: unknown): AdOutcome['status'] {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'USER_INPUT' || code === 'ADS_USER_CANCELLED') return 'cancelled';
  if (code === 'ADS_NO_FILL' || code === 'ADS_NOT_LOADED') return 'unavailable';
  return 'failed';
}

export function createFacebookAds(options: FacebookAdsOptions) {
  const rewardedSlots = new Map(Object.entries(options.rewardedPlacements).map(([placement, id]) =>
    [placement, makeSlot(id.trim(), 'getRewardedVideoAsync')] as const));
  const interstitial = makeSlot(options.interstitialPlacement, 'getInterstitialAdAsync');
  let showing = false;

  function preload(slot: AdSlot): Promise<void> {
    if (slot === interstitial && (!options.interstitialAllowed() || options.checkoutActive())) return Promise.resolve();
    if (slot.preparing) return slot.preparing;
    const sdk = options.getSDK();
    const loadAd = sdk?.[slot.apiName];
    if (slot.ad || Date.now() < slot.retryAt || !slot.placementId.trim() || !loadAd
      || !options.supports(slot.apiName)) return Promise.resolve();

    const epoch = ++slot.loadEpoch;
    const isCurrentLoad = () => epoch === slot.loadEpoch
      && (slot !== interstitial || options.interstitialAllowed());
    const operation = (async () => {
      const ad = await loadAd.call(sdk, slot.placementId);
      if (!isCurrentLoad()) return;
      await ad.loadAsync();
      if (isCurrentLoad()) slot.ad = ad;
    })();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('Facebook ad preparation timeout')), 5000);
    });
    slot.preparing = Promise.race([operation, timeout]).catch(() => {
      if (epoch === slot.loadEpoch) slot.loadEpoch++;
      slot.retryAt = Date.now() + 30_000;
    }).finally(() => {
      clearTimeout(timer);
      slot.preparing = undefined;
    });
    return slot.preparing;
  }

  async function request(request: AdRequest): Promise<AdOutcome> {
    if (showing || options.checkoutActive()) return { status: 'pending', attempted: false };
    const isInterstitial = request.kind === 'interstitial';
    const slot = isInterstitial ? interstitial : rewardedSlots.get(request.placement);
    if (!slot?.placementId.trim() || (isInterstitial && !options.interstitialAllowed())) {
      return { status: 'unavailable', attempted: false };
    }

    const sdk = options.getSDK();
    if (!options.supports(slot.apiName) || (sdk && !sdk[slot.apiName])) {
      return { status: 'unsupported', attempted: false };
    }
    if (isInterstitial && !slot.ad) {
      void preload(slot);
      return { status: 'unavailable', attempted: false };
    }

    showing = true;
    let attempted = false;
    try {
      if (!isInterstitial) await preload(slot);
      const ad = slot.ad;
      if (!ad) return { status: 'unavailable', attempted: false };
      if (request.isCurrent?.() === false) return { status: 'failed', attempted: false };
      slot.ad = undefined;
      attempted = true;
      request.onAttempt?.();
      await ad.showAsync();
      return { status: 'completed', attempted };
    } catch (error) {
      return { status: attempted ? adFailure(error) : 'unavailable', attempted };
    } finally {
      showing = false;
      if (attempted) void preload(slot);
    }
  }

  return {
    request,
    prepareInitial(): void {
      const initial = options.initialRewarded === undefined ? undefined : rewardedSlots.get(options.initialRewarded);
      if (initial) void preload(initial);
      void preload(interstitial);
    },
    interstitialReady(): boolean {
      if (!options.interstitialAllowed()) return false;
      if (!interstitial.ad) void preload(interstitial);
      return !!interstitial.ad;
    },
    syncInterstitial(): void {
      if (options.interstitialAllowed()) {
        void preload(interstitial);
      } else {
        interstitial.ad = undefined;
        interstitial.loadEpoch++;
      }
    },
    get showing(): boolean { return showing; },
  };
}
