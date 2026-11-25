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
