import {
  type Lifecycle,
  type Persistence,
  type PlatformServices,
  unsupportedServices,
} from "@playbridge/core";

interface CrazyGamesGame {
  loadingStart?(): void;
  loadingStop?(): void;
  gameplayStart?(): void;
  gameplayStop?(): void;
}

export interface CrazyGamesSdk {
  init(): Promise<void>;
  readonly environment?: string;
  readonly game?: CrazyGamesGame;
}

export interface CrazyGamesOptions {
  /** The game's existing CrazyGames-scoped Basic storage. */
  persistence: Persistence;
  /** The SDK v3 global when the host build opts in to loading the script. */
  getSdk?: () => CrazyGamesSdk | undefined;
  initTimeoutMs?: number;
}

const DEFAULT_INIT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function createCrazyGamesPlatform(options: CrazyGamesOptions): PlatformServices {
  let initialization: Promise<void> | undefined;
  let loading: ((active: boolean) => void) | undefined;
  let gameplay: ((active: boolean) => void) | undefined;

  async function initializeSdk(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sdk = options.getSdk?.();
      if (!sdk) return;

      const requestedTimeout = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
      const timeout = Number.isFinite(requestedTimeout)
        ? Math.min(Math.max(requestedTimeout, 0), MAX_TIMEOUT_MS)
        : DEFAULT_INIT_TIMEOUT_MS;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeout);
      });
      const initialized = await Promise.race([sdk.init().then(() => true), timedOut]);
      if (!initialized) return;

      const environment = sdk.environment;
      if (environment !== "local" && environment !== "crazygames") return;

      const game = sdk.game;
      if (!game) return;

      if (typeof game.loadingStart === "function" && typeof game.loadingStop === "function") {
        loading = createSignal(game.loadingStart.bind(game), game.loadingStop.bind(game));
      }
      if (typeof game.gameplayStart === "function" && typeof game.gameplayStop === "function") {
        gameplay = createSignal(game.gameplayStart.bind(game), game.gameplayStop.bind(game));
      }
    } catch {
      // The Basic game can start even if the portal SDK cannot initialize.
    } finally {
      clearTimeout(timer);
    }
  }

  function initialize(): Promise<void> {
    initialization ??= initializeSdk();
    return initialization;
  }

  const lifecycle: Lifecycle = {
    initialize,
    start: initialize,
    loading(event) {
      if (event.phase === "progress") return;
      try {
        loading?.(event.phase === "start");
      } catch {
        loading = undefined;
      }
    },
    setPlaying(playing) {
      try {
        gameplay?.(playing);
      } catch {
        gameplay = undefined;
      }
    },
    onPause: () => () => {},
  };

  const basic = unsupportedServices(lifecycle, options.persistence);
  return {
    ...basic,
    capabilities: () => ({
      ...basic.capabilities(),
      hostLoading: loading ? "available" : options.getSdk ? "unavailable" : "unsupported",
      hostGameplay: gameplay ? "available" : options.getSdk ? "unavailable" : "unsupported",
    }),
  };
}

function createSignal(start: () => void, stop: () => void): (active: boolean) => void {
  let active = false;
  return (next) => {
    if (active === next) return;
    active = next;
    if (active) start();
    else stop();
  };
}
