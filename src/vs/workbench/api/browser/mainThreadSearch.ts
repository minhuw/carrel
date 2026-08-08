/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { DisposableStore, dispose, IDisposable } from '../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ITelemetryData, ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IFileMatch, IFileQuery, IRawFileMatch2, ISearchComplete, ISearchCompleteStats, ISearchProgressItem, ISearchQuery, ISearchResultProvider, ISearchService, ITextQuery, QueryType, SearchProviderType } from '../../services/search/common/search.js';
import { ExtHostContext, ExtHostSearchShape, MainContext, MainThreadSearchShape } from '../common/extHost.protocol.js';
import { revive } from '../../../base/common/marshalling.js';
import { getOrSet } from '../../../base/common/map.js';

@extHostNamedCustomer(MainContext.MainThreadSearch)
export class MainThreadSearch implements MainThreadSearchShape {

	private readonly _proxy: ExtHostSearchShape;
	private readonly _searchProvider = new Map<number, RemoteSearchProvider>();

	constructor(
		extHostContext: IExtHostContext,
		@ISearchService private readonly _searchService: ISearchService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IConfigurationService _configurationService: IConfigurationService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostSearch);
		this._proxy.$enableExtensionHostSearch();
	}

	dispose(): void {
		this._searchProvider.forEach(value => value.dispose());
		this._searchProvider.clear();
	}

	$registerTextSearchProvider(handle: number, scheme: string): void {
		this._searchProvider.set(handle, new RemoteSearchProvider(this._searchService, SearchProviderType.text, scheme, handle, this._proxy));
	}

	$registerFileSearchProvider(handle: number, scheme: string): void {
		this._searchProvider.set(handle, new RemoteSearchProvider(this._searchService, SearchProviderType.file, scheme, handle, this._proxy));
	}

	$unregisterProvider(handle: number): void {
		dispose(this._searchProvider.get(handle));
		this._searchProvider.delete(handle);

	}

	$handleFileMatch(handle: number, session: number, data: UriComponents[]): void {
		const provider = this._searchProvider.get(handle);
		if (!provider) {
			throw new Error('Got result for unknown provider');
		}

		provider.handleFindMatch(session, data);
	}

	$handleTextMatch(handle: number, session: number, data: IRawFileMatch2[]): void {
		const provider = this._searchProvider.get(handle);
		if (!provider) {
			throw new Error('Got result for unknown provider');
		}

		provider.handleFindMatch(session, data);
	}

	$handleTelemetry(eventName: string, data: ITelemetryData | undefined): void {
		this._telemetryService.publicLog(eventName, data);
	}
}

class SearchOperation {

	private static _idPool = 0;

	/** File-only matches use URI keys, with shared authority strings when casing must be preserved. */
	private readonly matches = new Map<string, IFileMatch | string | undefined>();
	private readonly authorities = new Map<string, string>();

	constructor(
		readonly progress?: (match: IFileMatch) => unknown,
		readonly id: number = ++SearchOperation._idPool,
	) {
		//
	}

	addMatch(match: IFileMatch): void {
		const existingMatch = this.matches.get(match.resource.toString());
		if (existingMatch && typeof existingMatch !== 'string') {
			// TODO@rob clean up text/file result types
			// If a file search returns the same file twice, we would enter this branch.
			// It's possible that could happen, #90813
			if (existingMatch.results && match.results) {
				existingMatch.results.push(...match.results);
			}
		} else {
			this.matches.set(match.resource.toString(), match);
		}

		this.progress?.(match);
	}

	addFileMatch(resource: URI): void {
		const key = resource.toString();
		if (this.matches.has(key)) {
			return;
		}

		const parsed = URI.parse(key);
		// URI formatting can normalize drive-letter casing.
		const preservesComponents = parsed.scheme === resource.scheme
			&& parsed.path === resource.path
			&& parsed.query === resource.query
			&& parsed.fragment === resource.fragment;
		if (!preservesComponents) {
			this.matches.set(key, { resource });
		} else {
			this.matches.set(key, parsed.authority === resource.authority
				? undefined
				: getOrSet(this.authorities, resource.authority, resource.authority));
		}
	}

	getResults(): IFileMatch[] {
		const results = new Array<IFileMatch>(this.matches.size);
		let index = 0;
		for (const [key, match] of this.matches) {
			// Release serialized results as their URI objects are materialized.
			this.matches.delete(key);
			if (typeof match === 'object') {
				results[index++] = match;
			} else {
				const resource = URI.parse(key);
				results[index++] = { resource: match === undefined ? resource : resource.with({ authority: match }) };
			}
		}
		this.authorities.clear();
		return results;
	}

}

class RemoteSearchProvider implements ISearchResultProvider, IDisposable {

	private readonly _registrations = new DisposableStore();
	private readonly _searches = new Map<number, SearchOperation>();

	constructor(
		searchService: ISearchService,
		type: SearchProviderType,
		private readonly _scheme: string,
		private readonly _handle: number,
		private readonly _proxy: ExtHostSearchShape
	) {
		this._registrations.add(searchService.registerSearchResultProvider(this._scheme, type, this));
	}

	dispose(): void {
		this._registrations.dispose();
	}

	fileSearch(query: IFileQuery, token: CancellationToken = CancellationToken.None): Promise<ISearchComplete> {
		return this.doSearch(query, undefined, token);
	}

	textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void, token: CancellationToken = CancellationToken.None): Promise<ISearchComplete> {
		return this.doSearch(query, onProgress, token);
	}

	doSearch(query: ISearchQuery, onProgress?: (p: ISearchProgressItem) => void, token: CancellationToken = CancellationToken.None): Promise<ISearchComplete> {
		if (!query.folderQueries.length) {
			throw new Error('Empty folderQueries');
		}

		const search = new SearchOperation(onProgress);
		this._searches.set(search.id, search);

		const searchP = this._provideSearchResults(query, search.id, token);

		return Promise.resolve(searchP).then((result: ISearchCompleteStats) => {
			this._searches.delete(search.id);
			return { results: search.getResults(), stats: result.stats, limitHit: result.limitHit, messages: result.messages };
		}, err => {
			this._searches.delete(search.id);
			return Promise.reject(err);
		});
	}

	clearCache(cacheKey: string): Promise<void> {
		return Promise.resolve(this._proxy.$clearCache(cacheKey));
	}

	handleFindMatch(session: number, dataOrUri: Array<UriComponents | IRawFileMatch2>): void {
		const searchOp = this._searches.get(session);

		if (!searchOp) {
			// ignore...
			return;
		}

		dataOrUri.forEach(result => {
			if ((<IRawFileMatch2>result).results) {
				searchOp.addMatch(revive((<IRawFileMatch2>result)));
			} else {
				searchOp.addFileMatch(URI.revive(<UriComponents>result));
			}
		});
	}

	private _provideSearchResults(query: ISearchQuery, session: number, token: CancellationToken): Promise<ISearchCompleteStats> {
		switch (query.type) {
			case QueryType.File:
				return this._proxy.$provideFileSearchResults(this._handle, session, query, token);
			case QueryType.Text:
				return this._proxy.$provideTextSearchResults(this._handle, session, query, token);
		}
	}
}
