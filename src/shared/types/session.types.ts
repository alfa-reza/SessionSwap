export type SessionColor = "blue" | "green" | "amber" | "rose" | "purple";

export interface SessionData extends StoredSession {
  id: string;
  name: string;
  domain: string;
  createdAt: number;
  lastUsed: number;
  order: number;
  color?: SessionColor;
  faviconUrl?: string;
}

export interface StoredSession {
  cookies: chrome.cookies.Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface ActiveSessions {
  [domain: string]: string; // domain -> sessionId
}
