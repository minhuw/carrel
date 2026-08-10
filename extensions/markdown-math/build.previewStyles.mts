/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outputRootIndex = args.indexOf('--outputRoot');
if (outputRootIndex >= 0 && !args[outputRootIndex + 1]) {
	throw new Error('Missing path after --outputRoot');
}

const sourceRoot = path.join(import.meta.dirname, 'node_modules', 'katex', 'dist');
const sourceCss = path.join(sourceRoot, 'katex.min.css');
const sourceFonts = path.join(sourceRoot, 'fonts');
const outputRoot = outputRootIndex >= 0 ? path.resolve(args[outputRootIndex + 1]) : import.meta.dirname;
const outputDir = path.join(outputRoot, 'preview-styles', 'katex');
const outputFonts = path.join(outputDir, 'fonts');

async function assertFile(file: string, description: string): Promise<void> {
	try {
		if (!(await stat(file)).isFile()) {
			throw new Error('not a file');
		}
	} catch (error) {
		throw new Error(`Unable to build Markdown math preview styles: ${description} is unavailable at ${file}`, { cause: error });
	}
}

async function build(): Promise<void> {
	await assertFile(sourceCss, 'KaTeX stylesheet');
	const css = await readFile(sourceCss, 'utf8');
	const fontRelativePaths = [...new Set(Array.from(css.matchAll(/url\((?:["']?)(fonts\/[^)"']+\.woff2)(?:["']?)\)/g), match => match[1]))];
	if (fontRelativePaths.length === 0) {
		throw new Error(`Unable to build Markdown math preview styles: no .woff2 fonts are referenced by ${sourceCss}`);
	}

	for (const relativePath of fontRelativePaths) {
		await assertFile(path.join(sourceRoot, relativePath), `KaTeX font ${relativePath}`);
	}

	await rm(outputDir, { recursive: true, force: true });
	await mkdir(outputFonts, { recursive: true });
	await copyFile(sourceCss, path.join(outputDir, 'katex.min.css'));
	await Promise.all(fontRelativePaths.map(relativePath => copyFile(
		path.join(sourceRoot, relativePath),
		path.join(outputDir, relativePath),
	)));
	console.log(`Built Markdown math preview styles in ${outputDir}`);
}

if (args.includes('--watch')) {
	await build();
	const watcher = await import('@parcel/watcher');
	let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
	const subscription = await watcher.subscribe(sourceRoot, (error, events) => {
		if (error) {
			console.error('[watch] Markdown math preview-style watcher error:', error);
			return;
		}
		if (!events.some(event => event.path === sourceCss || (event.path.startsWith(`${sourceFonts}${path.sep}`) && event.path.endsWith('.woff2')))) {
			return;
		}
		if (rebuildTimer) {
			clearTimeout(rebuildTimer);
		}
		rebuildTimer = setTimeout(() => {
			void build().catch(error => console.error('[watch] Markdown math preview-style build error:', error));
		}, 100);
	});

	const dispose = async () => {
		if (rebuildTimer) {
			clearTimeout(rebuildTimer);
		}
		await subscription.unsubscribe();
	};
	process.once('SIGINT', () => void dispose().finally(() => process.exit(0)));
	process.once('SIGTERM', () => void dispose().finally(() => process.exit(0)));
} else {
	await build();
}
