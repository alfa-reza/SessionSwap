import { CookieHandler } from "@background/handlers/cookie.handler";
import { escapeHtml } from "@popup/utils/dom";
import { getDomainFromUrl } from "@shared/utils";
import { afterEach, describe, expect, mock, test } from "bun:test";

describe("getDomainFromUrl", () => {
  test("extracts domain and strips www", () => {
    expect(getDomainFromUrl("https://www.example.com/path")).toBe("example.com");
    expect(getDomainFromUrl("http://sub.example.com")).toBe("sub.example.com");
  });

  test("preserves port for localhost and 127.x", () => {
    expect(getDomainFromUrl("http://localhost:3000/app")).toBe("localhost:3000");
    expect(getDomainFromUrl("http://127.0.0.1:8080")).toBe("127.0.0.1:8080");
  });

  test("returns empty string for non-http(s) and invalid URLs", () => {
    expect(getDomainFromUrl("chrome://extensions")).toBe("");
    expect(getDomainFromUrl("about:debugging")).toBe("");
    expect(getDomainFromUrl("file:///tmp/test.html")).toBe("");
    expect(getDomainFromUrl("not-a-url")).toBe("");
  });
});

describe("CookieHandler", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    mock.restore();
  });

  test("includes parent domain cookies and does not match unrelated domains sharing a suffix", async () => {
    const mockCookies = [
      { domain: ".google.com", name: "SID", path: "/", storeId: "0" },
      { domain: "mygoogle.com", name: "EVIL", path: "/", storeId: "0" },
      { domain: "mail.google.com", name: "MAIL", path: "/", storeId: "0" },
    ];

    (globalThis as { chrome?: unknown }).chrome = {
      cookies: {
        getAllCookieStores: mock(async () => [{ id: "0" }]),
        getAll: mock(async ({ domain }: { domain: string }) =>
          mockCookies.filter((c) => {
            const clean = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
            return clean === domain || clean.endsWith(`.${domain}`);
          })
        ),
      },
    };

    const handler = new CookieHandler();
    const googleCookies = await handler.getCookiesForDomain("mail.google.com");
    expect(googleCookies.map((c) => c.name).sort()).toEqual(["MAIL", "SID"]);

    const myGoogleCookies = await handler.getCookiesForDomain("mygoogle.com");
    expect(myGoogleCookies.map((c) => c.name)).toEqual(["EVIL"]);
  });

  test("clearCookiesForDomain passes partitionKey when removing partitioned cookies", async () => {
    const removeMock = mock(async () => ({}));
    (globalThis as { chrome?: unknown }).chrome = {
      cookies: {
        getAllCookieStores: mock(async () => [{ id: "0" }]),
        getAll: mock(async () => [
          {
            domain: "example.com",
            name: "PART",
            path: "/",
            secure: true,
            storeId: "0",
            partitionKey: { topLevelSite: "https://parent.example" },
          },
        ]),
        remove: removeMock,
      },
    };

    const handler = new CookieHandler();
    await handler.clearCookiesForDomain("example.com");

    expect(removeMock).toHaveBeenCalledTimes(1);
    expect((removeMock.mock.calls[0] as unknown[])[0]).toEqual({
      url: "https://example.com/",
      name: "PART",
      storeId: "0",
      partitionKey: { topLevelSite: "https://parent.example" },
    });
  });

  test("restores __Host- cookies without domain and strips port from fallbackDomain", async () => {
    const setMock = mock(async () => ({}));
    (globalThis as { chrome?: unknown }).chrome = {
      cookies: { set: setMock },
    };

    const handler = new CookieHandler();
    await handler.restoreCookies(
      [
        {
          name: "__Host-session",
          value: "abc",
          domain: "example.com",
          hostOnly: true,
          path: "/app",
          secure: false,
          httpOnly: true,
          sameSite: "lax",
          session: true,
          storeId: "0",
        } as chrome.cookies.Cookie,
        {
          name: "local",
          value: "123",
          domain: "",
          hostOnly: true,
          path: "/",
          secure: false,
          httpOnly: false,
          sameSite: "unspecified",
          session: true,
          storeId: "0",
        } as chrome.cookies.Cookie,
      ],
      "localhost:3000"
    );

    expect(setMock).toHaveBeenCalledTimes(2);
    expect((setMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      url: "https://example.com/app",
      path: "/",
      secure: true,
    });
    expect((setMock.mock.calls[0] as unknown[])[0]).not.toHaveProperty("domain");
    expect((setMock.mock.calls[1] as unknown[])[0]).toMatchObject({
      url: "http://localhost/",
    });
  });

  test("isolates cookie operations to the target tab's cookie store", async () => {
    const removeMock = mock(async () => ({}));
    const setMock = mock(async () => ({}));
    (globalThis as { chrome?: unknown }).chrome = {
      cookies: {
        getAllCookieStores: mock(async () => [
          { id: "default", tabIds: [1] },
          { id: "incognito", tabIds: [2] },
        ]),
        getAll: mock(async ({ storeId }: { storeId: string }) => [
          { domain: "example.com", name: `SID_${storeId}`, path: "/", storeId },
        ]),
        remove: removeMock,
        set: setMock,
      },
    };

    const handler = new CookieHandler();
    const cookies = await handler.getCookiesForDomain("example.com", 2);
    expect(cookies.map((c) => c.name)).toEqual(["SID_incognito"]);

    await handler.clearCookiesForDomain("example.com", 1);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect((removeMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      name: "SID_default",
      storeId: "default",
    });

    await handler.restoreCookies(cookies, "example.com", 1);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect((setMock.mock.calls[0] as unknown[])[0]).toMatchObject({
      name: "SID_incognito",
      storeId: "default",
    });
  });
});

describe("escapeHtml", () => {
  test("escapes HTML special characters including quotes", () => {
    expect(escapeHtml("\"Admin\" & 'User' <script>")).toBe("&quot;Admin&quot; &amp; &#39;User&#39; &lt;script&gt;");
  });
});
