import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { TemplateAsset } from '../types/ui';
export const imageLimit = 20 * 1024 * 1024,
    bundleLimit = 50 * 1024 * 1024;
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function imageType(data: Buffer): string {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
    if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) return 'gif';
    if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'webp';
    if (data.subarray(0, 2).toString() === 'BM') return 'bmp';
    if (data.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(data.subarray(8, 32).toString())) return 'avif';
    if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(data.toString('utf8'))) return 'svg';
    throw new Error('Unsupported image: use PNG, JPEG, GIF, WebP, BMP, AVIF, or SVG');
}
export function checkedImage(data: Buffer): string {
    if (!data.length || data.length > imageLimit) throw new Error('Images must be nonempty and at most 20 MiB');
    return imageType(data);
}
export class TemplateResources {
    private selectedId?: string;
    constructor(private directory: string) { }
    async capture(file: string): Promise<string> {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > imageLimit) throw new Error('Local image is missing or exceeds 20 MiB');
        return this.store(await fs.readFile(file));
    }
    async store(data: Buffer): Promise<string> {
        const type = checkedImage(data),
            directory = path.join(this.directory, 'template-assets'),
            file = path.join(directory, `${digest(data)}.${type}`);
        await fs.mkdir(directory, { recursive: true });
        const stage = path.join(directory, `.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(stage, data, { flag: 'wx' });
            await fs.rename(stage, file);
        } finally {
            await fs.rm(stage, { force: true });
        }
        return file;
    }
    async export(file: string): Promise<{ hash: string; asset: TemplateAsset }> {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > imageLimit) throw new Error('Local image is missing or exceeds 20 MiB');
        const bytes = await fs.readFile(file),
            type = checkedImage(bytes);
        return { hash: digest(bytes), asset: { type, data: bytes.toString('base64') } };
    }
    async preference(id?: string): Promise<string> {
        const file = path.join(this.directory, 'giveaway-ui.json');
        if (id !== undefined) {
            const stage = path.join(this.directory, `.ui-${randomUUID()}.tmp`);
            try {
                await fs.writeFile(stage, JSON.stringify({ selectedId: id }), { flag: 'wx' });
                await fs.rename(stage, file);
            } finally {
                await fs.rm(stage, { force: true });
            }
            this.selectedId = id;
            return id;
        }
        if (this.selectedId !== undefined) return this.selectedId;
        try {
            const data = JSON.parse(await fs.readFile(file, 'utf8'));
            return (this.selectedId = typeof data.selectedId === 'string' ? data.selectedId : '');
        } catch (error) {
            if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
                return (this.selectedId = '');
            throw error;
        }
    }
}
