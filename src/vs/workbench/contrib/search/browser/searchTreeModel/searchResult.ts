/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, PauseableEmitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IProgress, IProgressStep } from '../../../../../platform/progress/common/progress.js';
import { IFileMatch, ISearchComplete, ITextQuery } from '../../../../services/search/common/search.js';
import { arrayContainsElementOrParent, IChangeEvent, ISearchTreeFileMatch, ISearchTreeFolderMatch, IPlainTextSearchHeading, ISearchModel, ISearchResult, isSearchTreeFileMatch, isSearchTreeFolderMatch, isSearchTreeFolderMatchNoRoot, isSearchTreeFolderMatchWithResource, isSearchTreeMatch, isTextSearchHeading, ITextSearchHeading, mergeSearchResultEvents, RenderableMatch, SEARCH_RESULT_PREFIX } from './searchTreeCommon.js';
import { RangeHighlightDecorations } from './rangeDecorations.js';
import { PlainTextSearchHeadingImpl } from './textSearchHeading.js';

export class SearchResultImpl extends Disposable implements ISearchResult {

	private _onChange = this._register(new PauseableEmitter<IChangeEvent>({
		merge: mergeSearchResultEvents
	}));
	readonly onChange: Event<IChangeEvent> = this._onChange.event;
	private _plainTextSearchResult: PlainTextSearchHeadingImpl;

	private readonly _id: string;
	constructor(
		public readonly searchModel: ISearchModel,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
	) {
		super();
		this._plainTextSearchResult = this._register(this.instantiationService.createInstance(PlainTextSearchHeadingImpl, this));
		this._register(this._plainTextSearchResult.onChange((e) => this._onChange.fire(e)));

		this.modelService.getModels().forEach(model => this.onModelAdded(model));
		this._register(this.modelService.onModelAdded(model => this.onModelAdded(model)));

		this._id = SEARCH_RESULT_PREFIX + Date.now().toString();
	}

	id(): string {
		return this._id;
	}

	get plainTextSearchResult(): IPlainTextSearchHeading {
		return this._plainTextSearchResult;
	}

	get children(): ITextSearchHeading[] {
		return [this._plainTextSearchResult];
	}

	get hasChildren(): boolean {
		return true;
	}

	async batchReplace(elementsToReplace: RenderableMatch[]) {
		try {
			this._onChange.pause();
			await Promise.all(elementsToReplace.map(async (elem) => {
				const parent = elem.parent();

				if ((isSearchTreeFolderMatch(parent) || isSearchTreeFileMatch(parent)) && arrayContainsElementOrParent(parent, elementsToReplace)) {
					return;
				}

				if (isSearchTreeFileMatch(elem)) {
					await elem.parent().replace(elem);
				} else if (isSearchTreeMatch(elem)) {
					await elem.parent().replace(elem);
				} else if (isSearchTreeFolderMatch(elem)) {
					await elem.replaceAll();
				}
			}));
		} finally {
			this._onChange.resume();
		}
	}

	batchRemove(elementsToRemove: RenderableMatch[]) {
		const removedElems: RenderableMatch[] = [];

		try {
			this._onChange.pause();
			elementsToRemove.forEach((currentElement) => {
				if (!arrayContainsElementOrParent(currentElement, removedElems)) {
					if (isTextSearchHeading(currentElement)) {
						currentElement.hide();
					} else if (!isSearchTreeFolderMatch(currentElement) || isSearchTreeFolderMatchWithResource(currentElement) || isSearchTreeFolderMatchNoRoot(currentElement)) {
						if (isSearchTreeFileMatch(currentElement)) {
							currentElement.parent().remove(currentElement);
						} else if (isSearchTreeMatch(currentElement)) {
							currentElement.parent().remove(currentElement);
						} else if (isSearchTreeFolderMatchWithResource(currentElement)) {
							currentElement.parent().remove(currentElement);
						} else if (isSearchTreeFolderMatchNoRoot(currentElement)) {
							const parent = currentElement.parent();
							if (isTextSearchHeading(parent)) {
								parent.remove(currentElement);
							}
						}
						removedElems.push(currentElement);
					}
				}
			});
		} finally {
			this._onChange.resume();
		}
	}

	get isDirty(): boolean {
		return this._plainTextSearchResult.isDirty;
	}

	get query(): ITextQuery | null {
		return this._plainTextSearchResult.query;
	}

	set query(query: ITextQuery | null) {
		this._plainTextSearchResult.query = query;
	}

	folderMatches(): ISearchTreeFolderMatch[] {
		return this._plainTextSearchResult.folderMatches();
	}

	private onModelAdded(model: ITextModel): void {
		const folderMatch = this._plainTextSearchResult.findFolderSubstr(model.uri);
		folderMatch?.bindModel(model);
	}

	add(allRaw: IFileMatch[], searchInstanceID: string, silent: boolean = false): void {
		this._plainTextSearchResult.hidden = false;
		this._plainTextSearchResult.add(allRaw, searchInstanceID, silent);
	}

	clear(): void {
		this._plainTextSearchResult.clear();
	}

	remove(matches: ISearchTreeFileMatch | ISearchTreeFolderMatch | (ISearchTreeFileMatch | ISearchTreeFolderMatch)[]): void {
		this._plainTextSearchResult.remove(matches);
	}

	replace(match: ISearchTreeFileMatch): Promise<any> {
		return this._plainTextSearchResult.replace(match);
	}

	matches(): ISearchTreeFileMatch[] {
		return this._plainTextSearchResult.matches();
	}

	isEmpty(): boolean {
		return this._plainTextSearchResult.isEmpty();
	}

	fileCount(): number {
		return this._plainTextSearchResult.fileCount();
	}

	count(): number {
		return this._plainTextSearchResult.count();
	}

	setCachedSearchComplete(cachedSearchComplete: ISearchComplete | undefined) {
		this._plainTextSearchResult.cachedSearchComplete = cachedSearchComplete;
	}

	getCachedSearchComplete(): ISearchComplete | undefined {
		return this._plainTextSearchResult.cachedSearchComplete;
	}

	toggleHighlights(value: boolean): void {
		this._plainTextSearchResult.toggleHighlights(value);
	}

	getRangeHighlightDecorations(): RangeHighlightDecorations {
		return this._plainTextSearchResult.rangeHighlightDecorations;
	}

	replaceAll(progress: IProgress<IProgressStep>): Promise<any> {
		return this._plainTextSearchResult.replaceAll(progress);
	}

	override async dispose(): Promise<void> {
		this._plainTextSearchResult.dispose();
		super.dispose();
	}
}
