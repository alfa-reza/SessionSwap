import { ActiveSessions, SessionData } from "./session.types";

export interface StorageData {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export type ThemePreference = "system" | "light" | "dark";

export interface ExtensionSettings {
  autoReload: boolean;
  showBadge: boolean;
  autoClosePopup: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoReload: true,
  showBadge: true,
  autoClosePopup: false,
};

export interface SessionBackup {
  version: number;
  exportedAt: string;
  sessions: SessionData[];
  activeSessions: ActiveSessions;
}

export interface ExtensionStorage {
  sessions: SessionData[];
  activeSessions: ActiveSessions;
  theme?: ThemePreference;
  settings?: Partial<ExtensionSettings>;
}
