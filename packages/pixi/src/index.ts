import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import 'pixi.js/events';

/** Returns a text rasterization tier for the renderer and the text's display scale. */
export function pixiTextResolution(rendererResolution: number, displayScale = 1): number {
  const resolution = Number.isFinite(rendererResolution) && rendererResolution > 0 ? rendererResolution : 1;
  const scale = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  return Math.min(4, Math.max(1, Math.ceil(resolution * scale)));
}

export interface PixiGameMenuLabels {
  menu: string;
  sound: string;
  soundOn: string;
  soundOff: string;
  resume: string;
  title: string;
}

export interface PixiGameMenuTheme {
  /** Font family for the popup title and button text. */
  fontFamily: string;
  /** Color of the icons and popup text. */
  textColor: number;
  /** Fill color of the toolbar and popup buttons. */
  buttonColor: number;
  /** Fill color of a hovered button. */
  buttonHoverColor: number;
  /** Stroke color of the keyboard focus indicator. */
  focusColor: number;
  /** Fill color of the popup panel. */
  panelColor: number;
  /** Color and opacity of the overlay behind the popup. */
  scrimColor: number;
  scrimAlpha: number;
}

export interface PixiGameMenuOptions {
  labels: PixiGameMenuLabels;
  isSoundEnabled(): boolean;
  onToggleSound(event: Event): void;
  onOpenChange(open: boolean): void;
  /** Invalidates a frame when the menu changes appearance. */
  onVisualChange?(): void;
  canOpen?(): boolean;
  theme?: Partial<PixiGameMenuTheme>;
}

export interface PixiGameMenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixiGameMenuLayout {
  width: number;
  height: number;
  menu: PixiGameMenuRect;
  sound: PixiGameMenuRect;
}

const defaultTheme: PixiGameMenuTheme = {
  fontFamily: 'system-ui, sans-serif',
  textColor: 0xffffff,
  buttonColor: 0x34415d,
  buttonHoverColor: 0x485a7d,
  focusColor: 0xffd888,
  panelColor: 0x202a40,
  scrimColor: 0x111521,
  scrimAlpha: 0.74,
};

const panelWidth = 288;
const panelHeight = 204;

interface Button {
  view: Container;
  background: Graphics;
  focusRing: Graphics;
  area: Rectangle;
  hovered: boolean;
  activate(event: Event): void;
}

export class PixiGameMenu {
  readonly root = new Container({ label: 'PixiGameMenu', eventMode: 'static' });
  private readonly toolbar = new Container();
  private readonly modal = new Container({ eventMode: 'static' });
  private readonly viewport = new Rectangle();
  private readonly scrim = new Graphics({ eventMode: 'none' });
  private readonly panel = new Container();
  private readonly menuIcon = new Graphics({ eventMode: 'none' });
  private readonly soundIcon = new Graphics({ eventMode: 'none' });
  private readonly theme: PixiGameMenuTheme;
  private readonly menuButton: Button;
  private readonly soundButton: Button;
  private readonly resumeButton: Button;
  private readonly modalSoundButton: Button;
  private readonly soundState: Text;
  private readonly textLabels: readonly Text[];
  private textResolution: number | undefined;
  private readonly presses = new Map<number, Button>();
  private focused: Button | undefined;
  private showFocus = false;
  private soundEnabled: boolean | undefined;
  private open = false;
  private destroyed = false;

  constructor(private readonly options: PixiGameMenuOptions) {
    const { labels } = options;
    this.theme = { ...defaultTheme, ...options.theme };
    this.menuButton = this.createButton(labels.menu, () => {
      if (this.options.canOpen?.() !== false) this.setOpen(true);
    });
    this.soundButton = this.createButton(labels.sound, this.toggleSound);
    this.resumeButton = this.createButton(labels.resume, () => this.close());
    this.modalSoundButton = this.createButton(labels.sound, this.toggleSound);
    this.menuButton.view.addChild(this.menuIcon);
    this.soundButton.view.addChild(this.soundIcon);
    this.toolbar.addChild(this.menuButton.view, this.soundButton.view);

    this.menuIcon.moveTo(-8, -6).lineTo(8, -6).moveTo(-8, 0).lineTo(8, 0).moveTo(-8, 6).lineTo(8, 6)
      .stroke({ color: this.theme.textColor, width: 2, cap: 'round' });

    const panelBackground = new Graphics({ eventMode: 'none' });
    panelBackground.roundRect(0, 0, panelWidth, panelHeight, 18).fill(this.theme.panelColor);
    const title = this.createText(labels.title, 24, '700', panelWidth / 2, 33);
    const resume = this.createText(labels.resume, 18, '600', 120, 22);
    const sound = this.createText(labels.sound, 16, '600', 120, 16);
    this.soundState = this.createText('', 13, '400', 120, 36);
    this.textLabels = [title, resume, sound, this.soundState];
    this.resumeButton.view.addChild(resume);
    this.modalSoundButton.view.addChild(sound, this.soundState);
    this.placeButton(this.resumeButton, { x: 24, y: 66, width: 240, height: 44 });
    this.placeButton(this.modalSoundButton, { x: 24, y: 124, width: 240, height: 52 });
    this.panel.pivot.set(panelWidth / 2, panelHeight / 2);
    this.panel.addChild(panelBackground, title, this.resumeButton.view, this.modalSoundButton.view);

    this.modal.accessibleTitle = labels.title;
    this.modal.hitArea = this.viewport;
    this.modal.visible = false;
    this.modal.addChild(this.scrim, this.panel);
    this.root.addChild(this.toolbar, this.modal);
    for (const type of ['pointerdown', 'pointerup', 'pointerupoutside', 'pointertap', 'click', 'tap'] as const) {
      this.root.on(type, (event) => event.stopPropagation());
    }
    this.updateSound();
  }

  get isOpen(): boolean {
    return this.open;
  }

  setLayout(layout: PixiGameMenuLayout): void {
    if (this.destroyed) return;
    const width = Math.max(0, layout.width);
    const height = Math.max(0, layout.height);
    this.viewport.width = width;
    this.viewport.height = height;
    this.scrim.clear();
    if (width > 0 && height > 0) {
      this.scrim.rect(0, 0, width, height).fill({
        color: this.theme.scrimColor,
        alpha: this.theme.scrimAlpha,
      });
    }
    this.panel.position.set(width / 2, height / 2);
    this.panel.scale.set(Math.min(1, width * 0.9 / panelWidth, height * 0.9 / panelHeight));

    this.placeButton(this.menuButton, layout.menu);
    this.placeButton(this.soundButton, layout.sound);
    this.placeIcon(this.menuIcon, this.menuButton.area);
    this.placeIcon(this.soundIcon, this.soundButton.area);
    if (this.root.visible) this.options.onVisualChange?.();
  }

  /** Sets the rasterization tier for the popup labels in menu space. */
  setTextResolution(resolution: number): void {
    if (this.destroyed) return;
    const tier = pixiTextResolution(resolution);
    if (tier === this.textResolution) return;
    this.textResolution = tier;
    for (const label of this.textLabels) label.resolution = tier;
    if (this.open) this.options.onVisualChange?.();
  }

  blocksPointer(x: number, y: number): boolean {
    if (this.destroyed || !this.root.visible) return false;
    return this.open || [this.menuButton, this.soundButton].some(({ view, area }) =>
      area.contains(x - view.x, y - view.y));
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this.root.visible === visible) return;
    this.root.visible = visible;
    if (visible) {
      this.updateSound();
    } else {
      this.presses.clear();
      this.setFocus(undefined, false, false);
      this.setHovered(this.menuButton, false, false);
      this.setHovered(this.soundButton, false, false);
      if (this.open) {
        this.close();
        return;
      }
    }
    this.options.onVisualChange?.();
  }

  refreshSound(): void {
    if (!this.destroyed && this.updateSound() && this.root.visible) this.options.onVisualChange?.();
  }

  handleKey(event: KeyboardEvent): boolean {
    if (this.destroyed || !this.root.visible || event.altKey || event.ctrlKey || event.metaKey) return false;

    switch (event.key) {
      case 'Tab':
        if (!this.moveFocus(event.shiftKey ? -1 : 1, this.open, true)) return false;
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.open || !this.moveFocus(event.key === 'ArrowLeft' ? -1 : 1, true, false)) return false;
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!this.open || !this.moveFocus(event.key === 'ArrowUp' ? -1 : 1, true, false)) return false;
        break;
      case 'Enter':
      case ' ': {
        const button = this.focused;
        if (!button) return false;
        this.setFocus(button, true);
        if (!event.repeat && this.focused === button) button.activate(event);
        break;
      }
      case 'Escape':
        if (!this.open) return false;
        this.showFocus = true;
        this.close();
        break;
      default:
        return false;
    }

    event.preventDefault();
    return true;
  }

  close(): void {
    this.setOpen(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.visible = false;
    this.presses.clear();
    try {
      this.close();
    } finally {
      this.focused = undefined;
      this.root.destroy({ children: true });
    }
  }

  private updateSound(): boolean {
    const enabled = this.options.isSoundEnabled();
    if (enabled === this.soundEnabled) return false;
    this.soundEnabled = enabled;
    const state = enabled ? this.options.labels.soundOn : this.options.labels.soundOff;
    this.soundButton.view.accessibleHint = state;
    this.modalSoundButton.view.accessibleHint = state;
    this.soundState.text = state;

    const icon = this.soundIcon.clear();
    icon.poly([-9, -3, -5, -3, 0, -7, 0, 7, -5, 3, -9, 3]).fill(this.theme.textColor);
    if (enabled) {
      icon.moveTo(3, -4).quadraticCurveTo(7, 0, 3, 4)
        .moveTo(6, -7).quadraticCurveTo(12, 0, 6, 7);
    } else {
      icon.moveTo(4, -3).lineTo(10, 3).moveTo(10, -3).lineTo(4, 3);
    }
    icon.stroke({ color: this.theme.textColor, width: 1.7, cap: 'round' });
    return true;
  }

  private createButton(label: string, activate: (event: Event) => void): Button {
    const view = new Container({
      label,
      eventMode: 'static',
      interactiveChildren: false,
      cursor: 'pointer',
    });
    const area = new Rectangle();
    const background = new Graphics({ eventMode: 'none' });
    const focusRing = new Graphics({ eventMode: 'none', visible: false });
    const button = { view, area, background, focusRing, hovered: false, activate };
    view.addChild(background, focusRing);
    view.hitArea = area;
    view.accessibleTitle = label;

    view.on('pointerover', () => this.setHovered(button, true));
    view.on('pointerout', () => this.setHovered(button, false));
    view.on('pointerdown', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      this.presses.set(event.pointerId, button);
      this.setFocus(button, false);
    });
    view.on('pointerupoutside', (event: FederatedPointerEvent) => {
      if (event.button === 0) this.presses.delete(event.pointerId);
    });
    view.on('pointercancel', (event: FederatedPointerEvent) => {
      this.presses.delete(event.pointerId);
    });
    view.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0 || this.presses.get(event.pointerId) !== button) return;
      this.presses.delete(event.pointerId);
      const native = event.nativeEvent;
      button.activate(native && 'preventDefault' in native ? native : new Event('pointertap'));
    });
    return button;
  }

  private createText(text: string, fontSize: number, fontWeight: '400' | '600' | '700', x: number, y: number): Text {
    const view = new Text({
      text,
      x,
      y,
      anchor: 0.5,
      eventMode: 'none',
      style: { fill: this.theme.textColor, fontFamily: this.theme.fontFamily, fontSize, fontWeight, align: 'center' },
    });
    let fittedText: string | undefined;
    view.onRender = () => {
      if (!this.open || fittedText === view.text) return;
      const { width, height } = view.getLocalBounds();
      view.scale.set(Math.min(1, 216 / (width || 1), (fontSize + 5) / (height || 1)));
      fittedText = view.text;
    };
    return view;
  }

  private placeButton(button: Button, rect: PixiGameMenuRect): void {
    button.view.position.set(rect.x, rect.y);
    button.area.width = Math.max(0, rect.width);
    button.area.height = Math.max(0, rect.height);
    this.drawButton(button);
    button.focusRing.clear();
    const { width, height } = button.area;
    if (width > 4 && height > 4) {
      button.focusRing.roundRect(2, 2, width - 4, height - 4, Math.min(9, width / 2 - 2, height / 2 - 2))
        .stroke({ color: this.theme.focusColor, width: 2 });
    }
  }

  private placeIcon(icon: Graphics, area: Rectangle): void {
    icon.position.set(area.width / 2, area.height / 2);
    icon.scale.set(Math.min(area.width, area.height) / 32);
  }

  private drawButton(button: Button): void {
    const { width, height } = button.area;
    button.background.clear();
    if (width > 0 && height > 0) {
      button.background.roundRect(0, 0, width, height, Math.min(11, width / 2, height / 2))
        .fill(button.hovered ? this.theme.buttonHoverColor : this.theme.buttonColor);
    }
  }

  private setHovered(button: Button, hovered: boolean, notify = true): void {
    if (button.hovered === hovered) return;
    button.hovered = hovered;
    this.drawButton(button);
    if (notify && this.root.visible) this.options.onVisualChange?.();
  }

  private moveFocus(direction: number, wrap: boolean, fromUnfocused: boolean): boolean {
    const buttons = this.open ? [this.resumeButton, this.modalSoundButton] : [this.menuButton, this.soundButton];
    const current = this.focused ? buttons.indexOf(this.focused) : -1;
    if (current === -1) {
      if (!fromUnfocused) return false;
      this.setFocus(buttons[direction === 1 ? 0 : buttons.length - 1], true);
      return true;
    }
    const next = current + direction;
    if (wrap || (next >= 0 && next < buttons.length)) {
      this.setFocus(buttons[(next + buttons.length) % buttons.length], true);
      return true;
    }
    this.setFocus(undefined, false);
    return false;
  }

  private setFocus(button: Button | undefined, showFocus: boolean, notify = true): void {
    if (this.focused === button && this.showFocus === showFocus) return;
    const previousRing = this.showFocus ? this.focused : undefined;
    if (this.focused) this.focused.focusRing.visible = false;
    this.focused = button;
    this.showFocus = showFocus;
    if (button) button.focusRing.visible = showFocus;
    const nextRing = showFocus ? button : undefined;
    if (notify && previousRing !== nextRing) this.options.onVisualChange?.();
  }

  private readonly toggleSound = (event: Event): void => {
    this.options.onToggleSound(event);
    this.refreshSound();
  };

  private setOpen(open: boolean): void {
    if (this.open === open || (open && !this.root.visible)) return;
    this.open = open;
    this.presses.clear();
    this.toolbar.visible = !open;
    this.modal.visible = open;
    for (const button of [this.menuButton, this.soundButton, this.resumeButton, this.modalSoundButton]) {
      this.setHovered(button, false, false);
    }
    this.setFocus(this.root.visible ? (open ? this.resumeButton : this.menuButton) : undefined, this.showFocus, false);
    if (open) this.updateSound();
    this.options.onOpenChange(open);
    if (!this.destroyed) this.options.onVisualChange?.();
  }
}
