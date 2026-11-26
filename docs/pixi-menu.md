# Adopting the PlayBridge Pixi gameplay menu

Render the gameplay Menu and Sound buttons and the menu popup entirely in Pixi. Games can use the optional `@playbridge/pixi` package or draw their own Pixi controls. `@playbridge/core` and the platform adapters remain renderer-independent.

## Install and pin

Use PixiJS v8 and a PlayBridge source revision that includes [`packages/pixi`](../packages/pixi/package.json). Record that revision in the game repository's submodule pin or equivalent dependency configuration. New adopters can add the [PlayBridge repository](https://github.com/mcorcosa/playbridge) as a Git submodule. The example uses `vendor/playbridge`. Adjust that path for a sibling checkout. Run these commands from the game root of a submodule-based adopter.

~~~sh
git submodule update --init --recursive
git -C vendor/playbridge rev-parse HEAD
npm --prefix vendor/playbridge ci --include=dev
npm --prefix vendor/playbridge run build
~~~

Confirm the printed revision is the intended menu-capable pin. On first adoption, run `npm install file:vendor/playbridge/packages/pixi` and record the dependency and lockfile. In an existing adopter, run `npm ci` after building the framework. Import from `@playbridge/pixi`. Use a single Pixi runtime in the game build. For linked packages in Vite, Reborn sets `resolve.dedupe: ['pixi.js']`.

## Wire the game

1. Construct `PixiGameMenu` and attach its `root` above the board. Supply `labels` with `menu`, `sound`, `soundOn`, `soundOff`, `resume`, and `title` from the game's translation catalog. Pass a game theme if desired. Choose the labels at construction and recreate the controls when changing locale. For render-on-demand games, pass `onVisualChange()` to invalidate a frame after menu visuals change.
2. Wire `isSoundEnabled()` to the current game setting. In `onToggleSound(event)`, use the game's sound service and forward the event where the audio system needs gesture activation. The game owns its preference key, storage, default, and audio behavior. The menu rereads the setting after the callback. Call `refreshSound()` when the sound state changes elsewhere.
3. Use `canOpen()` for availability checks and `onOpenChange(open)` for game effects. The game decides how to handle pending input, an accepted move, and app-specific clocks. Track an open menu as its own input or pause condition. On close, clear that condition and leave any active host pause, ad, purchase, or other overlay in control.
4. Call `setLayout({ width, height, menu, sound })` at startup and on resize. The sizes and button rectangles use `root` local coordinates. For a game with native canvas or window pointer handlers, convert coordinates to the same space and use `blocksPointer(x, y)` on pointer down to exclude the menu from board input. Keep that exclusion by pointer ID until release or cancel, even if the popup closes first. Preserve Pixi event delivery.
5. Route keyboard events through the game's input layer to `handleKey(event)` and stop game handling when it returns `true`. Check Tab and arrow navigation, Enter or Space activation, Escape, and focus return. The game owns canvas focus and accessibility instructions. Verify screen-reader behavior separately from Pixi keyboard focus. Use `setVisible()` and `close()` for game transitions and `destroy()` when removing the view.

[Exported options and methods](../packages/pixi/src/index.ts)

## Verify the adoption

- Run `npm --prefix vendor/playbridge test` after building PlayBridge. Run the game's tests, typecheck, and builds for its targets.
- In a game browser build, check mouse, touch, and keyboard. Confirm the popup blocks board input, an unfinished gesture cannot commit through it, and Resume returns to the same run. Exercise opening during an accepted move and closing while another pause condition is active.
- Change sound in both places, reload, and verify the existing preference persists. Check game-initiated changes, translated labels, narrow layouts, other overlays, and view teardown. Record local, SDK-mock, and hosted phone evidence separately.
