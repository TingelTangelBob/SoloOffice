/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" schaltet die Anwendung in den Demo-Modus (kein Backend). */
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_API_URL?: string;
  /** Optional, best-effort telemetry. Safe default is off. */
  readonly VITE_TELEMETRY_ENABLED?: string;
  readonly VITE_AGB_URL?: string;
  readonly VITE_AVV_URL?: string;
  readonly VITE_DATENSCHUTZ_URL?: string;
  readonly VITE_IMPRESSUM_URL?: string;
  /**
   * Commit-Hash des Builds. Wird im Demo-Hinweis sichtbar verlinkt: Bei einem
   * öffentlich erreichbaren AGPL-Dienst müssen Nutzer den Quelltext genau der
   * laufenden Fassung finden können (AGPL § 13).
   */
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
