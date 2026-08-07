/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateNodeCompileCache } from '../nodeCompileCache.ts';

const kinds = ['main', 'extension-host', 'shared-process', 'pty-host'];

async function createCache(root: string, tag: string): Promise<void> {
	for (const kind of kinds) {
		const directory = join(root, kind);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, '.ready'), '');
		await mkdir(join(directory, tag), { recursive: true });
		await writeFile(join(directory, tag, 'abcdef12'), 'cache');
	}
}

for (const [name, tag] of [
	['legacy cache directory', 'v24.22.0-arm64-abcdef12'],
	['cache directory with a format suffix', 'v24.22.0-arm64-60e4fe36-501'],
] as const) {
	test(`validateNodeCompileCache accepts ${name}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'carrel-compile-cache-test-'));
		try {
			await createCache(root, tag);
			assert.equal(await validateNodeCompileCache(root, 'arm64'), kinds.length);
			await assert.rejects(() => validateNodeCompileCache(root, 'x64'), /expected exactly one/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
