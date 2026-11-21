export type Availability = 'available' | 'unavailable' | 'unsupported';
export type OutcomeStatus = 'completed' | 'cancelled' | 'unavailable' | 'unsupported' | 'pending' | 'failed';
export type Outcome<T = void> = { status: 'completed'; value: T } | {
  status: Exclude<OutcomeStatus, 'completed'>;
  error?: unknown;
};

export interface Capabilities {
  hostLoading: Availability;
  hostGameplay: Availability;
  identity: Availability;
  rewardedAds: Availability;
  interstitialAds: Availability;
  purchases: Availability;
  leaderboards: Availability;
  sharing: Availability;
  analytics: Availability;
}

export type LoadingEvent = { phase: 'start' | 'finish' } | { phase: 'progress'; percent: number };

export interface Lifecycle {
  initialize(): Promise<void>;
  start(): Promise<void>;
  loading(event: LoadingEvent): void;
  setPlaying(playing: boolean): void;
  onPause(callback: () => void): () => void;
}

/** Raw transport. The game owns keys, schema validation and merge policy. */
export interface Persistence {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  flush(): Promise<void>;
}

export interface AdRequest {
  kind: 'rewarded' | 'interstitial';
  placement: string;
  /** Checked again after asynchronous preparation, immediately before host UI. */
  isCurrent?: () => boolean;
  onAttempt?: () => void;
}

export interface AdOutcome {
  status: OutcomeStatus;
  attempted: boolean;
}

export interface LeaderboardEntry {
  playerId: string | null;
  playerName: string;
  score: number;
  rank: number;
  timestamp: number;
  extraData: string | null;
}

export interface Leaderboards {
  entries(board: string, scope: 'all' | 'connected', count: number, offset: number): Promise<Outcome<LeaderboardEntry[]>>;
  playerEntry(board: string): Promise<Outcome<LeaderboardEntry | null>>;
  submitScore(board: string, score: number, metadata: string): Promise<Outcome<LeaderboardEntry>>;
}

export interface CatalogProduct {
  productId: string;
  displayPrice: string | null;
}

export type PurchaseRecord = { productId: string } & (
  { state: 'active'; receiptToken: string } | { state: 'consumed' | 'unverified' }
);

export interface Purchases {
  catalog(): Promise<Outcome<CatalogProduct[]>>;
  inventory(): Promise<Outcome<PurchaseRecord[]>>;
  /** Pending indicates checkout may have succeeded. Reconcile against inventory. */
  checkout(productId: string, isCurrent?: () => boolean): Promise<Outcome<PurchaseRecord>>;
}

export type Logger = (event: string, cause?: unknown) => void;

export class PlatformError extends Error {
  constructor(readonly status: 'unavailable' | 'unsupported' | 'failed', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlatformError';
  }
}

export interface PlatformServices {
  capabilities(): Capabilities;
  lifecycle: Lifecycle;
  persistence: Persistence;
  identity(): Outcome<string | null>;
  ads: { request(request: AdRequest): Promise<AdOutcome> };
  purchases: Purchases;
  leaderboards: Leaderboards;
  share(text: string): Promise<Outcome>;
  analytics: { setConsent(allowed: boolean): void; track(event: string): Outcome };
}

const noOperation = async (): Promise<{ status: 'unsupported' }> => ({ status: 'unsupported' });

/** Defaults are explicit and safe for targets which only provide lifecycle and storage. */
export function unsupportedServices(lifecycle: Lifecycle, persistence: Persistence): PlatformServices {
  return {
    capabilities: () => ({
      hostLoading: 'unsupported', hostGameplay: 'unsupported', identity: 'unsupported',
      rewardedAds: 'unsupported', interstitialAds: 'unsupported', purchases: 'unsupported',
      leaderboards: 'unsupported', sharing: 'unsupported', analytics: 'unsupported',
    }),
    lifecycle,
    persistence,
    identity: () => ({ status: 'unsupported' }),
    ads: { request: async () => ({ status: 'unsupported', attempted: false }) },
    purchases: { catalog: noOperation, inventory: noOperation, checkout: noOperation },
    leaderboards: { entries: noOperation, playerEntry: noOperation, submitScore: noOperation },
    share: noOperation,
    analytics: { setConsent() {}, track: () => ({ status: 'unsupported' }) },
  };
}
