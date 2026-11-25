/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChromeApiService } from "@popup/services/chromeApi.service";
import { PopupService } from "@popup/services/popup.service";
import type { SessionData } from "@shared/types";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

const setupMockChromeApi = (
  overrides: {
    getCurrentTab?: () => Promise<chrome.tabs.Tab>;
    getStorageData?: () => Promise<any>;
    sendMessage?: () => Promise<any>;
    setStorageData?: () => Promise<void>;
  } = {}
) => {
  const getCurrentTab = spyOn(ChromeApiService.prototype, "getCurrentTab").mockImplementation(
    overrides.getCurrentTab ?? (async () => ({ id: 1, url: "https://example.com" }) as chrome.tabs.Tab)
  );
  const getStorageData = spyOn(ChromeApiService.prototype, "getStorageData").mockImplementation(
    overrides.getStorageData ?? (async () => ({ sessions: [], activeSessions: {} }))
  );
  const sendMessage = spyOn(ChromeApiService.prototype, "sendMessage").mockImplementation(
    overrides.sendMessage ?? (async () => ({ success: true }))
  );
  const setStorageData = spyOn(ChromeApiService.prototype, "setStorageData").mockImplementation(
    overrides.setStorageData ?? (async () => undefined)
  );

  return { getCurrentTab, getStorageData, sendMessage, setStorageData };
};

describe("PopupService", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  describe("saveCurrentSession", () => {
    test("should throw error when getCurrentSession fails", async () => {
      setupMockChromeApi({
        sendMessage: async () => ({ success: false, error: "Failed to get session" }),
      });

      const service = new PopupService();
      await service.initialize();

      await expect(service.saveCurrentSession("test")).rejects.toThrow("Failed to get session");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    test("should save session with correct order when no existing sessions", async () => {
      const { setStorageData } = setupMockChromeApi({
        sendMessage: async () => ({
          success: true,
          data: { cookies: [], localStorage: {}, sessionStorage: {} },
        }),
      });

      const service = new PopupService();
      await service.initialize();

      const session = await service.saveCurrentSession("First Session");

      expect(session.name).toBe("First Session");
      expect(session.order).toBe(0);
      expect(session.domain).toBe("example.com");
      expect(setStorageData).toHaveBeenCalled();
    });

    test("should save session with incremented order when existing sessions exist", async () => {
      const existingSessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
        {
          id: "2",
          name: "Session 2",
          domain: "example.com",
          order: 1,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions: existingSessions, activeSessions: {} }),
        sendMessage: async () => ({
          success: true,
          data: { cookies: [], localStorage: {}, sessionStorage: {} },
        }),
      });

      const service = new PopupService();
      await service.initialize();

      const session = await service.saveCurrentSession("Third Session");

      expect(session.order).toBe(2);
    });
  });

  describe("reorderSessions", () => {
    test("should reorder sessions successfully", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
        {
          id: "2",
          name: "Session 2",
          domain: "example.com",
          order: 1,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      const { setStorageData } = setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      await service.reorderSessions(["2", "1"]);

      const state = service.getState();
      const session1 = state.sessions.find((s) => s.id === "1");
      const session2 = state.sessions.find((s) => s.id === "2");
      expect(session2?.order).toBe(0);
      expect(session1?.order).toBe(1);
      expect(setStorageData).toHaveBeenCalled();
    });

    test("should throw error when session count mismatch", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      await expect(service.reorderSessions(["1", "2"])).rejects.toThrow(
        "Session count mismatch during reorder operation"
      );
    });

    test("should throw error when invalid session IDs provided", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
        {
          id: "2",
          name: "Session 2",
          domain: "example.com",
          order: 1,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      await expect(service.reorderSessions(["1", "3"])).rejects.toThrow(
        "Invalid session IDs provided for reorder operation"
      );
    });

    test("should only reorder sessions for current domain", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
        {
          id: "2",
          name: "Session 2",
          domain: "other.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      await service.reorderSessions(["1"]);

      const state = service.getState();
      const otherDomainSession = state.sessions.find((s) => s.domain === "other.com");
      expect(otherDomainSession?.order).toBe(0);
    });
  });

  describe("migrateLegacySessions", () => {
    test("should migrate sessions without order field", async () => {
      const sessionsWithoutOrder: any[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
        {
          id: "2",
          name: "Session 2",
          domain: "example.com",
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      const { setStorageData } = setupMockChromeApi({
        getStorageData: async () => ({ sessions: sessionsWithoutOrder, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      const state = service.getState();
      expect(state.sessions[0].order).toBe(0);
      expect(state.sessions[1].order).toBe(1);
      expect(setStorageData).toHaveBeenCalledTimes(1);
    });

    test("should not save when sessions already have order field", async () => {
      const sessionsWithOrder: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      const { setStorageData } = setupMockChromeApi({
        getStorageData: async () => ({ sessions: sessionsWithOrder, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      expect(setStorageData).not.toHaveBeenCalled();
    });
  });

  describe("deleteSession", () => {
    test("should delete session successfully", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: { "example.com": "1" } }),
      });

      const service = new PopupService();
      await service.initialize();

      await service.deleteSession("1");

      const state = service.getState();
      expect(state.sessions.length).toBe(0);
      expect(state.activeSessions["example.com"]).toBeUndefined();
    });
  });

  describe("renameSession", () => {
    test("should rename session successfully", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Old Name",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      await service.renameSession("1", "New Name");

      const state = service.getState();
      expect(state.sessions[0].name).toBe("New Name");
    });

    test("should throw error when session not found", async () => {
      setupMockChromeApi();

      const service = new PopupService();
      await service.initialize();

      await expect(service.renameSession("999", "New Name")).rejects.toThrow("Session not found");
    });
  });

  describe("switchToSession", () => {
    test("should switch to session successfully", async () => {
      const sessions: SessionData[] = [
        {
          id: "1",
          name: "Session 1",
          domain: "example.com",
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now() - 1000,
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ];

      setupMockChromeApi({
        getStorageData: async () => ({ sessions, activeSessions: {} }),
      });

      const service = new PopupService();
      await service.initialize();

      const initialLastUsed = sessions[0].lastUsed;
      await service.switchToSession("1");

      const state = service.getState();
      expect(state.activeSessions["example.com"]).toBe("1");
      expect(state.sessions[0].lastUsed).toBeGreaterThan(initialLastUsed);
    });

    test("should throw error when session not found", async () => {
      setupMockChromeApi();

      const service = new PopupService();
      await service.initialize();

      await expect(service.switchToSession("999")).rejects.toThrow("Session not found");
    });
  });

  describe("createNewSession", () => {
    test("should clear active session for current domain", async () => {
      const { sendMessage } = setupMockChromeApi({
        getStorageData: async () => ({ sessions: [], activeSessions: { "example.com": "1" } }),
      });

      const service = new PopupService();
      await service.initialize();

      await service.createNewSession();

      const state = service.getState();
      expect(state.activeSessions["example.com"]).toBeUndefined();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "clearSession",
          domain: "example.com",
        })
      );
    });
  });
});
