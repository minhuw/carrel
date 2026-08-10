/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { errorHandler, isCancellationError, onUnexpectedError, setUnexpectedErrorHandler } from '../common/errors.js';
import { IDisposable, toDisposable } from '../common/lifecycle.js';

let isInstalled = false;

/**
 * Installs the process-level unhandled rejection handling that Node.js hosts need independently of telemetry.
 */
export function installNodeUnhandledRejectionHandler(logError: (error: unknown) => void): IDisposable {
	if (isInstalled) {
		throw new Error('Node unhandled rejection handler is already installed');
	}
	isInstalled = true;

	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	const unexpectedErrorHandler = (error: unknown) => logError(error);
	setUnexpectedErrorHandler(unexpectedErrorHandler);

	const unhandledPromises = new Map<Promise<unknown>, Timeout>();
	const onUnhandledRejection = (reason: unknown, promise: Promise<unknown>) => {
		const handle = setTimeout(() => {
			unhandledPromises.delete(promise);
			promise.catch(error => {
				if (!isCancellationError(error)) {
					onUnexpectedError(reason ?? error);
				}
			});
		}, 1000);
		unhandledPromises.set(promise, handle);
	};
	const onRejectionHandled = (promise: Promise<unknown>) => {
		const handle = unhandledPromises.get(promise);
		if (handle) {
			clearTimeout(handle);
			unhandledPromises.delete(promise);
		}
	};

	process.on('unhandledRejection', onUnhandledRejection);
	process.on('rejectionHandled', onRejectionHandled);

	return toDisposable(() => {
		process.off('unhandledRejection', onUnhandledRejection);
		process.off('rejectionHandled', onRejectionHandled);
		for (const handle of unhandledPromises.values()) {
			clearTimeout(handle);
		}
		unhandledPromises.clear();
		if (errorHandler.getUnexpectedErrorHandler() === unexpectedErrorHandler) {
			setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
		}
		isInstalled = false;
	});
}
