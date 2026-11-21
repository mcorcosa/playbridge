import { unsupportedServices, type Persistence, type PlatformServices } from '@playbridge/core';

export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Inject the storage getter so access failures (e.g. an iframe) can use session memory. */
export function scopedBrowserStorage(prefix: string, storage: () => StringStorage): StringStorage {
  const memory = new Map<string, string>();
  let available = true;
  return {
    getItem(key) {
      if (available) {
        try {
          const value = storage().getItem(prefix + key);
          if (value === null) memory.delete(key);
          else memory.set(key, value);
        } catch { available = false; }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (available) {
        try { storage().setItem(prefix + key, value); }
        catch { available = false; }
      }
    },
  };
}

export function createBrowserPersistence(storage: StringStorage): Persistence {
  return {
    async get(key) {
      const value = storage.getItem(key);
      return value === null ? undefined : JSON.parse(value);
    },
    async set(key, value) {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new TypeError('The value cannot be encoded as JSON.');
      storage.setItem(key, encoded);
    },
    async flush() {},
  };
}

export function createWebPlatform(storage: StringStorage): PlatformServices {
  return unsupportedServices({
    async initialize() {},
    async start() {},
    loading() {},
    setPlaying() {},
    onPause: () => () => {},
  }, createBrowserPersistence(storage));
}
