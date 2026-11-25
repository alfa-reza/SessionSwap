import { CookieHandler } from "@background/handlers/cookie.handler";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getDomainFromUrl } from "@shared/utils";

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
    jest.restoreAllMocks();
  });

  test("does not match unrelated domains sharing a suffix", async () => {
    const mockCookies = [
      { domain: ".google.com", name: "SID", storeId: "0" },
      { domain: "mygoogle.com", name: "EVIL", storeId: "0" },
      { domain: "mail.google.com", name: "MAIL", storeId: "0" },
    ];

    (globalThis as { chrome?: unknown }).chrome = {
      cookies: {
        getAllCookieStores: jest.fn(async () => [{ id: "0" }]),
        getAll: jest.fn(async () => mockCookies),
      },
    };

    const handler = new CookieHandler();
    const googleCookies = await handler.getCookiesForDomain("mail.google.com");
    expect(googleCookies.map((c) => c.name)).toEqual(["SID", "MAIL"]);

    const myGoogleCookies = await handler.getCookiesForDomain("mygoogle.com");
    expect(myGoogleCookies.map((c) => c.name)).toEqual(["EVIL"]);
  });

  test("restores __Host- cookies without domain and strips port from fallbackDomain", async () => {
    const setMock = jest.fn(async () => ({}));
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
});
