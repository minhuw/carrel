/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { afterEach, suite, test } from 'node:test';
import { download } from '../download.ts';

suite('download', () => {

	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	/** Replaces fetch with one response per call and returns the requested URLs. */
	function stubFetch(responses: (() => Response)[]): string[] {
		const requests: string[] = [];
		globalThis.fetch = async (input: string | URL | Request) => {
			requests.push(String(input));
			const respond = responses.shift();
			if (!respond) {
				throw new Error(`unexpected request for ${String(input)}`);
			}
			return respond();
		};
		return requests;
	}

	const unavailable = () => new Response('unavailable', { status: 504 });

	test('retries transient failures until the download succeeds', async () => {
		const requests = stubFetch([unavailable, unavailable, () => new Response('contents')]);

		const contents = await download('https://example.test/electron.d.ts', { attempts: 3, retryDelay: 1 });

		assert.strictEqual(new TextDecoder().decode(contents), 'contents');
		assert.strictEqual(requests.length, 3);
	});

	test('fails with the last status once every attempt has failed', async () => {
		const requests = stubFetch([unavailable, unavailable, unavailable]);

		await assert.rejects(
			download('https://example.test/electron.d.ts', { attempts: 3, retryDelay: 1 }),
			/failed with status code: 504/,
		);
		assert.strictEqual(requests.length, 3);
	});

	test('waits longer before each further retry', async () => {
		stubFetch([unavailable, unavailable, unavailable]);

		const started = Date.now();
		await assert.rejects(download('https://example.test/electron.d.ts', { attempts: 3, retryDelay: 10 }));

		// Two retries wait 10 ms and then 20 ms; the bound is a lower limit, so timer jitter cannot fail it.
		assert.ok(Date.now() - started >= 30, `expected at least 30 ms of backoff, got ${Date.now() - started} ms`);
	});
});
