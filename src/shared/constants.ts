export const MESSAGE_ACTIONS = {
  GET_CURRENT_SESSION: "getCurrentSession",
  SWITCH_SESSION: "switchSession",
  CLEAR_SESSION: "clearSession",
} as const;

export const STORAGE_KEYS = {
  SESSIONS: "sessions",
  ACTIVE_SESSIONS: "activeSessions",
  THEME: "theme",
  SETTINGS: "settings",
} as const;
