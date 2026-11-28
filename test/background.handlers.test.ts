import { SessionHandler } from "@background/handlers/session.handler";
import { StorageHandler } from "@background/handlers/storage.handler";
import { MessageService } from "@background/services/message.service";
import { MESSAGE_ACTIONS } from "@shared/constants";
import type { SessionData } from "@shared/types";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

describe("Background handlers & MessageService", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    mock.restore();
  });

  test("MessageService rejects when broad origin permissions are missing", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      permissions: {
        getAll: mock(async () => ({ origins: ["https://only-one.example/*"] })),
      },
    };
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

    const service = new MessageService();
    const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      service.handleMessage(
        { action: MESSAGE_ACTIONS.CLEAR_SESSION, domain: "example.com", tabId: 1 },
        {} as chrome.runtime.MessageSender,
        resolve
      );
    });

    expect(response.success).toBe(false);
    expect(response.error).toContain("Data access permission is required");
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("StorageHandler.getStorageData throws when script execution fails", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: {
        executeScript: mock(async () => {
          throw new Error("Cannot access a chrome:// URL");
        }),
      },
    };

    const handler = new StorageHandler();
    await expect(handler.getStorageData(1)).rejects.toThrow("Failed to get storage data");
  });

  test("StorageHandler.restoreStorageData and clearStorageData throw when script returns false", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      scripting: {
        executeScript: mock(async () => [{ result: false }]),
      },
    };

    const handler = new StorageHandler();
    await expect(handler.restoreStorageData(1, { localStorage: {}, sessionStorage: {} })).rejects.toThrow(
      "Unable to restore storage on this page"
    );
    await expect(handler.clearStorageData(1)).rejects.toThrow("Unable to clear storage on this page");
  });

  test("MessageService allows site-scoped origin permissions matching target domain", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      permissions: {
        getAll: mock(async () => ({ origins: ["https://example.com/*"] })),
      },
      cookies: {
        getAllCookieStores: mock(async () => [{ id: "0", tabIds: [1] }]),
        getAll: mock(async () => []),
        remove: mock(async () => ({})),
      },
      scripting: {
        executeScript: mock(async () => [{ result: true }]),
      },
      storage: {
        local: {
          get: mock(async () => ({ settings: { autoReload: false } })),
        },
      },
    };

    const service = new MessageService();
    const response = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      service.handleMessage(
        { action: MESSAGE_ACTIONS.CLEAR_SESSION, domain: "example.com", tabId: 1 },
        {} as chrome.runtime.MessageSender,
        resolve
      );
    });

    expect(response.success).toBe(true);
  });

  test("SessionHandler.switchToSession rejects when active tab domain mismatches session domain", async () => {
    const removeMock = mock(async () => ({}));
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: {
        get: mock(async () => ({ id: 1, url: "https://other-site.com/login" })),
      },
      cookies: {
        remove: removeMock,
      },
    };

    const handler = new SessionHandler();
    const session: SessionData = {
      id: "1",
      name: "Alice",
      domain: "example.com",
      order: 0,
      createdAt: 1000,
      lastUsed: 1000,
      cookies: [],
      localStorage: {},
      sessionStorage: {},
    };

    await expect(handler.switchToSession(session, 1)).rejects.toThrow("Active tab domain no longer matches");
    expect(removeMock).not.toHaveBeenCalled();
  });

  test("SessionHandler.switchToSession skips reload when autoReload is false and preserves cookies on restricted page", async () => {
    const reloadMock = mock(async () => undefined);
    const removeMock = mock(async () => ({}));
    let failScript = true;

    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: mock(async () => ({ settings: { autoReload: false } })),
        },
      },
      tabs: { reload: reloadMock },
      cookies: {
        getAllCookieStores: mock(async () => [{ id: "0" }]),
        getAll: mock(async () => [{ domain: "example.com", name: "SID", path: "/", storeId: "0" }]),
        remove: removeMock,
        set: mock(async () => ({})),
      },
      scripting: {
        executeScript: mock(async () => {
          if (failScript) throw new Error("Restricted page");
          return [{ result: true }];
        }),
      },
    };

    const session: SessionData = {
      id: "1",
      name: "Alice",
      domain: "example.com",
      order: 0,
      createdAt: 1000,
      lastUsed: 1000,
      cookies: [],
      localStorage: { k: "v" },
      sessionStorage: {},
    };

    const handler = new SessionHandler();
    await expect(handler.switchToSession(session, 1)).rejects.toThrow("Failed to switch session");
    expect(removeMock).not.toHaveBeenCalled();

    failScript = false;
    await handler.switchToSession(session, 1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
