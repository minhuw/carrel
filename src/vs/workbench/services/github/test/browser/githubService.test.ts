/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { TELEMETRY_SETTING_ID } from '../../../../../platform/telemetry/common/telemetry.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationGetSessionsOptions, IAuthenticationService } from '../../../authentication/common/authentication.js';
import { WorkbenchGitHubService } from '../../browser/githubService.js';

suite('Workbench GitHub service', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const signal = () => new AbortController().signal;

	function session(id = 'session', accountId = 'account', scopes: readonly string[] = ['repo']): AuthenticationSession {
		return { id, accessToken: `token-${id}`, account: { id: accountId, label: accountId }, scopes };
	}

	function setup(sessions: AuthenticationSession[] = [session()]) {
		const changed = store.add(new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>());
		const calls: { providerId: string; options: IAuthenticationGetSessionsOptions | undefined }[] = [];
		const configuration = new TestConfigurationService({ [TELEMETRY_SETTING_ID]: 'all' });
		store.add(configuration.onDidChangeConfigurationEmitter);
		const service = store.add(new WorkbenchGitHubService(
			new class extends mock<IAuthenticationService>() {
				override readonly onDidChangeSessions = changed.event;
				override async getSessions(providerId: string, _scopes: readonly string[], options?: IAuthenticationGetSessionsOptions): Promise<readonly AuthenticationSession[]> {
					calls.push({ providerId, options });
					return sessions;
				}
			}(),
			new NullLogService(), NullTelemetryService,
			new class extends mock<IProductService>() {
				override readonly applicationName = 'carrel';
				override readonly version = '1.144.0';
			}(),
			configuration,
		));
		return { service, sessions, changed, calls };
	}

	test('acquires anonymous clients locally without account selection', async () => {
		const { service, calls } = setup([]);
		const client = store.add(await service.acquireAnonymousApiClient(signal()));
		assert.deepStrictEqual({ anonymous: client.gist !== undefined, authenticationCalls: calls }, { anonymous: true, authenticationCalls: [] });
	});

	test('selects the least-scoped repository session silently and reuses the default client', async () => {
		const { service, calls } = setup([
			session('read-user', 'account', ['read:user']),
			session('broad', 'account', ['repo', 'user:email']),
			session('repository', 'account', ['repo']),
		]);
		const first = store.add(await service.acquireDefaultAccountClient(signal()));
		const next = store.add(await service.acquireDefaultAccountClient(signal()));
		assert.deepStrictEqual({
			sessionId: first.object.authorization.sessionId,
			reused: first.object === next.object,
			calls,
		}, {
			sessionId: 'repository',
			reused: true,
			calls: Array.from({ length: 2 }, () => ({ providerId: 'github', options: { silent: true } })),
		});
	});

	test('rejects a default acquisition without repository access', async () => {
		const { service, calls } = setup([session('read-user', 'account', ['read:user'])]);
		await assert.rejects(service.acquireDefaultAccountClient(signal()), { kind: 'authentication' });
		assert.deepStrictEqual(calls, [{ providerId: 'github', options: { silent: true } }]);
	});

	test('honors an explicit session and invalidates it when removed', async () => {
		const explicit = session('explicit', 'other-account', ['read:user']);
		const { service, changed } = setup([session(), explicit]);
		const client = store.add(await service.acquireAccountApiClient({ providerId: 'github', sessionId: explicit.id, accountId: explicit.account.id, scopes: explicit.scopes }, signal()));
		let invalidations = 0;
		store.add(client.onDidInvalidate(() => invalidations++));
		changed.fire({ providerId: 'github', label: 'GitHub', event: { added: [], changed: [], removed: [explicit] } });
		assert.deepStrictEqual({ sessionId: client.authorization.sessionId, accountId: client.authorization.accountId, invalidations }, {
			sessionId: 'explicit', accountId: 'other-account', invalidations: 1,
		});
	});

	test('invalidates a default portable client when its grant changes', async () => {
		const { service, sessions, changed } = setup();
		const client = store.add(await service.acquireDefaultAccountApiClient(signal()));
		let invalidations = 0;
		store.add(client.onDidInvalidate(() => invalidations++));
		sessions[0] = { ...sessions[0], scopes: ['repo', 'gist'] };
		changed.fire({ providerId: 'github', label: 'GitHub', event: { added: [], changed: [sessions[0]], removed: [] } });
		assert.strictEqual(invalidations, 1);
	});
});
