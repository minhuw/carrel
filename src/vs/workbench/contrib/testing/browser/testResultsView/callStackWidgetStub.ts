/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { ScrollEvent } from '../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

/**
 * Minimal stub of the debug CallStackWidget, which was removed together with
 * the debug feature. The testing feature that consumes this is removed in a
 * follow-up commit; this stub only keeps the code compiling.
 */

export const CALL_STACK_WIDGET_HEADER_HEIGHT = 24;

export class CallStackFrame {
	constructor(
		public readonly label: string,
		public readonly uri: URI | undefined,
		public readonly lineNumber?: number,
		public readonly column?: number,
	) { }
}

export abstract class CustomStackFrame {
	public abstract readonly height: ISettableObservable<number>;
	public abstract readonly label: string;
	public abstract readonly icon: ThemeIcon;
	public readonly showHeader = observableValue<boolean>('CustomStackFrame.showHeader', true);
	public abstract render(container: HTMLElement): IDisposable;
	public abstract renderActions(container: HTMLElement): IDisposable;
}

export type AnyStackFrame = CallStackFrame | CustomStackFrame;

export class CallStackWidget extends Disposable {
	private readonly _onDidChangeContentHeight = this._register(new Emitter<number>());
	public readonly onDidChangeContentHeight: Event<number> = this._onDidChangeContentHeight.event;
	private readonly _onDidScroll = this._register(new Emitter<ScrollEvent>());
	public readonly onDidScroll: Event<ScrollEvent> = this._onDidScroll.event;

	public contentHeight = 0;

	constructor(
		container: HTMLElement,
		editor: ICodeEditor | undefined,
	) {
		super();
		void container;
		void editor;
	}

	public layout(_height: number, _width: number): void { }
	public setFrames(_frames: AnyStackFrame[]): void { }
	public collapseAll(): void { }
}
