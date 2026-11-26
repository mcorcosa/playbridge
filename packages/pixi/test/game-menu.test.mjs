import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Container,
  EventBoundary,
  FederatedPointerEvent,
  Rectangle,
  Text,
  updateRenderGroupTransforms,
} from 'pixi.js';
import { PixiGameMenu, pixiTextResolution } from '../dist/index.js';

const labels = {
  menu: 'Game menu',
  sound: 'Sound',
  soundOn: 'On',
  soundOff: 'Off',
  resume: 'Resume',
  title: 'Game settings',
};

const layout = {
  width: 420,
  height: 320,
  menu: { x: 10, y: 16, width: 40, height: 36 },
  sound: { x: 370, y: 16, width: 40, height: 36 },
};

const menuPoint = [20, 26];
const soundPoint = [380, 26];
const resumePoint = [210, 146];
const modalSoundPoint = [210, 208];

function fixture(t, options = {}) {
  let enabled = true;
  let openAllowed = true;
  const toggles = [];
  const openChanges = [];
  let invalidations = 0;
  const menu = new PixiGameMenu({
    labels,
    isSoundEnabled: () => enabled,
    onToggleSound: (event) => {
      toggles.push(event);
      enabled = !enabled;
    },
    onOpenChange: (open) => openChanges.push({ open, observed: menu.isOpen }),
    onVisualChange: () => { invalidations++; },
    canOpen: () => openAllowed,
    ...options,
  });
  const stage = new Container({
    label: 'board',
    isRenderGroup: true,
    eventMode: 'static',
    hitArea: new Rectangle(0, 0, 480, 360),
  });
  stage.addChild(menu.root);
  menu.setLayout(layout);
  const boundary = new EventBoundary(stage);
  const syncTransforms = () => updateRenderGroupTransforms(stage.renderGroup, true);
  t.after(() => {
    menu.destroy();
    stage.destroy();
  });

  function pointer(type, [x, y], id = 1, button = 0, pointerType = 'mouse') {
    syncTransforms();
    const native = new Event(type);
    const event = new FederatedPointerEvent(boundary);
    event.type = type;
    event.global.set(x, y);
    event.pointerId = id;
    event.pointerType = pointerType;
    event.button = button;
    event.nativeEvent = native;
    boundary.mapEvent(event);
    return native;
  }

  function tap(point, id, button, pointerType) {
    pointer('pointerdown', point, id, button, pointerType);
    return pointer('pointerup', point, id, button, pointerType);
  }

  function key(value, details = {}) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: value, ...details });
    const consumed = menu.handleKey(event);
    assert.equal(event.defaultPrevented, consumed);
    return { consumed, event };
  }

  function hit(x, y) {
    syncTransforms();
    return boundary.hitTest(x, y);
  }

  return {
    menu, stage, pointer, tap, key, hit, toggles, openChanges,
    invalidations: () => invalidations,
    setEnabled: (value) => { enabled = value; },
    setOpenAllowed: (value) => { openAllowed = value; },
  };
}

function popupTextLabels(hit) {
  const resume = hit(...resumePoint);
  const sound = hit(...modalSoundPoint);
  return [
    resume.parent.children.find(child => child instanceof Text),
    ...resume.children.filter(child => child instanceof Text),
    ...sound.children.filter(child => child instanceof Text),
  ];
}

test('text resolution tiers round up the physical display scale and stay within 1–4', () => {
  assert.equal(pixiTextResolution(1), 1);
  assert.equal(pixiTextResolution(1, 1.5), 2);
  assert.equal(pixiTextResolution(1, 2), 2);
  assert.equal(pixiTextResolution(1.5), 2);
  assert.equal(pixiTextResolution(1.5, 1.5), 3);
  assert.equal(pixiTextResolution(2, 1.5), 3);
  assert.equal(pixiTextResolution(2, 0.4), 1);
  assert.equal(pixiTextResolution(2, 2.5), 4);
  assert.equal(pixiTextResolution(Number.MAX_VALUE, 2), 4);
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(pixiTextResolution(invalid, 2), 2);
    assert.equal(pixiTextResolution(2, invalid), 2);
  }
});

test('setting a text tier updates only popup labels and skips repeated tiers', (t) => {
  const { menu, tap, hit, invalidations } = fixture(t);
  const extraText = new Text({ text: 'Custom', resolution: 4, eventMode: 'none' });
  menu.root.addChild(extraText);

  const beforeOpen = invalidations();
  menu.setTextResolution(1);
  assert.equal(invalidations(), beforeOpen);
  tap(menuPoint);
  const texts = popupTextLabels(hit);
  assert.deepEqual(texts.map(text => text.text), [labels.title, labels.resume, labels.sound, labels.soundOn]);
  assert.ok(texts.every(text => text.resolution === 1));

  const updates = texts.map(text => t.mock.method(text, 'onViewUpdate'));
  const beforeChange = invalidations();
  menu.setTextResolution(2.2);
  assert.ok(texts.every(text => text.resolution === 3));
  assert.ok(updates.every(update => update.mock.callCount() === 1));
  assert.equal(extraText.resolution, 4);
  assert.equal(invalidations(), beforeChange + 1);

  menu.setTextResolution(3);
  assert.ok(updates.every(update => update.mock.callCount() === 1));
  assert.equal(invalidations(), beforeChange + 1);

  menu.setTextResolution(1);
  assert.ok(texts.every(text => text.resolution === 1));
  assert.ok(updates.every(update => update.mock.callCount() === 2));
  assert.equal(invalidations(), beforeChange + 2);
});

test('toolbar bounds are local and the popup recenters and shields the board', (t) => {
  const { menu, hit, tap, openChanges } = fixture(t);
  menu.root.position.set(22, 12);
  assert.equal(menu.blocksPointer(10, 16), true);
  assert.equal(menu.blocksPointer(50, 16), false);
  assert.equal(menu.blocksPointer(...soundPoint), true);
  assert.equal(menu.blocksPointer(100, 100), false);
  assert.equal(hit(32, 28).accessibleTitle, labels.menu);
  assert.equal(hit(72, 28).label, 'board');

  tap([42, 38]);
  assert.deepEqual(openChanges, [{ open: true, observed: true }]);
  assert.equal(menu.blocksPointer(0, 319), true);
  assert.equal(hit(23, 310).accessibleTitle, labels.title);
  assert.equal(hit(232, 158).accessibleTitle, labels.resume);
  tap([23, 310]);
  assert.equal(menu.isOpen, true);

  menu.setLayout({ ...layout, width: 128, height: 92 });
  assert.equal(hit(86, 52).accessibleTitle, labels.resume);
  tap([86, 52]);
  menu.close();
  assert.deepEqual(openChanges, [
    { open: true, observed: true },
    { open: false, observed: false },
  ]);
});

test('Pixi pointer routing consumes controls and forwards the native sound gesture', (t) => {
  const { stage, menu, hit, tap, pointer, toggles, setEnabled, setOpenAllowed } = fixture(t);
  const boardTaps = [];
  stage.on('pointertap', event => boardTaps.push(event.global.clone()));
  const toolbarSound = hit(...soundPoint);
  assert.equal(toolbarSound.accessibleTitle, labels.sound);
  assert.equal(toolbarSound.accessibleHint, labels.soundOn);
  assert.equal(Boolean(toolbarSound.accessible), false);
  const native = tap(soundPoint);
  assert.deepEqual(toggles, [native]);
  assert.equal(toolbarSound.accessibleHint, labels.soundOff);
  assert.equal(boardTaps.length, 0);

  tap(soundPoint, 1, 2);
  pointer('pointerdown', soundPoint);
  pointer('pointerup', [110, 90]);
  assert.equal(toggles.length, 1);
  const boardTapsBefore = boardTaps.length;
  tap([110, 90]);
  assert.equal(boardTaps.length, boardTapsBefore + 1);
  setOpenAllowed(false);
  tap(menuPoint);
  assert.equal(menu.isOpen, false);
  setOpenAllowed(true);
  tap(menuPoint);
  const popupSound = hit(...modalSoundPoint);
  assert.equal(popupSound.accessibleHint, labels.soundOff);
  assert.equal(Boolean(popupSound.accessible), false);
  const modalNative = tap(modalSoundPoint, 2, 0, 'touch');
  assert.deepEqual(toggles, [native, modalNative]);
  assert.equal(popupSound.accessibleHint, labels.soundOn);
  setEnabled(false);
  menu.refreshSound();
  assert.equal(popupSound.accessibleHint, labels.soundOff);
  assert.equal(toolbarSound.accessibleHint, labels.soundOff);
  tap(resumePoint);
  assert.equal(boardTaps.length, boardTapsBefore + 1);
});

test('a press cannot activate a control across modal or visibility changes', (t) => {
  const { menu, tap, pointer, key, toggles } = fixture(t);
  pointer('pointerdown', soundPoint, 1);
  tap(menuPoint, 2);
  assert.equal(menu.isOpen, true);
  pointer('pointerdown', modalSoundPoint, 3);
  assert.equal(key('Escape').consumed, true);
  pointer('pointerup', soundPoint, 1);
  tap(menuPoint, 2);
  pointer('pointerup', modalSoundPoint, 3);
  assert.equal(toggles.length, 0);

  pointer('pointerdown', modalSoundPoint, 4);
  menu.setVisible(false);
  assert.equal(menu.isOpen, false);
  assert.equal(menu.blocksPointer(...menuPoint), false);
  assert.equal(key('Tab').consumed, false);
  menu.setVisible(true);
  tap(menuPoint, 2);
  pointer('pointerup', modalSoundPoint, 4);
  assert.equal(toggles.length, 0);
  tap(modalSoundPoint, 4);
  assert.equal(toggles.length, 1);
});

test('keyboard focus invalidates the frame, traps Tab in the popup, and restores focus', (t) => {
  const { menu, pointer, key, invalidations, toggles, openChanges } = fixture(t);
  const initial = invalidations();
  pointer('pointerover', menuPoint);
  assert.ok(invalidations() > initial);
  const afterHover = invalidations();
  assert.equal(key('Enter').consumed, false);
  assert.equal(key('ArrowRight').consumed, false);
  assert.equal(key('Tab').consumed, true);
  assert.ok(invalidations() > afterHover);
  assert.equal(key('Enter').consumed, true);
  assert.equal(menu.isOpen, true);
  assert.equal(key('Enter', { repeat: true }).consumed, true);
  assert.equal(menu.isOpen, true);
  assert.equal(key('Tab', { shiftKey: true }).consumed, true);
  const soundKey = key(' ');
  assert.equal(soundKey.consumed, true);
  assert.deepEqual(toggles, [soundKey.event]);
  assert.equal(key('ArrowDown').consumed, true);
  assert.equal(key('Tab').consumed, true);
  assert.equal(key('ArrowUp').consumed, true);
  assert.equal(key('Escape').consumed, true);
  assert.equal(menu.isOpen, false);
  assert.equal(key('Enter', { ctrlKey: true }).consumed, false);
  assert.equal(key('Enter').consumed, true);
  assert.equal(menu.isOpen, true);
  assert.equal(key('Enter').consumed, true);
  assert.equal(menu.isOpen, false);
  assert.equal(key('ArrowRight').consumed, true);
  assert.equal(key('Tab').consumed, false);
  assert.equal(key('Enter').consumed, false);
  assert.deepEqual(openChanges.map(({ open }) => open), [true, false, true, false]);
});

test('long translated labels scale to the popup and the changed sound label is measured again', (t) => {
  const localized = {
    ...labels,
    title: 'Einstellungen während des laufenden Spiels',
    resume: 'Zum laufenden Spiel zurückkehren',
    sound: 'Lautstärke und Soundeffekte',
    soundOff: 'Die Soundeffekte sind ausgeschaltet',
  };
  const { stage, tap, setEnabled, menu, hit } = fixture(t, { labels: localized });
  tap(menuPoint);
  const texts = popupTextLabels(hit);
  const [title] = texts;
  const measureCount = new Map();
  for (const text of texts) {
    text.getLocalBounds = () => {
      measureCount.set(text, (measureCount.get(text) ?? 0) + 1);
      return new Rectangle(0, 0, text.text.length * 9, 18);
    };
  }

  stage.renderGroup.runOnRender({});
  for (const text of texts) {
    assert.ok(text.text.length * 9 * text.scale.x <= 216);
    assert.equal(measureCount.get(text), 1);
  }
  setEnabled(false);
  menu.refreshSound();
  stage.renderGroup.runOnRender({});
  assert.equal(measureCount.get(title), 1);
  const state = texts.at(-1);
  assert.equal(state.text, localized.soundOff);
  assert.equal(measureCount.get(state), 2);
  assert.ok(state.text.length * 9 * state.scale.x <= 216);
});

test('hide and destroy close synchronously and release the scene', (t) => {
  const { menu, stage, tap, key, openChanges } = fixture(t);
  tap(menuPoint);
  menu.setVisible(false);
  assert.deepEqual(openChanges.at(-1), { open: false, observed: false });
  menu.setVisible(true);
  tap(menuPoint);
  menu.destroy();
  menu.destroy();
  menu.setVisible(true);
  assert.deepEqual(openChanges.map(({ open }) => open), [true, false, true, false]);
  assert.equal(stage.children.length, 0);
  assert.equal(menu.root.destroyed, true);
  assert.equal(menu.blocksPointer(...menuPoint), false);
  assert.equal(key('Escape').consumed, false);
});
