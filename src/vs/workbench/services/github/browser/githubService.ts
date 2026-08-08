/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IReference, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { withGitHubCredentialDeadline } from '../../../../platform/github/common/githubCredentialService.js';
import { deriveGitHubEndpoints } from '../../../../platform/github/common/githubEndpoints.js';
import { createGitHubClientMetadata } from '../../../../platform/github/common/githubRequestMetadata.js';
import { GitHubService, IGitHubClient, IGitHubRequestProviderScope } from '../../../../platform/github/common/githubService.js';
import { IGitHubAccountClient } from '../../../../platform/github/common/account/account.js';
import { AccountClient } from '../../../../platform/github/common/account/accountClient.js';
import { IGitHubAnonymousClient } from '../../../../platform/github/common/anonymous/anonymous.js';
import { GitHubAuthorizationContext, GitHubClientOptions, GitHubRequestError } from '../../../../platform/github/common/githubTypes.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ITelemetryService, TELEMETRY_CRASH_REPORTER_SETTING_ID, TELEMETRY_OLD_SETTING_ID, TELEMETRY_SETTING_ID } from '../../../../platform/telemetry/common/telemetry.js';
import { getTelemetryLevel } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { IAuthenticationService } from '../../authentication/common/authentication.js';
import { IWorkbenchGitHubService } from '../common/githubService.js';
import { WorkbenchGitHubCredentialProvider } from './githubCredentialProvider.js';

export class WorkbenchGitHubService extends GitHubService implements IWorkbenchGitHubService {

	readonly onDidChangeDefaultClient: Event<void>;
	private readonly _credentialProvider: WorkbenchGitHubCredentialProvider;
	private readonly _defaultClient = this._register(new MutableDisposable<IReference<IGitHubClient>>());
	private readonly _apiScope = this._register(new MutableDisposable<IGitHubRequestProviderScope>());
	private readonly _lifetime = new AbortController();
	private _defaultClientGeneration = 0;

	constructor(
		@IAuthenticationService authenticationService: IAuthenticationService,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const credentialProvider = new WorkbenchGitHubCredentialProvider(authenticationService);
		super({
			credentialProvider,
			useBrowserRedirects: true,
			telemetrySource: isWeb ? 'web' : 'workbench',
			clientMetadata: createGitHubClientMetadata(productService, 'workbench', 'browser'),
			onDidChangeTelemetryLevel: Event.map(Event.filter(configurationService.onDidChangeConfiguration, event =>
				event.affectsConfiguration(TELEMETRY_SETTING_ID)
				|| event.affectsConfiguration(TELEMETRY_OLD_SETTING_ID)
				|| event.affectsConfiguration(TELEMETRY_CRASH_REPORTER_SETTING_ID)
			), () => getTelemetryLevel(configurationService)),
		}, logService, telemetryService);
		this._credentialProvider = this._register(credentialProvider);
		this.onDidChangeDefaultClient = Event.signal(Event.filter(credentialProvider.onDidChangeSessions, event => event.providerId === 'github', this._store));
		this._register(this.onDidChangeDefaultClient(() => {
			this._defaultClientGeneration++;
			this._defaultClient.clear();
		}));
		this._register(toDisposable(() => this._lifetime.abort(new GitHubRequestError('GitHub service was disposed', 'unknown'))));
	}

	async acquireAnonymousApiClient(signal: AbortSignal): Promise<IGitHubAnonymousClient> {
		signal.throwIfAborted();
		return this.acquireAnonymousClient();
	}

	async acquireDefaultAccountClient(signal: AbortSignal): Promise<IReference<IGitHubClient>> {
		const { options } = await this.resolveDefaultAccountOptions(signal);
		this._defaultClient.value = this.acquireClient(options);
		return this.acquireClient(options);
	}

	async acquireAccountApiClient(authorization: GitHubAuthorizationContext, signal: AbortSignal): Promise<IGitHubAccountClient> {
		const combinedSignal = AbortSignal.any([signal, this._lifetime.signal]);
		const options = await withGitHubCredentialDeadline(combinedSignal, signal => this._credentialProvider.resolveClient(authorization, signal));
		combinedSignal.throwIfAborted();
		const client = await this.acquireApiClient(options, combinedSignal);
		if (combinedSignal.aborted) {
			client.dispose();
			combinedSignal.throwIfAborted();
		}
		return client;
	}

	async acquireDefaultAccountApiClient(signal: AbortSignal): Promise<IGitHubAccountClient> {
		const combinedSignal = AbortSignal.any([signal, this._lifetime.signal]);
		const { options, accountId, generation } = await this.resolveDefaultAccountOptions(combinedSignal);
		const client = await this.acquireApiClient({ ...options, authorization: { ...options.authorization, accountId } }, combinedSignal);
		try {
			combinedSignal.throwIfAborted();
			if (generation !== this._defaultClientGeneration) {
				throw new GitHubRequestError(localize('githubAccountChanged', "The selected GitHub account changed. Try again."), 'authentication');
			}
			return client;
		} catch (error) {
			client.dispose();
			throw error;
		}
	}

	protected async acquireApiClient(options: GitHubClientOptions, signal: AbortSignal): Promise<IGitHubAccountClient> {
		signal.throwIfAborted();
		const scope = this._apiScope.value ??= this.createRequestProviderScope(this._credentialProvider);
		const reference = scope.acquireClient(options);
		return new AccountClient(reference.object.authorization, reference.object, reference);
	}

	private async resolveDefaultAccountOptions(signal: AbortSignal): Promise<{ options: GitHubClientOptions; accountId: string; generation: number }> {
		const combinedSignal = AbortSignal.any([signal, this._lifetime.signal]);
		const { options, accountId, generation } = await withGitHubCredentialDeadline(combinedSignal, signal => this._getDefaultAccountOptions(signal));
		combinedSignal.throwIfAborted();
		if (generation !== this._defaultClientGeneration) {
			throw new GitHubRequestError(localize('githubAccountChanged', "The selected GitHub account changed. Try again."), 'authentication');
		}
		return { options, accountId, generation };
	}

	private async _getDefaultAccountOptions(signal: AbortSignal): Promise<{ options: GitHubClientOptions; accountId: string; generation: number }> {
		signal.throwIfAborted();
		const sessions = await this._credentialProvider.getSessions('github', signal);
		signal.throwIfAborted();
		const repositorySession = sessions
			.filter(session => session.scopes.includes('repo'))
			.sort((a, b) => a.scopes.length - b.scopes.length)[0];
		if (!repositorySession) {
			throw new GitHubRequestError(localize('githubRepositoryAccessRequired', "Sign in to GitHub with repository access to load GitHub data."), 'authentication');
		}
		const generation = this._defaultClientGeneration;
		const endpoints = deriveGitHubEndpoints(repositorySession.authorizationServer?.toString());
		return {
			options: {
				authorization: {
					providerId: 'github',
					sessionId: repositorySession.id,
					scopes: repositorySession.scopes,
					...(repositorySession.authorizationServer ? { authorizationServer: repositorySession.authorizationServer.toString() } : {}),
				},
				apiBaseUri: endpoints.apiBaseUri,
				graphQlUri: endpoints.graphQlUri,
			},
			accountId: repositorySession.account.id,
			generation,
		};
	}
}

registerSingleton(IWorkbenchGitHubService, WorkbenchGitHubService, InstantiationType.Delayed);
