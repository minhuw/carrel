/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws } from 'assert';
import { errorHandler, setUnexpectedErrorHandler } from '../../common/errors.js';
import { installNodeUnhandledRejectionHandler } from '../../node/processUnhandledRejectionHandler.js';

suite('NodeUnhandledRejectionHandler', () => {
	test('installs and disposes process listeners', () => {
		const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
		const before = getListenerCounts();
		const disposable = installNodeUnhandledRejectionHandler(() => { });
		try {
			deepStrictEqual(getListenerCounts(), {
				unhandledRejection: before.unhandledRejection + 1,
				rejectionHandled: before.rejectionHandled + 1,
			});
			strictEqual(errorHandler.getUnexpectedErrorHandler() === previousUnexpectedErrorHandler, false);
		} finally {
			disposable.dispose();
		}
		deepStrictEqual(getListenerCounts(), before);
		strictEqual(errorHandler.getUnexpectedErrorHandler(), previousUnexpectedErrorHandler);
	});

	test('rejects overlapping installations', () => {
		const disposable = installNodeUnhandledRejectionHandler(() => { });
		try {
			throws(() => installNodeUnhandledRejectionHandler(() => { }), /already installed/);
		} finally {
			disposable.dispose();
		}
	});

	test('does not replace a newer unexpected error handler on dispose', () => {
		const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
		const disposable = installNodeUnhandledRejectionHandler(() => { });
		const newerUnexpectedErrorHandler = () => { };
		try {
			setUnexpectedErrorHandler(newerUnexpectedErrorHandler);
			disposable.dispose();
			strictEqual(errorHandler.getUnexpectedErrorHandler(), newerUnexpectedErrorHandler);
		} finally {
			disposable.dispose();
			setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
		}
	});
});

function getListenerCounts() {
	return {
		unhandledRejection: process.listenerCount('unhandledRejection'),
		rejectionHandled: process.listenerCount('rejectionHandled'),
	};
}
