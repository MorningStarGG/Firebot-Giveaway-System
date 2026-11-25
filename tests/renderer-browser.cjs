const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    http = require('node:http');
const { spawn } = require('node:child_process'),
    WebSocket = require('ws'),
    settings = require('./renderer-settings-browser.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description) {
    for (let n = 0; n < 100; n++) {
        const result = await check();
        if (result) return result;
        await delay(100);
    }
    throw Error('Timed out: ' + description);
}
async function run() {
    const executable = [
        process.env.CHROME_PATH,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].find((file) => file && fs.existsSync(file));
    assert(executable, 'Install Chrome/Edge or set CHROME_PATH');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'firebot-giveaway-browser-'));
    let browser, server, socket, host, wss;
    const errors = [];
    try {
        const preferredName = 'PreferredCASE </script><img src=x onerror="window.injected=true">';
        host = require('./plugin-host.cjs').createHost(path.join(profile, 'storage'), {
            viewers: {
                getViewerByUsername: async (username) =>
                    username.startsWith('a $&') ? { username, displayName: preferredName } : undefined,
            },
        });
        await host.load();
        const [create, manager] = host.effects;
        const configuration = (title, color) => ({
            giveawayTitle: title,
            prize: 'Game key',
            category: 'Games',
            styles: {
                accentColor: color,
                customCSS: title === 'Alpha' ? '.title { letter-spacing: 3px; }' : '',
                imageMode: 'local',
                imageFile: 'image.png',
            },
            display: {},
            position: 'Top Middle',
            customCoords: { top: null, left: null, right: null, bottom: null },
            overlayInstance: '',
            giveawayOptions: {
                allowMultipleEntries: true,
                maxEntriesPerUser: 5,
                claimMode: 'timer',
                claimDuration: 60,
                displayDuration: 60,
            },
        });
        const action = async (title, mode, values = {}) => {
            const result = await manager.onTriggerEvent({
                effect: { giveawayTitle: 'giveaway_' + title, giveawaySelectionMode: 'giveawayList', mode, ...values },
            });
            assert.equal(result.success, true, JSON.stringify(result));
        };
        for (const [title, color] of [
            ['Alpha', '#ff0000'],
            ['Beta', '#0000ff'],
        ]) {
            await create.onTriggerEvent({ effect: configuration(title, color) });
            await action(title, 'entryManagement', {
                entryAction: 'add',
                username: 'A $& ' + String.fromCharCode(39) + ' </script><img src=x onerror="window.injected=true">',
            });
            await action(title, 'entryManagement', { entryAction: 'add', username: 'Bob', oddsMultiplier: 3 });
        }
        const fixtures = ['Alpha', 'Beta'].map(
            (title) =>
                host.webSocketEvents
                    .filter((e) => e.data.type === 'update' && e.data.giveawayId === 'giveaway_' + title)
                    .at(-1).data,
        );
        server = http.createServer(async (request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.status = (code) => {
                response.statusCode = code;
                return response;
            };
            response.json = (data) => {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify(data));
            };
            request.query = Object.fromEntries(url.searchParams);
            request.params = {};
            if (url.pathname === '/test/ipc') {
                let raw = '';
                for await (const chunk of request) raw += chunk;
                const packet = JSON.parse(raw);
                const notificationsStart = host.frontendEvents.length;
                await host.frontendHandlers.get('msgg:giveaway:request')(packet);
                const reply = host.frontendEvents
                    .filter((e) => e.name === 'msgg:giveaway:reply' && e.data.requestId === packet.requestId)
                    .at(-1)?.data;
                response.json({
                    ...reply,
                    notifications: host.frontendEvents
                        .slice(notificationsStart)
                        .filter((e) => e.name === 'msgg:giveaway:changed')
                        .map((e) => e.data),
                });
                return;
            }
            if (host.routes.has(url.pathname)) return host.routes.get(url.pathname)(request, response);
            if (url.pathname === '/favicon.ico') {
                response.writeHead(204);
                return response.end();
            }
            if (url.pathname === '/resource/test-resource-token') {
                response.setHeader('content-type', 'image/png');
                return response.end(
                    Buffer.from(
                        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLTsAAAAASUVORK5CYII=',
                        'base64',
                    ),
                );
            }
            if (url.pathname === '/test/bootstrap.v5.67.0.css') {
                response.setHeader('content-type', 'text/css');
                return response.end(fs.readFileSync(path.join(__dirname, 'fixtures/bootstrap.v5.67.0.css')));
            }
            const fixture = /^\/test\/([a-z-]+)\.v5\.67\.0\.js$/.exec(url.pathname);
            if (fixture) {
                response.setHeader('content-type', 'application/javascript');
                return response.end(fs.readFileSync(path.join(__dirname, 'fixtures', fixture[1] + '.v5.67.0.js')));
            }
            if (
                ['/test/angular.js', '/test/firebot-input.js', '/test/backend-communicator.js'].includes(url.pathname)
            ) {
                response.setHeader('content-type', 'application/javascript');
                return response.end(
                    fs.readFileSync(
                        url.pathname.endsWith('angular.js')
                            ? require.resolve('angular/angular.min.js')
                            : path.join(
                                __dirname,
                                url.pathname.endsWith('backend-communicator.js')
                                    ? 'fixtures/backend-communicator.v5.67.0.js'
                                    : 'fixtures/firebot-input.v5.67.0.js',
                            ),
                    ),
                );
            }
            response.setHeader('content-type', 'text/html');
            if (url.pathname === '/test/settings.html')
                return response.end(settings.page(host.effects, host.plugin.registers.uiExtensions[0]));
            response.end(
                '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/plugins/giveaway-system/transport.js"></script></body></html>',
            );
        });
        wss = new WebSocket.Server({ server });
        wss.on('connection', (client) =>
            client.on('message', (raw) => {
                const m = JSON.parse(raw);
                if (m.type === 'invoke' && m.name === 'subscribe-events') {
                    client.subscribed = true;
                    client.send(JSON.stringify({ type: 'response', id: m.id, data: null }));
                }
            }),
        );
        const original = host.api.webServer.sendWebSocketEvent;
        host.api.webServer.sendWebSocketEvent = (name, data) => {
            original(name, data);
            for (const client of wss.clients)
                if (client.subscribed && client.readyState === 1)
                    client.send(JSON.stringify({ type: 'event', name: 'custom-event:' + name, data }));
        };
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = 'http://127.0.0.1:' + server.address().port;
        browser = spawn(
            executable,
            [
                '--headless=new',
                '--disable-gpu',
                '--no-first-run',
                '--no-default-browser-check',
                ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
                '--disable-background-networking',
                '--remote-debugging-port=0',
                '--remote-debugging-address=127.0.0.1',
                `--user-data-dir=${profile}`,
                '--window-size=1000,800',
                'about:blank',
            ],
            { windowsHide: true, stdio: 'ignore' },
        );
        const portFile = path.join(profile, 'DevToolsActivePort');
        await until(() => fs.existsSync(portFile), 'browser debugger');
        const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
        const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            socket.once('open', resolve);
            socket.once('error', reject);
        });
        let sequence = 0;
        const pending = new Map(),
            contexts = new Map();
        socket.on('message', (raw) => {
            const message = JSON.parse(raw);
            if (message.id) {
                const item = pending.get(message.id);
                if (!item) return;
                pending.delete(message.id);
                message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
            }
            if (message.method === 'Target.attachedToTarget')
                void send('Runtime.enable', {}, message.params.sessionId).catch((error) => {
                    if (!/Session with given id not found/.test(error.message)) errors.push(String(error));
                });
            if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) {
                contexts.set(`${message.sessionId || 'root'}:${message.params.context.id}`, {
                    ...message.params.context,
                    sessionId: message.sessionId,
                });
            }
            if (message.method === 'Runtime.executionContextDestroyed')
                contexts.delete(`${message.sessionId || 'root'}:${message.params.executionContextId}`);
            if (
                message.method === 'Runtime.executionContextsCleared' ||
                message.method === 'Target.detachedFromTarget'
            ) {
                const session = message.params?.sessionId || message.sessionId;
                for (const [key, context] of contexts) if (context.sessionId === session) contexts.delete(key);
            }
            if (message.method === 'Runtime.exceptionThrown')
                errors.push(JSON.stringify(message.params.exceptionDetails));
        });
        const send = (method, params = {}, sessionId) =>
            new Promise((resolve, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        const evaluate = async (expression, key) => {
            const context = key ? contexts.get(key) : undefined;
            const result = await send(
                'Runtime.evaluate',
                { expression, contextId: context?.id, returnByValue: true, awaitPromise: true },
                context?.sessionId,
            );
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };

        await send('Page.enable');
        await send('Runtime.enable');
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        await send('Page.navigate', { url: address });
        await until(() => evaluate('!!window.__msggGiveawayBridge'), 'overlay bridge');
        assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0, 'No automatic replay');
        const apply = host.effects[0].overlayExtension.event.onOverlayEvent.toString();
        for (const packet of fixtures) await evaluate(`(${apply})(${JSON.stringify(packet)})`);
        const contextFor = async (title) => {
            for (const [key] of contexts) {
                try {
                    if ((await evaluate('document.querySelector(".title")?.textContent', key)) === title) return key;
                } catch { }
            }
        };
        const alpha = await until(() => contextFor('Alpha'), 'Alpha document'),
            beta = await until(() => contextFor('Beta'), 'Beta document');
        assert.equal(
            await evaluate(
                'getComputedStyle(document.querySelector(".giveawayWidget")).getPropertyValue("--accent-color").trim()',
                alpha,
            ),
            '#ff0000',
        );
        assert.equal(
            await evaluate(
                'getComputedStyle(document.querySelector(".giveawayWidget")).getPropertyValue("--accent-color").trim()',
                beta,
            ),
            '#0000ff',
        );
        assert.equal(
            await evaluate('getComputedStyle(document.querySelector(".title")).letterSpacing', alpha),
            '3px',
            'Custom CSS applied',
        );
        assert.notEqual(
            await evaluate('getComputedStyle(document.querySelector(".title")).letterSpacing', beta),
            '3px',
            'Custom CSS isolated',
        );
        assert.equal(
            await evaluate('getComputedStyle(document.querySelector(".giveawayWidget")).fontFamily', alpha),
            'Montserrat, sans-serif',
        );
        await until(() => evaluate('document.querySelector(".giveawayImage").naturalWidth>0', alpha), 'local image');
        await action('Alpha', 'entryManagement', { entryAction: 'remove', username: 'Bob' });
        await action('Alpha', 'entryManagement', { entryAction: 'pick', autoApproveMulti: false });
        await until(
            () =>
                evaluate(
                    'document.querySelector(".winner-name").textContent===' + JSON.stringify(preferredName),
                    alpha,
                ),
            'preferred display name as literal winner text',
        );
        assert.equal(
            await evaluate('!!document.querySelector(".winner-name img")||!!window.injected', alpha),
            false,
            'Literal winner text',
        );
        await action('Alpha', 'updateDisplay', {
            display: {
                widgetMode: 'ticker',
                showEntryCount: false,
                showEntryCommand: false,
                showClaimCommand: false,
                showTimer: false,
                tickerIntervalSeconds: 1,
            },
        });
        await until(
            () =>
                evaluate(
                    'document.querySelector(".infoTicker").dataset.currentLabel==="Winner" && document.querySelector(".infoTicker .value").textContent===' +
                    JSON.stringify(preferredName),
                    alpha,
                ),
            'preferred display name in ticker',
        );
        assert.equal(
            await evaluate('!!document.querySelector(".infoTicker .value img")||!!window.injected', alpha),
            false,
            'Literal ticker display name',
        );
        await action('Alpha', 'updateDisplay', {
            display: {
                widgetMode: 'full',
                showEntryCount: true,
                showEntryCommand: true,
                showClaimCommand: true,
                showTimer: true,
                tickerIntervalSeconds: 2,
            },
        });
        const before = await evaluate('document.querySelectorAll("iframe").length');
        await evaluate('(' + apply + ')(' + JSON.stringify(fixtures[0]) + ')');
        assert.equal(await evaluate('document.querySelectorAll("iframe").length'), before, 'Duplicate update');
        await action('Alpha', 'toggleVisibility', { visibilityAction: 'hide' });
        await until(() => evaluate('document.querySelectorAll("iframe").length===1'), 'hide removes document');
        await action('Alpha', 'entryManagement', { entryAction: 'approve' });
        await delay(300);
        assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 1, 'Hidden giveaway stays hidden');
        await action('Alpha', 'toggleVisibility', { visibilityAction: 'show' });
        await until(() => evaluate('document.querySelectorAll("iframe").length===2'), 'explicit show');
        for (const client of wss.clients) client.terminate();
        await action('Beta', 'updateStyles', { setting: { type: 'accentColor', value: '#00ff00' } });
        await until(
            () =>
                evaluate(
                    'getComputedStyle(document.querySelector(".giveawayWidget")).getPropertyValue("--accent-color").trim()==="#00ff00"',
                    beta,
                ),
            'reconnect snapshot',
        );
        await action('Beta', 'updatePosition', { position: 'Top Left', overlayInstance: 'Elsewhere' });
        await until(() => evaluate('document.querySelectorAll("iframe").length===1'), 'old instance removed');
        await send('Page.navigate', { url: address + '/?instance=Elsewhere' });
        await until(() => evaluate('!!window.__msggGiveawayBridge'), 'named overlay bridge');
        assert.equal(
            await evaluate('document.querySelectorAll("iframe").length'),
            0,
            'Named overlay refresh does not replay',
        );
        await action('Beta', 'toggleVisibility', { visibilityAction: 'show' });
        await until(() => evaluate('document.querySelectorAll("iframe").length===1'), 'named explicit show');
        await host.unload();
        await until(
            () => evaluate('document.querySelectorAll("iframe").length===0&&!window.__msggGiveawayBridge'),
            'unload disposal',
        );
        await host.load();
        await settings.verify({ send, evaluate, until, address });
        assert.deepEqual(host.errors, []);
        assert.deepEqual(errors, [], 'Browser exceptions');
        console.log(
            'Overlay passed: isolated documents, unchanged font stack, literal names, local images, explicit visibility, instances, reconnect, and unload.',
        );
    } finally {
        if (errors.length) console.error('Runtime errors:', errors);
        await host?.unload();
        if (wss) {
            for (const client of wss.clients) client.terminate();
            wss.close();
        }
        socket?.close();
        if (server) {
            server.closeAllConnections?.();
            await new Promise((resolve) => server.close(resolve));
        }
        if (browser && browser.exitCode == null) {
            browser.kill();
            await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), delay(3000)]);
        }
        // Delete only the isolated profile created above, after checking its resolved parent and prefix.
        const resolved = path.resolve(profile),
            tempRoot = path.resolve(os.tmpdir());
        if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('firebot-giveaway-browser-')) {
            try {
                fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch {
                /* browser descendants may release profile files later */
            }
        }
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
