export type LanguagePreference<Language extends string> = Language | 'automatic';

export interface LanguageSettings {
  readonly formatLocale?: string;
  readonly direction?: 'ltr' | 'rtl';
}

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocalizationOptions<Language extends string> {
  readonly languages: Readonly<Record<Language, LanguageSettings>>;
  readonly fallbackLanguage: NoInfer<Language>;
  readonly preferredLocales?: readonly string[];
  readonly preferenceStore?: { readonly storage: LocaleStorage; readonly key: string };
  /** Return undefined to try the fallback language, then use the source message. */
  readonly translate?: (language: Language, source: string) => string | undefined;
}

export type MessageValues = Readonly<Record<string, string>>;

/** Locale selection and text formatting for one game instance. */
export class Localization<Language extends string> {
  private automatic;
  private preferenceValue: LanguagePreference<Language> = 'automatic';
  private formats;

  constructor(private readonly options: LocalizationOptions<Language>) {
    this.automatic = this.resolve(options.preferredLocales ?? []);
    try {
      const store = options.preferenceStore;
      const saved = store?.storage.getItem(store.key);
      if (this.isLanguage(saved)) this.preferenceValue = saved;
    } catch { /* Automatic also works when storage is blocked. */ }
    this.formats = this.numberFormats();
  }

  get preference(): LanguagePreference<Language> { return this.preferenceValue; }
  get language(): Language {
    return this.preferenceValue === 'automatic' ? this.automatic.language : this.preferenceValue;
  }
  get tag(): string {
    return this.language === this.automatic.language ? this.automatic.tag : this.formatTag(this.language);
  }
  get rtl(): boolean { return this.options.languages[this.language].direction === 'rtl'; }

  setPlatformLocale(value: unknown, fallback: 'preferred' | 'default' = 'preferred'): void {
    const preferredLocales = fallback === 'default' ? [] : this.options.preferredLocales ?? [];
    this.automatic = this.resolve([value, ...preferredLocales]);
    this.formats = this.numberFormats();
  }

  select(preference: LanguagePreference<Language>): void {
    if (preference !== 'automatic' && !this.isLanguage(preference)) return;
    this.preferenceValue = preference;
    this.formats = this.numberFormats();
    try {
      const store = this.options.preferenceStore;
      store?.storage.setItem(store.key, preference);
    } catch { /* The choice still applies for the current visit. */ }
  }

  hasTranslation(source: string): boolean {
    return this.options.translate?.(this.language, source) !== undefined;
  }

  text(source: string, values?: MessageValues): string {
    const { translate, fallbackLanguage } = this.options;
    const message = translate?.(this.language, source)
      ?? (this.language === fallbackLanguage ? undefined : translate?.(fallbackLanguage, source))
      ?? source;
    if (!values) return message;
    return message.replace(/\{(\w+)\}/g, (slot, key: string) => {
      if (!Object.hasOwn(values, key) || values[key] === undefined) return slot;
      return this.rtl ? '\u2068' + values[key] + '\u2069' : values[key];
    });
  }

  number(value: number): string { return this.formats.grouped.format(value); }
  digits(value: number): string { return this.formats.ungrouped.format(value); }

  private isLanguage(value: unknown): value is Language {
    return typeof value === 'string' && Object.hasOwn(this.options.languages, value);
  }

  private formatTag(language: Language): string {
    return this.options.languages[language].formatLocale ?? language;
  }

  private resolve(values: readonly unknown[]): { language: Language; tag: string } {
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      try {
        const locale = new Intl.Locale(value.trim().replaceAll('_', '-'));
        const script = locale.script ? `${locale.language}-${locale.script}` : locale.language;
        const language = [locale.baseName, script, locale.language].find(candidate => this.isLanguage(candidate));
        if (language !== undefined) return { language, tag: locale.baseName };
      } catch { /* Invalid locale input uses the next preference. */ }
    }
    const language = this.options.fallbackLanguage;
    return { language, tag: this.formatTag(language) };
  }

  private numberFormats() {
    return {
      grouped: new Intl.NumberFormat(this.tag),
      ungrouped: new Intl.NumberFormat(this.tag, { useGrouping: false }),
    };
  }
}
