/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'node:test';
import { validateNodeCompileCache } from '../nodeCompileCache.ts';

const kinds = ['main', 'extension-host', 'shared-process', 'pty-host'];
const tag = `v24.22.1-${process.arch}-7034790f`;

suite('validateNodeCompileCache', () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'node-compile-cache-test-'));
		for (const kind of kinds) {
			const cacheDirectory = path.join(root, kind, tag);
			await fs.promises.mkdir(cacheDirectory, { recursive: true });
			await fs.promises.writeFile(path.join(root, kind, '.ready'), '');
			await fs.promises.writeFile(path.join(cacheDirectory, '6664eb6b'), 'entry');
		}
	});

	afterEach(async () => {
		await fs.promises.rm(root, { recursive: true, force: true });
	});

	test('removes temporary files a process left mid-write when it was stopped', async () => {
		// Node writes each entry to `<entry>.XXXXXX` (uv_fs_mkstemp) and renames it into place.
		const leftover = path.join(root, 'shared-process', tag, '6664eb6b.cqknyl');
		await fs.promises.writeFile(leftover, 'partial');

		const count = await validateNodeCompileCache(root, process.arch);

		assert.deepStrictEqual({ count, leftoverExists: fs.existsSync(leftover), entry: fs.existsSync(path.join(root, 'shared-process', tag, '6664eb6b')) }, { count: kinds.length, leftoverExists: false, entry: true });
	});

	test('still rejects other unexpected cache entries', async () => {
		await fs.promises.writeFile(path.join(root, 'shared-process', tag, 'unexpected.txt'), '');

		await assert.rejects(validateNodeCompileCache(root, process.arch), /unexpected shared-process cache entries in .*: unexpected\.txt\./);
	});
});

async function createCache(root: string, tag: string): Promise<void> {
	for (const kind of kinds) {
		const directory = path.join(root, kind);
		await fs.promises.mkdir(directory, { recursive: true });
		await fs.promises.writeFile(path.join(directory, '.ready'), '');
		await fs.promises.mkdir(path.join(directory, tag), { recursive: true });
		await fs.promises.writeFile(path.join(directory, tag, 'abcdef12'), 'cache');
	}
}

for (const [name, tag] of [
	['legacy cache directory', 'v24.22.0-arm64-abcdef12'],
	['cache directory with a format suffix', 'v24.22.0-arm64-60e4fe36-501'],
] as const) {
	test(`validateNodeCompileCache accepts ${name}`, async () => {
		const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'carrel-compile-cache-test-'));
		try {
			await createCache(root, tag);
			assert.equal(await validateNodeCompileCache(root, 'arm64'), kinds.length);
			await assert.rejects(() => validateNodeCompileCache(root, 'x64'), /expected exactly one/);
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});
}
