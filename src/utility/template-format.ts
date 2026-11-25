import type { EffectModel } from '../types/types';
import type { TemplateBundle, GiveawayTemplate } from '../types/ui';
import { defaultConfiguration, configurationOf, optionKeys } from '../shared/configuration';
import { fromEffect } from '../shared/giveaway-rules';
import { bundleLimit, checkedImage, digest } from './template-resources';
const object = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
export function templateConfiguration(input: unknown): EffectModel {
    if (!object(input)) throw new Error('Template configuration is required');
    for (const name of ['giveawayTitle', 'prize', 'category', 'position'])
        if (input[name] != null && typeof input[name] !== 'string') throw new Error(`Invalid template ${name}`);
    for (const group of ['styles', 'display', 'giveawayOptions'])
        if (input[group] != null && !object(input[group])) throw new Error(`Invalid template ${group}`);
    for (const group of ['styles', 'display'] as const)
        for (const [name, value] of Object.entries(input[group] || {}))
            if (
                value != null &&
                typeof (defaultConfiguration[group] as any)[name] === 'string' &&
                typeof value !== 'string'
            )
                throw new Error(`Invalid template ${group}.${name}`);
    for (const name of ['entryCommand', 'claimCommand'])
        if (input.giveawayOptions?.[name] != null && typeof input.giveawayOptions[name] !== 'string')
            throw new Error(`Invalid template ${name}`);
    const options: any = {};
    for (const name of [...optionKeys, 'entryCommand', 'claimCommand'])
        if (input.giveawayOptions?.[name] !== undefined) options[name] = input.giveawayOptions[name];
    const styles: any = {},
        display: any = {};
    for (const name of Object.keys(defaultConfiguration.styles))
        if (input.styles?.[name] !== undefined) styles[name] = input.styles[name];
    for (const name of Object.keys(defaultConfiguration.display))
        if (input.display?.[name] !== undefined) display[name] = input.display[name];
    delete styles.imageToken;
    const title = typeof input.giveawayTitle === 'string' ? input.giveawayTitle : '';
    const state = fromEffect({
        ...structuredClone(defaultConfiguration),
        giveawayTitle: title || 'Template',
        prize: input.prize ?? '',
        category: input.category ?? '',
        giveawayOptions: { ...defaultConfiguration.giveawayOptions, ...options },
        styles: { ...defaultConfiguration.styles, ...styles },
        display: { ...defaultConfiguration.display, ...display },
        position: input.position ?? 'Middle',
        customCoords: input.customCoords ?? defaultConfiguration.customCoords,
        overlayInstance: '',
    });
    const result = configurationOf(state);
    result.giveawayTitle = title;
    delete result.styles.imageToken;
    return result;
}
export function templateName(input: unknown): string {
    if (typeof input !== 'string' || !input.trim() || input.length > 200)
        throw new Error('Template name must contain 1–200 characters');
    return input.trim();
}
export function readBundle(text: string): TemplateBundle {
    if (typeof text !== 'string' || Buffer.byteLength(text) > bundleLimit)
        throw new Error('Template file exceeds 50 MiB');
    let input: any;
    try {
        input = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
        throw new Error('Template file is not valid JSON');
    }
    if (!object(input) || input.format !== 'msgg:giveaway-templates' || input.version !== 1)
        throw new Error('Unsupported template format or version');
    if (
        !Array.isArray(input.templates) ||
        !input.templates.length ||
        input.templates.length > 500 ||
        !object(input.assets)
    )
        throw new Error('Invalid template bundle');
    const assets: TemplateBundle['assets'] = {};
    for (const [hash, asset] of Object.entries(input.assets) as [string, any][]) {
        if (
            !/^[a-f0-9]{64}$/.test(hash) ||
            !object(asset) ||
            typeof asset.data !== 'string' ||
            Buffer.from(asset.data, 'base64').toString('base64') !== asset.data
        )
            throw new Error('Invalid image asset');
        const data = Buffer.from(asset.data, 'base64');
        if (digest(data) !== hash || checkedImage(data) !== asset.type)
            throw new Error('Image asset hash or format does not match');
        assets[hash] = { type: asset.type, data: asset.data };
    }
    const templates = input.templates.map((record: any) => {
        if (!object(record)) throw new Error('Invalid template record');
        const configuration = templateConfiguration(record.configuration);
        if (record.image !== undefined && (typeof record.image !== 'string' || !Object.hasOwn(assets, record.image)))
            throw new Error('Template image asset is missing');
        // Imported paths are never used to read another machine's filesystem.
        const hadLocalFile = !!configuration.styles.imageFile;
        configuration.styles.imageFile = '';
        delete configuration.styles.imageToken;
        if (configuration.styles.imageMode === 'local' && hadLocalFile && !record.image)
            throw new Error('Local image template is missing its embedded image');
        return {
            name: templateName(record.name),
            description: typeof record.description === 'string' ? record.description.slice(0, 2000) : '',
            configuration,
            ...(record.image ? { image: record.image } : {}),
        };
    });
    return { format: 'msgg:giveaway-templates', version: 1, templates, assets };
}
export const templateSummary = (record: GiveawayTemplate) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    updatedAt: record.updatedAt,
});
export const templateRecord = (library: Record<string, GiveawayTemplate> | undefined, id: string) =>
    library && Object.hasOwn(library, id) ? library[id] : undefined;
