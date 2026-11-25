import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { GiveawayService } from '../src/utility/giveaway-service';
import { migrate, validateDatabase, type DatabaseRoot } from '../src/utility/database';
import { defaultConfiguration } from '../src/shared/configuration';
import { fromEffect } from '../src/shared/giveaway-rules';
import { TemplateResources, digest, imageLimit, bundleLimit } from '../src/utility/template-resources';
import { readBundle } from '../src/utility/template-format';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLTsAAAAASUVORK5CYII=',
    'base64',
);
let directory: string;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'firebot-giveaway-templates-'));
});
afterEach(async () => {
    const p = path.resolve(directory);
    if (path.dirname(p) === path.resolve(os.tmpdir()) && path.basename(p).startsWith('firebot-giveaway-templates-'))
        await fs.rm(p, { recursive: true, force: true });
});
function fixture(initial?: DatabaseRoot) {
    let root = initial || migrate({} as DatabaseRoot),
        reads = 0,
        fail = false;
    const changes: any[] = [],
        resources = new TemplateResources(directory);
    const repository = {
        read: async () => {
            reads++;
            return structuredClone(root);
        },
        write: async (value: DatabaseRoot) => {
            if (fail) throw Error('disk full');
            validateDatabase(value);
            root = structuredClone(value);
        },
    };
    const service = new GiveawayService(
        repository,
        {
            display() { },
            event: async () => { },
            error(e) {
                throw e;
            },
            changed: (c) => {
                changes.push(c);
            },
        },
        () => Date.now(),
        () => 0,
        resources,
    );
    return {
        service,
        resources,
        changes,
        get root() {
            return root;
        },
        get reads() {
            return reads;
        },
        fail() {
            fail = true;
        },
        config: (title = 'Cup') => ({ ...structuredClone(defaultConfiguration), giveawayTitle: title }),
    };
}
test('warm projected reads load the repository once, and return independent DTOs', async () => {
    const f = fixture();
    await f.service.configure(f.config());
    for (let i = 0; i < 4; i++) {
        const dashboard = await f.service.dashboard();
        dashboard.giveaways[0].title = 'MUTATED';
        const config = await f.service.configuration('Cup');
        config.configuration.styles.accentColor = 'MUTATED';
        await f.service.rows({ area: 'entries', id: 'Cup' });
    }
    expect(f.reads).toBe(1);
    expect((await f.service.dashboard()).giveaways[0].title).toBe('Cup');
    expect((await f.service.configuration('Cup')).configuration.styles.accentColor).not.toBe('MUTATED');
});
test('failed writes retain committed state, revision and notifications', async () => {
    const f = fixture();
    await f.service.configure(f.config());
    const before = await f.service.dashboard(),
        count = f.changes.length;
    f.fail();
    await expect(
        f.service.manage({ mode: 'entryManagement', giveawayTitle: 'Cup', entryAction: 'add', username: 'Alice' }),
    ).rejects.toThrow('disk full');
    expect(await f.service.dashboard()).toEqual(before);
    expect(f.changes).toHaveLength(count);
});
test('UI creation rejects collisions but the existing Create effect can still reopen its target', async () => {
    const f = fixture();
    await f.service.configure(f.config());
    await expect(f.service.configure(f.config(), true, undefined, { createOnly: true })).rejects.toThrow(
        'already exists',
    );
    await f.service.configure(f.config());
    expect((await f.service.dashboard()).giveaways).toHaveLength(1);
});
test('configuration-only revision ignores new entries and rejects concurrent configuration edits', async () => {
    const f = fixture();
    await f.service.configure(f.config());
    const original = await f.service.configuration('Cup');
    await f.service.manage({ mode: 'entryManagement', giveawayTitle: 'Cup', entryAction: 'add', username: 'Alice' });
    expect((await f.service.configuration('Cup')).configRevision).toBe(original.configRevision);
    const newer = f.config();
    newer.prize = 'New';
    await f.service.configure(newer, false, 'Cup', { expectedRevision: original.configRevision });
    await expect(
        f.service.configure(f.config(), false, 'Cup', { expectedRevision: original.configRevision }),
    ).rejects.toThrow('changed elsewhere');
    expect((await f.service.getGiveaway('giveaway_Cup'))!.entries).toHaveLength(1);
});
test('entry notifications identify only the changed data areas', async () => {
    const f = fixture();
    await f.service.configure(f.config());
    await f.service.manage({ mode: 'entryManagement', giveawayTitle: 'Cup', entryAction: 'add', username: 'Alice' });
    expect(f.changes.at(-1)).toMatchObject({ giveawayIds: ['giveaway_Cup'], areas: ['summary', 'entries'] });
    await f.service.manage({ mode: 'winnerHistory', winnerHistoryAction: 'purgeAll' });
    expect(f.changes.at(-1).areas).toEqual(['history']);
});
test('pagination is stable, bounded, searchable, and clamps removed last pages', async () => {
    const state = fromEffect({ ...structuredClone(defaultConfiguration), giveawayTitle: 'Cup' });
    state.updatedAt = state.createdAt = new Date().toISOString();
    state.entries = Array.from({ length: 121 }, (_, i) => ({
        entryId: 'e' + String(i).padStart(3, '0'),
        username: 'User' + i,
        enteredAt: state.createdAt,
        oddsMultiplier: 1,
    }));
    const f = fixture(migrate({ giveaways: { giveaway_Cup: state } } as any));
    const first = await f.service.rows({ area: 'entries', id: 'Cup' }),
        second = await f.service.rows({ area: 'entries', id: 'Cup', page: 2 });
    expect(first.rows).toHaveLength(50);
    expect(second.rows[0].entryId).toBe('e050');
    expect((await f.service.rows({ area: 'entries', id: 'Cup', page: 999 })).page).toBe(3);
    expect((await f.service.rows({ area: 'entries', id: 'Cup', search: 'user120' })).total).toBe(1);
    expect((await f.service.rows({ area: 'entries', id: 'Cup', pageSize: 999 })).rows).toHaveLength(100);
    await f.service.manage({ mode: 'clearEntries', giveawayTitle: 'Cup' });
    expect(await f.service.rows({ area: 'entries', id: 'Cup', page: 3 })).toMatchObject({
        rows: [],
        page: 1,
        pages: 1,
        total: 0,
    });
});
test('selection preference is isolated from business state and survives a resource-store reload', async () => {
    const f = fixture();
    await f.service.rememberSelection('giveaway_Cup');
    expect((await f.service.dashboard()).selectedId).toBe('giveaway_Cup');
    expect(await new TemplateResources(directory).preference()).toBe('giveaway_Cup');
    expect(f.changes).toHaveLength(0);
});
test('large-data projection benchmark: initial response excludes entries, history, backups and configuration', async () => {
    const state = fromEffect({ ...structuredClone(defaultConfiguration), giveawayTitle: 'Large' });
    state.updatedAt = state.createdAt = new Date().toISOString();
    state.entries = Array.from({ length: 5000 }, (_, i) => ({
        entryId: 'entry' + i,
        username: 'User' + i,
        enteredAt: state.createdAt,
        oddsMultiplier: 1,
    }));
    const f = fixture(migrate({ giveaways: { giveaway_Large: state } } as any));
    const a = performance.now(),
        full = await f.service.snapshot(),
        fullMs = performance.now() - a,
        b = performance.now(),
        small = await f.service.dashboard(),
        summaryMs = performance.now() - b,
        fullBytes = Buffer.byteLength(JSON.stringify(full)),
        summaryBytes = Buffer.byteLength(JSON.stringify(small));
    expect(summaryBytes / fullBytes).toBeLessThan(0.01);
    expect(f.reads).toBe(1);
    console.log(
        `Projection benchmark (5000 entries): full=${fullBytes} bytes/${fullMs.toFixed(2)}ms, summary=${summaryBytes} bytes/${summaryMs.toFixed(2)}ms`,
    );
});
test('template library CRUD preserves independent copies and survives giveaway removal', async () => {
    const f = fixture(),
        source = f.config();
    source.prize = 'Key';
    const t = await f.service.saveTemplate({ name: 'Weekly', configuration: source });
    source.styles.accentColor = 'CHANGED';
    expect((await f.service.template(t.id)).configuration.prize).toBe('Key');
    await f.service.renameTemplate(t.id, 'Renamed');
    expect((await f.service.rows({ area: 'templates' })).rows[0].name).toBe('Renamed');
    await f.service.configure(f.config());
    await f.service.manage({ mode: 'removeGiveaway', giveawayTitle: 'Cup' });
    expect((await f.service.template(t.id)).name).toBe('Renamed');
    await f.service.deleteTemplate(t.id);
    expect((await f.service.rows({ area: 'templates' })).total).toBe(0);
});
test('templates contain configuration only and have no entry/win identities or counters', async () => {
    const f = fixture(),
        input: any = {
            ...f.config(),
            entries: [{ username: 'Secret' }],
            winners: [{}],
            uuid: 'bad',
            runId: 'bad',
            admissions: { alice: 99 },
            winLimitResetSequence: 999,
            closeTime: new Date().toISOString(),
        };
    input.giveawayOptions.entries = [];
    const t = await f.service.saveTemplate({ name: 'Only config', configuration: input });
    expect(Object.keys(t.configuration).sort()).toEqual([
        'category',
        'customCoords',
        'display',
        'giveawayOptions',
        'giveawayTitle',
        'overlayInstance',
        'position',
        'prize',
        'styles',
    ]);
    expect((t.configuration as any).admissions).toBeUndefined();
    expect(t.configuration.giveawayOptions).not.toHaveProperty('entries');
});

test('template lookups reject inherited object properties', async () => {
    const f = fixture();
    await expect(f.service.template('__proto__')).rejects.toThrow('not found');
    await expect(f.service.renameTemplate('constructor', 'Changed')).rejects.toThrow('not found');
    await expect(f.service.deleteTemplate('__proto__')).rejects.toThrow('not found');
    await expect(f.service.exportTemplates(['constructor'])).rejects.toThrow('not found');
    await expect(
        f.service.saveTemplate({ id: '__proto__', name: 'Invalid', configuration: f.config() }),
    ).rejects.toThrow('no longer exists');
    const bundle = JSON.stringify({
        format: 'msgg:giveaway-templates',
        version: 1,
        templates: [{ name: 'Invalid', configuration: f.config(), image: '__proto__' }],
        assets: {},
    });
    expect(() => readBundle(bundle)).toThrow('missing');
});
test('portable image round trip survives deleting source image and original library record', async () => {
    const f = fixture(),
        file = path.join(directory, 'source.png');
    await fs.writeFile(file, png);
    const config = f.config();
    config.styles.imageMode = 'local';
    config.styles.imageFile = file;
    const saved = await f.service.saveTemplate({ name: 'With Image', configuration: config });
    await fs.rm(file);
    const exported = await f.service.exportTemplates([saved.id]);
    expect(exported.text).not.toContain(file);
    const bundle = readBundle(exported.text);
    expect(Object.keys(bundle.assets)).toEqual([digest(png)]);
    await f.service.deleteTemplate(saved.id);
    expect(await fs.readFile(saved.configuration.styles.imageFile!)).toEqual(png);
    const imported = await f.service.importTemplates(exported.text, [{ index: 0, action: 'copy' }]);
    expect(await fs.readFile((await f.service.template(imported.ids[0])).configuration.styles.imageFile!)).toEqual(png);
});
test('identical images are deduplicated across templates and exports', async () => {
    const f = fixture(),
        file = path.join(directory, 'a.png');
    await fs.writeFile(file, png);
    const config = f.config();
    config.styles.imageMode = 'local';
    config.styles.imageFile = file;
    const a = await f.service.saveTemplate({ name: 'A', configuration: config }),
        b = await f.service.saveTemplate({ name: 'B', configuration: config });
    expect(a.configuration.styles.imageFile).toBe(b.configuration.styles.imageFile);
    expect(Object.keys(readBundle((await f.service.exportTemplates()).text).assets)).toHaveLength(1);
});
test('import preview, Keep Both, Replace and Skip are explicit and atomic', async () => {
    const f = fixture(),
        t = await f.service.saveTemplate({ name: 'Weekly', configuration: f.config() });
    const file = await f.service.exportTemplates();
    expect((await f.service.previewImport(file.text))[0].conflicts[0].id).toBe(t.id);
    expect((await f.service.rows({ area: 'templates' })).total).toBe(1);
    await f.service.importTemplates(file.text, [{ index: 0, action: 'copy' }]);
    expect((await f.service.rows({ area: 'templates' })).rows.map((r) => r.name)).toEqual(['Weekly', 'Weekly (2)']);
    await f.service.importTemplates(file.text, [{ index: 0, action: 'replace', targetId: t.id }]);
    expect((await f.service.rows({ area: 'templates' })).total).toBe(2);
    await f.service.importTemplates(file.text, [{ index: 0, action: 'skip' }]);
    await expect(
        f.service.importTemplates(file.text, [{ index: 0, action: 'replace', targetId: 'missing' }]),
    ).rejects.toThrow();
    expect((await f.service.rows({ area: 'templates' })).total).toBe(2);
});
test.each(['{"format":"other","version":1}', '{"format":"msgg:giveaway-templates","version":2}', 'broken'])(
    'invalid import %s does not change the library',
    async (text) => {
        const f = fixture();
        await expect(f.service.previewImport(text)).rejects.toThrow();
        expect((await f.service.rows({ area: 'templates' })).total).toBe(0);
    },
);
test('tampered hashes, traversal names, missing assets and non-images are rejected', async () => {
    const bundle: any = {
        format: 'msgg:giveaway-templates',
        version: 1,
        templates: [{ name: 'T', configuration: defaultConfiguration, image: '../../outside' }],
        assets: {},
    };
    expect(() => readBundle(JSON.stringify(bundle))).toThrow('missing');
    bundle.assets = { '../../outside': { type: 'png', data: png.toString('base64') } };
    expect(() => readBundle(JSON.stringify(bundle))).toThrow('Invalid image');
    expect(() =>
        readBundle(
            JSON.stringify({
                ...bundle,
                assets: { [digest(png)]: { type: 'png', data: Buffer.from('not an image').toString('base64') } },
            }),
        ),
    ).toThrow();
    const f = fixture(),
        file = path.join(directory, 'not.png');
    await fs.writeFile(file, 'not an image');
    await expect(f.resources.capture(file)).rejects.toThrow('Unsupported image');
});
test('size limits and missing image files fail clearly', async () => {
    const f = fixture(),
        large = Buffer.alloc(imageLimit + 1);
    await expect(f.resources.store(large)).rejects.toThrow('20 MiB');
    expect(() => readBundle(' '.repeat(bundleLimit + 1))).toThrow('50 MiB');
    const config = f.config();
    config.styles.imageMode = 'local';
    config.styles.imageFile = path.join(directory, 'missing.png');
    await expect(f.service.saveTemplate({ name: 'Missing', configuration: config })).rejects.toThrow();
    expect((await f.service.rows({ area: 'templates' })).total).toBe(0);
});
