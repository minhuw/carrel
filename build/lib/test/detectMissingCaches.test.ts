/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { suite, test } from 'node:test';
import { FAILSAFE_SCHEMA, load } from 'js-yaml';
import { cacheWarmingJobs, detectMissingCaches, getCaches, type ICacheWarmingJob } from '../../../.github/actions/detect-missing-caches/detect.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

interface IStep {
	readonly name?: string;
	readonly uses?: string;
	readonly run?: string;
	readonly shell?: string;
	readonly 'working-directory'?: string;
	readonly with?: Record<string, string>;
}

interface IJob {
	readonly 'runs-on': string | readonly string[];
	readonly needs?: string;
	readonly if?: string;
	readonly env?: Record<string, string>;
	readonly steps: readonly IStep[];
}

/**
 * Loads a workflow or action with all values as strings.
 */
function loadYaml<T>(relativePath: string): T {
	return load(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'), { schema: FAILSAFE_SCHEMA }) as T;
}

function loadActionSteps(name: string): readonly IStep[] {
	return loadYaml<{ runs: { steps: IStep[] } }>(`.github/actions/${name}/action.yml`).runs.steps;
}

function readRepositoryFile(relativePath: string): Buffer {
	return readFileSync(path.join(repositoryRoot, relativePath));
}

/**
 * The runners of the cache warming jobs, as the cache keys see them. The Electron cache path is the
 * `ELECTRON_CACHE_PATH` that `.github/actions/setup-electron` sets on the runner, which depends on its
 * user profile and is part of the cache version.
 */
const runners: Record<string, { platform: string; arch: string; runnerArch: string; os: ICacheWarmingJob['os']; electronCachePath: string }> = {
	'vscode-large-runners-ubuntu-8-core': { platform: 'linux', arch: 'x64', runnerArch: 'X64', os: 'Linux', electronCachePath: '/home/runner/.cache/electron' },
	'vscode-large-runners-windows-8-core': { platform: 'win32', arch: 'x64', runnerArch: 'X64', os: 'Windows', electronCachePath: 'C:\\Users\\runneradmin\\AppData\\Local\\electron\\Cache' },
	'vscode-large-runners-macos-5-core-0': { platform: 'darwin', arch: 'arm64', runnerArch: 'ARM64', os: 'macOS', electronCachePath: '/Users/runner/Library/Caches/electron' },
};

function getRunner(job: IJob, name: string) {
	const runsOn = typeof job['runs-on'] === 'string' ? [job['runs-on']] : job['runs-on'];
	const runner = runners[runsOn.find(label => runners[label]) ?? ''];
	assert.ok(runner, `Unknown runner of ${name}: ${runsOn.join(', ')}`);
	return runner;
}

suite('Detect missing caches', () => {
	test('jobs run when one of their caches is missing, has another version or cannot be listed', async () => {
		const [missing, incompatible] = [getCaches(cacheWarmingJobs.windows, readRepositoryFile)[1], getCaches(cacheWarmingJobs.linux, readRepositoryFile)[1]];
		const existing = Object.values(cacheWarmingJobs)
			.flatMap(job => getCaches(job, readRepositoryFile))
			.filter(cache => cache.key !== missing.key)
			.map(cache => cache.key === incompatible.key ? { ...cache, version: 'other' } : cache);
		// Listing by key prefix also returns longer keys.
		const list = (caches: readonly { key: string; version: string }[], key: string) => caches.filter(cache => cache.key.startsWith(key)).concat({ key: `${key}-other`, version: 'other' });

		const detect = async (ref: string, listCaches: (key: string, ref: string) => { key: string; version: string }[]) => {
			const outputs: Record<string, string> = {};
			const listedRefs = new Set<string>();
			await detectMissingCaches({
				rest: {
					actions: {
						getActionsCacheList: async parameters => {
							assert.equal(parameters.per_page, 100);
							listedRefs.add(parameters.ref);
							return { data: { actions_caches: listCaches(parameters.key, parameters.ref) } };
						},
					},
				},
			}, {
				repo: { owner: 'microsoft', repo: 'vscode' },
				ref,
				payload: { repository: { default_branch: 'main' } },
			}, {
				info: () => { },
				warning: () => { },
				setOutput: (name, value) => outputs[name] = value,
			}, { lf: readRepositoryFile, crlf: readRepositoryFile });
			return { listedRefs: [...listedRefs], outputs };
		};

		const missingOrIncompatible = { 'compile': 'false', 'linux': 'true', 'windows': 'true' };
		assert.deepStrictEqual(await Promise.all([
			detect('refs/heads/main', (key, ref) => ref === 'refs/heads/main' ? list(existing, key) : []),
			// A release branch also restores the caches of main, without saving a copy.
			detect('refs/heads/release/1.200', (key, ref) => list(existing.filter((_cache, index) => (index % 2 === 0) === (ref === 'refs/heads/main')), key)),
			detect('refs/heads/main', () => { throw new Error('Not available'); }),
		]), [
			{ listedRefs: ['refs/heads/main'], outputs: missingOrIncompatible },
			{ listedRefs: ['refs/heads/release/1.200', 'refs/heads/main'], outputs: missingOrIncompatible },
			{ listedRefs: ['refs/heads/main'], outputs: { 'compile': 'true', 'linux': 'true', 'windows': 'true' } },
		]);
	});
});
