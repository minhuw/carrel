/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Carrel: type-only remnant of the experimentation telemetry plumbing. The
 * experimentation service and its reporters were removed; this interface
 * remains so the parameter types that flow through the client host keep
 * compiling (they are always `undefined` at runtime and no-opped).
 */
export interface IExperimentationTelemetryReporter {
	postEventObj(eventName: string, props: { [prop: string]: string }): void;
	dispose(): void;
}
