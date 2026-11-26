# PlayBridge

PlayBridge provides browser-game platform services. This is a separate Git repository. Games choose an adapter at startup and keep their own gameplay, Pixi screens, saved data schemas, product offers, and release configuration.

## Authority and scope

The 21 November 2026 project-manager delegation establishes the name, separate repository, Facebook Instant Games, CrazyGames and SDK-free web targets, capability-driven behavior, isolated platform data, and Penguin Pop Party as the first adopter. See Rowshift decisions CHZ-005/006 and the 13 November Facebook review and 16 November CrazyGames Basic decisions in the sibling game repository.

The package structure and migration order below are implementation proposals. Use private workspace orchestration with individually versioned ESM packages and TypeScript declarations. Start at 0.1.0 and test sibling checkout consumption before considering a distribution channel. A later `@playbridge/backend` can implement the same service interfaces against a separately hosted service. Native hosts would need asynchronous lifecycle, secure persistence, checkout and identity adapters, plus a way to report application suspension. Assess those interfaces when a native host is selected.

## Platform audit and interface

- **Lifecycle and loading.** Facebook initializes, advertises loader completion, starts the game and then hands control to the Pixi privacy flow. Retain that ordering and the pause/flush behavior. CrazyGames SDK v3 initializes before SDK calls, reports loading around Pixi preload, and reports actual gameplay transitions. The SDK-free targets give control directly to the game. Browser focus continues to control local rendering and audio. The CrazyGames host measures focus independently.
- **Persistence and identity.** Facebook transports structured values using player data and provides the player ID for the game's account-scoped browser cache. Web uses browser storage or injected storage. CrazyGames Basic keeps the existing `crazygames.` keys and memory fallback, including audio and skin preferences. Keep the existing record merge, preference validation, ad history, and purchase reconciliation in the game. CrazyGames SDK Data and account sync are future work requiring explicit save migration and portal setup.
- **Ads and purchases.** The Facebook adapter owns vendor readiness, error mapping and SDK operations. The game owns placement selection, ad cadence, reward policies, entitlement verification and Pixi presentation. Basic and production web expose unsupported operations when there is no provider. A deterministic adapter handles developer simulations. The common outcomes are completed, cancelled, unavailable, unsupported, pending and failed. A completed interstitial means the host returned successfully. A checkout acceptance can remain pending until the ownership check confirms it.
- **Rankings, sharing and analytics.** Facebook provides contextual scores and submits retained-score metadata. The game owns the metadata schema and score eligibility. CrazyGames Basic and web show game-owned personal records. Sharing stays unsupported in this milestone. Meta events remain consent-gated. CrazyGames loading/gameplay signals are host lifecycle events. Games supply product configuration and consent decisions and retain Pixi ownership of player-facing copy.
- **Diagnostics and capability discovery.** Inject SDK access, storage and any optional diagnostics at composition. Read capabilities after initialization or when presenting an action. Unsupported means the target does not implement that operation. Unavailable means a supported operation cannot run in the current configuration or session. Optional operations return typed outcomes independently of any earlier capability read. Keep vendor codes and raw errors out of player-facing copy.

## Package plan and acceptance

1. **Foundation.** `@playbridge/core` defines platform contracts and outcomes without SDK, DOM or renderer imports. `@playbridge/web` provides the browser-storage seam and SDK-free runtime. `@playbridge/testing` provides deterministic storage, lifecycle events and scripted results. Verify package typechecking, consumption, and no transitive SDK/renderer dependencies.
2. **CrazyGames vertical slice.** Develop `@playbridge/crazygames` against the core while the Facebook migration proceeds. Preserve the existing SDK-free Basic build. Provide an SDK-enabled Basic validation build that awaits v3 initialization, handles disabled/unavailable SDK, emits loading and deduplicated gameplay events, and uses the same CrazyGames-only Basic save scope. Both builds must reach the board with free hints and personal records. Full monetization, cloud data, sign-in, and leaderboards depend on a later approved launch scope. [CrazyGames SDK](https://docs.crazygames.com/sdk/intro/) · [Game events](https://docs.crazygames.com/sdk/game/) · [Launch requirements](https://docs.crazygames.com/requirements/technical/#sdk-integration)
3. **Facebook migration.** Introduce `@playbridge/facebook` behind the existing game-facing interface. Keep current SDK script/version, start sequencing, existing storage keys, ad/reward distinctions, consent rules, contextual rankings, and product entitlement behavior. Exercise the existing Facebook tests and adapter outcomes before changing presentation wiring.
4. **First adopter.** Select each target at Rowshift's composition root. Pass capability or game policy through Boot; gameplay calls the same interface across targets. At the shared checkpoint run focused tests and typechecking, then the full Rowshift suite and target builds. Verify SDK script isolation and document mock/build evidence separately from a hosted SDK run. Review behavior on authorized hosted builds separately.

No product input is needed for local implementation. External distribution, portal changes, hosted submissions, new monetization, and account linking require separate authorization. The existing Basic build is the release-oriented CrazyGames target. The SDK-enabled variant is for validation until its hosted behavior is checked.

## Local use

Run `npm ci`, `npm run build` and `npm test` in this repository. Rebuild after changing package source. Package entry points are compiled ESM and declarations under each package's `dist/`. Core and the adapters have zero external runtime dependencies.

Penguin Pop Party resolves the packages from a sibling checkout named `playbridge`. Build this repository before installing Rowshift's dependencies. Other games can consume the same ESM entry points from workspace links or local package archives. Keep core and adapters on a compatible version and pass a storage transport scoped to the game and target.

Call `lifecycle.initialize()` before using host APIs. Read capabilities when composing a game flow and handle each optional operation's result at the call site. Report loading around actual content preload, and report gameplay only when the game accepts input or enters a break. The CrazyGames adapter deduplicates state changes. Browser blur and visibility still belong to the game shell.

Use `analytics.setConsent(allowed)` after the game loads or saves its choice. Call `track(name)` for a bare event or `track(name, { value, properties })` to supply a finite numeric value and up to 16 string, finite number, or boolean properties. Names and keys use 1–40 ASCII letters, digits and underscores, starting with a letter. Property strings are limited to 100 characters. The game owns the event schema and omits private data.

The Facebook adapter forwards consented events to `FBInstant.logEvent` and converts scalar properties to strings. A successful call signals SDK acceptance. An SDK error return or exception yields `failed`. CrazyGames provides host loading and gameplay events through lifecycle, and reports custom analytics as unsupported. Web also reports custom analytics as unsupported. The test adapter captures consented events in memory.

When checkout reports `completed`, the provider returned a matching receipt. When it reports `pending`, the result may still settle. Both paths can consult inventory before activating a durable entitlement. The caller owns entitlement policy and player-facing copy. [Meta Instant Games lifecycle](https://developers.facebook.com/docs/games/instant-games/guides/lifecycle/)

## Pixi gameplay menu

The optional `@playbridge/pixi` package provides PixiJS v8 Menu and Sound buttons and a gameplay popup. Start with the [cross-game adoption guide](docs/pixi-menu.md) for installation, game hooks, input ownership, and verification.

## Localization

Import `Localization` from `@playbridge/core`. Each game supplies its supported language tags, default language and translation lookup. Initialize one instance per game. Pass the device or browser language preferences in priority order and optionally provide a game-scoped preference store.

```ts
import { Localization } from '@playbridge/core';
import { scopedBrowserStorage } from '@playbridge/web';

const french: Readonly<Record<string, string>> = { Play: 'Jouer' };
const locale = new Localization({
  languages: { en: { formatLocale: 'en-US' }, fr: {} },
  fallbackLanguage: 'en',
  preferredLocales: navigator.languages,
  preferenceStore: {
    storage: scopedBrowserStorage('example.web.', () => window.localStorage),
    key: 'language',
  },
  translate: (language, message) => language === 'fr' ? french[message] : undefined,
});

// For a hosted build, pass the host locale after the SDK is ready.
await platform.lifecycle.initialize();
locale.setPlatformLocale(platform.locale?.());

locale.text('Play');
locale.number(1234567);
```

- The saved choice overrides automatic detection. Call `select('automatic')` to return to detection. If storage is blocked, selections still apply for the current visit.
- Automatic detection tries the SDK locale, the preferred device or browser languages, then the game's default. Use `setPlatformLocale(value, 'default')` when the host requires skipping the device or browser fallback. Supported regional locales retain their region for formatting.
- `text(source, values)` tries the active catalog, the default catalog, then the source string. Provide named placeholders such as `{name}` for interpolation. `number(value)` uses localized grouping and `digits(value)` omits it. Set `direction: 'rtl'` on languages that need right-to-left layout and use `locale.rtl` in the renderer.
- The game supplies its picker, language labels, fonts and flags. After a selection, render the current screen again with the same game state.
