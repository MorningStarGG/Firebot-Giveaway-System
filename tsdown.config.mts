import { defineConfig } from 'tsdown';
import { readFileSync } from 'node:fs';
const { pluginOutputName } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
    entry: { [pluginOutputName]: './src/main.ts' }, outDir: './dist',
    platform: 'node', target: 'node22', format: 'cjs', clean: true,
    outExtensions: () => ({ js: '.js' }),
    minify: { mangle: false, compress: true },
    deps: { neverBundle: ['@crowbartools/firebot-types'], onlyBundle: [] },
    dts: false, loader: { '.html': 'text' },
});
