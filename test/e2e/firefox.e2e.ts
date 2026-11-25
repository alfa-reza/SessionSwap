import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Minimal Marionette TCP client for driving headless Firefox + WebExtension popups
 * without external WebDriver/geckodriver dependencies.
 */
class MarionetteClient {
  private buf = Buffer.alloc(0);
  private msgId = 0;
  private socket!: Bun.Socket<undefined>;
  private pendingResolve: ((pkt: unknown[]) => void) | null = null;
  private queue: unknown[][] = [];

  static async connect(port = 2828, timeoutMs = 15000): Promise<MarionetteClient> {
    const client = new MarionetteClient();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await new Promise<void>((resolve, reject) => {
          Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: {
              open(socket) {
                client.socket = socket;
                resolve();
              },
              data(_, data) {
                client.onData(Buffer.from(data));
              },
              error(_, err) {
                reject(err);
              },
            },
          }).catch(reject);
        });
        await client.nextPacket(); // handshake
        return client;
      } catch {
        await Bun.sleep(200);
      }
    }
    throw new Error("Timed out waiting for Firefox Marionette");
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const colonIdx = this.buf.indexOf(":");
      if (colonIdx === -1) break;
      const len = Number(this.buf.subarray(0, colonIdx).toString("utf8"));
      const start = colonIdx + 1;
      if (this.buf.length < start + len) break;

      const pkt = JSON.parse(this.buf.subarray(start, start + len).toString("utf8")) as unknown[];
      this.buf = this.buf.subarray(start + len);
      if (this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        resolve(pkt);
      } else {
        this.queue.push(pkt);
      }
    }
  }

  private nextPacket(): Promise<unknown[]> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  async cmd<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    this.msgId += 1;
    const payload = JSON.stringify([0, this.msgId, name, params]);
    this.socket.write(`${Buffer.byteLength(payload)}:${payload}`);
    const [, , err, result] = (await this.nextPacket()) as [number, number, unknown, T];
    if (err) {
      throw new Error(`${name} failed: ${JSON.stringify(err)}`);
    }
    return result;
  }

  close(): void {
    this.socket?.end();
  }
}

function startDemoLoginServer() {
  const sessions = new Map<string, { username: string; role: string }>();

  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const cookieHeader = req.headers.get("cookie") || "";
      const sidMatch = cookieHeader.match(/(?:^|;\s*)sid=([^;]+)/);
      const user = sidMatch ? sessions.get(sidMatch[1]) : undefined;

      if (url.pathname === "/login" && req.method === "POST") {
        const fd = await req.formData();
        const username = String(fd.get("username") || "").trim();
        const role = username === "admin" ? "Admin" : "Member";
        const sid = crypto.randomUUID();
        sessions.set(sid, { username, role });
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
          },
        });
      }

      const html = user
        ? `<!doctype html><html><body>
            <h1 id="status">Logged in as ${user.username} (${user.role})</h1>
            <script>
              if (!localStorage.getItem("user_pref")) localStorage.setItem("user_pref", "theme-${user.username}");
              if (!sessionStorage.getItem("tab_state")) sessionStorage.setItem("tab_state", "tab-${user.username}");
            </script>
          </body></html>`
        : `<!doctype html><html><body>
            <h1 id="status">Logged out</h1>
            <form method="POST" action="/login">
              <input name="username" id="username" />
              <button type="submit" id="loginBtn">Login</button>
            </form>
          </body></html>`;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    },
  });
}

async function runE2E() {
  const server = startDemoLoginServer();
  const baseUrl = `http://localhost:${server.port}/`;
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "sessionswap-e2e-"));
  await writeFile(path.join(profileDir, "user.js"), 'user_pref("extensions.webextensions.remote", false);\n');

  const ff = Bun.spawn(["firefox", "--headless", "--no-remote", "--marionette", "--profile", profileDir, baseUrl], {
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" },
  });

  let m: MarionetteClient | null = null;
  try {
    m = await MarionetteClient.connect();
    await m.cmd("WebDriver:NewSession", { capabilities: {} });
    await m.cmd("Addon:Install", { path: path.resolve("dist"), temporary: true });
    await Bun.sleep(800);

    const getPageState = async () => {
      await m!.cmd("Marionette:SetContext", { value: "content" });
      const res = await m!.cmd<{
        value: { status: string | null; ls: string | null; ss: string | null };
      }>("WebDriver:ExecuteScript", {
        script:
          "return { status: document.getElementById('status')?.textContent ?? null, ls: localStorage.getItem('user_pref'), ss: sessionStorage.getItem('tab_state') };",
      });
      return res.value;
    };

    const withPopup = async <T>(js: string): Promise<T> => {
      await m!.cmd("Marionette:SetContext", { value: "chrome" });
      await m!.cmd("WebDriver:ExecuteScript", {
        script: `
          if (!document.getElementById('session-switcher_fanesp_online-BAP')) {
            document.getElementById('unified-extensions-button')?.click();
          }
        `,
      });
      await Bun.sleep(250);
      await m!.cmd("WebDriver:ExecuteScript", {
        script: "document.getElementById('session-switcher_fanesp_online-BAP')?.doCommand?.();",
      });

      for (let i = 0; i < 30; i++) {
        const ready = await m!.cmd<{ value: boolean }>("WebDriver:ExecuteScript", {
          script: `
            const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
            const site = pb?.contentDocument?.getElementById('currentSite')?.textContent;
            return Boolean(pb?.contentDocument?.readyState === 'complete' && site && site !== 'Loading...');
          `,
        });
        if (ready.value) break;
        await Bun.sleep(150);
      }

      const res = await m!.cmd<{ value: T }>("WebDriver:ExecuteScript", {
        script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          return (function() { ${js} })();
        `,
      });
      return res.value;
    };

    const closePopup = async () => {
      await m!.cmd("Marionette:SetContext", { value: "chrome" });
      await m!.cmd("WebDriver:ExecuteScript", {
        script: "document.getElementById('customizationui-widget-panel')?.hidePopup?.();",
      });
      await Bun.sleep(200);
    };

    // 1. Initial state is logged out
    assert.equal((await getPageState()).status, "Logged out");

    // 2. Log in as alice & save session
    await m.cmd("WebDriver:ExecuteScript", {
      script: "document.getElementById('username').value = 'alice'; document.getElementById('loginBtn').click();",
    });
    await Bun.sleep(600);
    assert.deepEqual(await getPageState(), {
      status: "Logged in as alice (Member)",
      ls: "theme-alice",
      ss: "tab-alice",
    });

    const savedSite = await withPopup<string>(`
      const site = doc.getElementById('currentSite').textContent;
      doc.getElementById('saveBtn').click();
      doc.getElementById('sessionName').value = 'Alice';
      doc.getElementById('confirmSave').click();
      return site;
    `);
    assert.equal(savedSite, `localhost:${server.port}`);
    await Bun.sleep(500);
    await closePopup();

    // 3. Click "New" to clear HttpOnly cookie + storage
    await withPopup("doc.getElementById('newSessionBtn').click();");
    await Bun.sleep(800);
    await closePopup();
    assert.deepEqual(await getPageState(), { status: "Logged out", ls: null, ss: null });

    // 4. Log in as bob & save session
    await m.cmd("WebDriver:ExecuteScript", {
      script: "document.getElementById('username').value = 'bob'; document.getElementById('loginBtn').click();",
    });
    await Bun.sleep(600);
    assert.deepEqual(await getPageState(), {
      status: "Logged in as bob (Member)",
      ls: "theme-bob",
      ss: "tab-bob",
    });

    await withPopup(`
      doc.getElementById('saveBtn').click();
      doc.getElementById('sessionName').value = 'Bob';
      doc.getElementById('confirmSave').click();
    `);
    await Bun.sleep(500);
    await closePopup();

    // 5. Switch back to Alice
    await withPopup(`
      const alice = Array.from(doc.querySelectorAll('.session-item')).find((i) => i.querySelector('.session-name')?.textContent === 'Alice');
      alice?.click();
    `);
    await Bun.sleep(800);
    await closePopup();
    assert.deepEqual(await getPageState(), {
      status: "Logged in as alice (Member)",
      ls: "theme-alice",
      ss: "tab-alice",
    });

    // 6. Switch back to Bob
    await withPopup(`
      const bob = Array.from(doc.querySelectorAll('.session-item')).find((i) => i.querySelector('.session-name')?.textContent === 'Bob');
      bob?.click();
    `);
    await Bun.sleep(800);
    await closePopup();
    assert.deepEqual(await getPageState(), {
      status: "Logged in as bob (Member)",
      ls: "theme-bob",
      ss: "tab-bob",
    });

    // 7. Rename Bob -> Bob Updated & delete it
    await withPopup(`
      const bob = Array.from(doc.querySelectorAll('.session-item')).find((i) => i.querySelector('.session-name')?.textContent === 'Bob');
      bob?.querySelector('.rename-btn')?.click();
      doc.getElementById('newSessionName').value = 'Bob Updated';
      doc.getElementById('confirmRename').click();
    `);
    await Bun.sleep(300);
    const afterRename = await withPopup<string[]>(
      "return Array.from(doc.querySelectorAll('.session-item .session-name')).map((e) => e.textContent);"
    );
    assert.deepEqual(afterRename, ["Alice", "Bob Updated"]);
    await closePopup();

    await withPopup(`
      const bobU = Array.from(doc.querySelectorAll('.session-item')).find((i) => i.querySelector('.session-name')?.textContent === 'Bob Updated');
      bobU?.querySelector('.delete-btn')?.click();
      doc.getElementById('confirmDelete').click();
    `);
    await Bun.sleep(300);
    const remaining = await withPopup<string[]>(
      "return Array.from(doc.querySelectorAll('.session-item .session-name')).map((e) => e.textContent);"
    );
    assert.deepEqual(remaining, ["Alice"]);
    await closePopup();

    // 8. Settings: theme persistence, clear site sessions, and JSON restore
    await withPopup(`
      doc.getElementById('settingsBtn').click();
      doc.querySelector('[data-theme-option="dark"]').click();
    `);
    await Bun.sleep(200);
    await closePopup();

    const persistedTheme = await withPopup<string>("return doc.documentElement.dataset.theme;");
    assert.equal(persistedTheme, "dark");
    await closePopup();

    // Clear all site sessions via Settings -> confirmDelete
    await withPopup(`
      doc.getElementById('settingsBtn').click();
      doc.getElementById('clearSiteSessionsBtn').click();
      doc.getElementById('confirmDelete').click();
    `);
    await Bun.sleep(300);
    await closePopup();
    const afterClear = await withPopup<number>("return doc.querySelectorAll('.session-item').length;");
    assert.equal(afterClear, 0);
    await closePopup();

    // Restore JSON backup into #importBackupInput
    const backupJson = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: [
        {
          id: "restored-1",
          name: "Restored Alice",
          domain: `localhost:${server.port}`,
          order: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          cookies: [],
          localStorage: {},
          sessionStorage: {},
        },
      ],
      activeSessions: {},
    });
    await withPopup(`
      doc.getElementById('settingsBtn').click();
      const win = doc.defaultView;
      const input = doc.getElementById('importBackupInput');
      const dt = new win.DataTransfer();
      dt.items.add(new win.File([${JSON.stringify(backupJson)}], 'backup.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    `);
    await Bun.sleep(400);
    const restoreRes = await m.cmd<{
      value: { status: string; viewHeight: number; scrollHeight: number; names: string[] };
    }>("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          const view = doc.getElementById('settingsView');
          const viewHeight = view.getBoundingClientRect().height;
          const status = doc.getElementById('settingsStatus').textContent;
          doc.getElementById('settingsBackBtn').click();
          return {
            status,
            viewHeight,
            scrollHeight: doc.documentElement.scrollHeight,
            names: Array.from(doc.querySelectorAll('.session-item .session-name')).map((e) => e.textContent),
          };
        `,
    });
    assert.equal(restoreRes.value.status, "Restored 1 session(s)");
    assert.ok(
      restoreRes.value.viewHeight > 200,
      `Expected full settings view height, got ${restoreRes.value.viewHeight}`
    );
    assert.deepEqual(restoreRes.value.names, ["Restored Alice"]);
    await closePopup();

    // 9. All Sessions view: website info, favicon, and trash delete with confirmation
    await withPopup("doc.getElementById('allSessionsBtn').click();");
    await Bun.sleep(200);
    const allSessionsBefore = await m.cmd<{
      value: { domains: string[]; hasFavicon: boolean; rows: number; viewHeight: number };
    }>("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          const view = doc.getElementById('allSessionsView');
          return {
            domains: Array.from(doc.querySelectorAll('.site-group-domain')).map((e) => e.textContent),
            hasFavicon: doc.querySelectorAll('.site-favicon svg').length > 0,
            rows: doc.querySelectorAll('.all-session-row').length,
            viewHeight: view.getBoundingClientRect().height,
          };
        `,
    });
    assert.deepEqual(allSessionsBefore.value.domains, [`localhost:${server.port}`]);
    assert.equal(allSessionsBefore.value.hasFavicon, true);
    assert.equal(allSessionsBefore.value.rows, 1);
    assert.ok(allSessionsBefore.value.viewHeight > 100, "Expected visible All Sessions view");

    // Minimize/collapse website group and expand it back
    const collapsedOpen = await m.cmd<{ value: { afterCollapse: boolean; afterExpand: boolean } }>(
      "WebDriver:ExecuteScript",
      {
        script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          const group = doc.querySelector('.site-group');
          const summary = doc.querySelector('.site-group-header');
          summary.click();
          const afterCollapse = group.open;
          summary.click();
          const afterExpand = group.open;
          return { afterCollapse, afterExpand };
        `,
      }
    );
    assert.equal(collapsedOpen.value.afterCollapse, false);
    assert.equal(collapsedOpen.value.afterExpand, true);

    // Rename session from All Sessions view
    await m.cmd("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          doc.querySelector('#allSessionsList [data-action="rename"]').click();
          doc.getElementById('newSessionName').value = 'Alice Renamed';
          doc.getElementById('confirmRename').click();
        `,
    });
    await Bun.sleep(200);
    const renamedInAll = await m.cmd<{ value: string[] }>("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          return Array.from(doc.querySelectorAll('#allSessionsList .session-name')).map((e) => e.textContent);
        `,
    });
    assert.deepEqual(renamedInAll.value, ["Alice Renamed"]);

    // Delete via trash icon -> requires confirmation modal
    await m.cmd("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          doc.querySelector('#allSessionsList [data-action="delete"]').click();
        `,
    });
    const modalShown = await m.cmd<{ value: boolean }>("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          const shown = doc.getElementById('deleteModal').classList.contains('show');
          doc.getElementById('confirmDelete').click();
          return shown;
        `,
    });
    assert.equal(modalShown.value, true);
    await Bun.sleep(300);

    const allSessionsAfter = await m.cmd<{ value: { rows: number; backWorks: boolean } }>("WebDriver:ExecuteScript", {
      script: `
          const pb = Array.from(document.querySelectorAll('browser')).find((b) => (b.currentURI?.spec || '').includes('popup/index.html'));
          const doc = pb.contentDocument;
          const rows = doc.querySelectorAll('.all-session-row').length;
          doc.getElementById('allSessionsBackBtn').click();
          return { rows, backWorks: !doc.getElementById('mainContent').hidden };
        `,
    });
    assert.equal(allSessionsAfter.value.rows, 0);
    assert.equal(allSessionsAfter.value.backWorks, true);
    await closePopup();

    console.log("✅ Firefox E2E login/session-switch/settings/all-sessions suite passed!");
  } finally {
    m?.close();
    ff.kill();
    await ff.exited;
    server.stop(true);
    await rm(profileDir, { recursive: true, force: true });
  }
}

await runE2E();
