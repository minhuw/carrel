/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export interface IAssignmentFilter {
	/**
	 * Stable identifier for this filter. Used to persist and reconcile the set of
	 * assignment-context ids this filter has excluded, independently of other filters.
	 */
	readonly id: string;
	exclude(assignment: string): boolean;
	onDidChange: Event<void>;
}

export const IWorkbenchAssignmentService = createDecorator<IWorkbenchAssignmentService>('assignmentService');

export interface IWorkbenchAssignmentService {
	readonly _serviceBrand: undefined;

	readonly onDidRefetchAssignments: Event<void>;
	getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined>;
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
}

/**
 * Carrel ships without experiments, so the assignment service never returns
 * treatments.
 */
export class NullWorkbenchAssignmentService implements IWorkbenchAssignmentService {
	declare readonly _serviceBrand: undefined;

	readonly onDidRefetchAssignments: Event<void> = Event.None;

	async getCurrentExperiments(): Promise<string[] | undefined> {
		return [];
	}

	async getTreatment<T extends string | number | boolean>(_name: string): Promise<T | undefined> {
		return undefined;
	}

	addTelemetryAssignmentFilter(_filter: IAssignmentFilter): void { }
}

registerSingleton(IWorkbenchAssignmentService, NullWorkbenchAssignmentService, InstantiationType.Delayed);
