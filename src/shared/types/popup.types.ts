import { ActiveSessions, SessionData } from "./session.types";

export interface PopupState {
  currentDomain: string;
  currentTab: chrome.tabs.Tab;
  sessions: SessionData[];
  activeSessions: ActiveSessions;
  currentRenameSessionId: string;
  currentDeleteSessionId: string;
}
