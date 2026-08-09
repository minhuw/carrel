/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IKeyValueStorage, IExperimentationTelemetry, ExperimentationService as TASClient } from 'tas-client';
import { Memento } from '../../../common/memento.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { TelemetryTrustedValue } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryData } from '../../../../base/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ASSIGNMENT_REFETCH_INTERVAL, ASSIGNMENT_STORAGE_KEY, AssignmentFilterProvider, IAssignmentService, TargetPopulation, WindowKind } from '../../../../platform/assignment/common/assignment.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { timeout } from '../../../../base/common/async.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { AssignmentContextFilter } from './assignmentContextFilter.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { experimentsEnabled } from '../../telemetry/common/workbenchTelemetryUtils.js';
import { CancellationError } from '../../../../base/common/errors.js';

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

/**
 * Scope prefix that the new TAS assignments endpoint (`/api/v1/assignments`) prepends to the
 * feature variable keys it returns (e.g. `/vscode/config.chat...`). The legacy endpoint and
 * VS Code both query treatments by the bare name, so this prefix must be accounted for when a
 * bare lookup misses. This is an interim workaround until tas-client strips the scope itself.
 */
const ASSIGNMENTS_SCOPE_PREFIX = '/vscode/';

/**
 * Resolves a treatment value preferring the `/vscode/`-scoped key emitted by the new TAS
 * assignments endpoint over the bare key used by the legacy endpoint, so the new endpoint wins
 * when both assign a treatment (matching the behavior once tas-client strips the scope itself).
 * Falls back to the bare key for treatments served only by the legacy endpoint.
 *
 * Exported for testing.
 */
export function resolveScopedTreatment<T extends string | number | boolean>(read: (name: string) => T | undefined, name: string): T | undefined {
	const scoped = read(`${ASSIGNMENTS_SCOPE_PREFIX}${name}`);
	return scoped !== undefined ? scoped : read(name);
}

/**
 * Builds the telemetry payload for a tas-client feature query. The queried-feature name is marked
 * trusted so the telemetry cleaner does not redact a `/vscode/`-scoped name as a `user-file-path`.
 *
 * Exported for testing.
 */
export function toExperimentTelemetryData(props: Map<string, string>): ITelemetryData {
	const data: ITelemetryData = {};
	for (const [key, value] of props.entries()) {
		data[key] = key === 'ABExp.queriedFeature' ? new TelemetryTrustedValue(value) : value;
	}
	return data;
}

export interface IWorkbenchAssignmentService extends IAssignmentService {
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
	/** Resolves the effective value without delaying developer overrides; assignment metadata always comes from TAS. */
	getTreatmentWithAssignment<T extends string | number | boolean>(name: string): Promise<ITreatmentWithAssignment<T>>;
}

export interface ITreatmentWithAssignment<T extends string | number | boolean> {
	readonly value: T | undefined;
	/** May remain pending after a developer override resolves; rejects on failure or cancellation, never conflating these with absence. */
	readonly hasAssignment: Promise<boolean>;
}

export async function resolveTreatmentWithAssignment<T extends string | number | boolean>(override: T | undefined, readAssignment: () => Promise<T | undefined>): Promise<ITreatmentWithAssignment<T>> {
	if (override !== undefined) {
		return { value: override, hasAssignment: readAssignment().then(value => value !== undefined) };
	}
	const value = await readAssignment();
	return { value, hasAssignment: Promise.resolve(value !== undefined) };
}

class MementoKeyValueStorage implements IKeyValueStorage {

	private readonly mementoObj: Record<string, unknown>;

	constructor(private readonly memento: Memento<Record<string, unknown>>) {
		this.mementoObj = memento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	async getValue<T>(key: string, defaultValue?: T | undefined): Promise<T | undefined> {
		const value = await this.mementoObj[key] as T | undefined;

		return value || defaultValue;
	}

	setValue<T>(key: string, value: T): void {
		this.mementoObj[key] = value;
		this.memento.saveMemento();
	}
}

class WorkbenchAssignmentServiceTelemetry extends Disposable implements IExperimentationTelemetry {

	private readonly _onDidUpdateAssignmentContext = this._register(new Emitter<void>());
	readonly onDidUpdateAssignmentContext = this._onDidUpdateAssignmentContext.event;

	private _previousAssignmentContext: string | undefined;
	private _lastAssignmentContext: string | undefined;
	get assignmentContext(): string[] | undefined {
		return this._lastAssignmentContext?.split(';');
	}

	constructor(
		private readonly telemetryService: ITelemetryService,
		private readonly productService: IProductService,
		private readonly contextFilter: AssignmentContextFilter
	) {
		super();

		// Re-apply the filters whenever a filter is added or changes its exclusion decisions.
		this._register(this.contextFilter.onDidChange(() => {
			if (this._previousAssignmentContext) {
				this._setAssignmentContext(this._previousAssignmentContext);
			}
		}));
	}

	private _setAssignmentContext(value: string): void {
		const filteredValue = this.contextFilter.filter(value);
		this._lastAssignmentContext = filteredValue;
		this._onDidUpdateAssignmentContext.fire();

		if (this.productService.tasConfig?.assignmentContextTelemetryPropertyName) {
			this.telemetryService.setExperimentProperty(this.productService.tasConfig.assignmentContextTelemetryPropertyName, filteredValue);
		}
	}

	// __GDPR__COMMON__ "abexp.assignmentcontext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	setSharedProperty(name: string, value: string): void {
		if (name === this.productService.tasConfig?.assignmentContextTelemetryPropertyName) {
			this._previousAssignmentContext = value;
			return this._setAssignmentContext(value);
		}

		this.telemetryService.setExperimentProperty(name, value);
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const data = toExperimentTelemetryData(props);

		/* __GDPR__
			"query-expfeature" : {
				"owner": "sbatten",
				"comment": "Logs queries to the experiment service by feature for metric calculations",
				"ABExp.queriedFeature": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The experimental feature being queried" }
			}
		*/
		this.telemetryService.publicLog(eventName, data);
	}
}

export class WorkbenchAssignmentService extends Disposable implements IAssignmentService {

	declare readonly _serviceBrand: undefined;

	private readonly tasClient: Promise<TASClient> | undefined;
	private readonly tasSetupDisposables = new DisposableStore();

	private networkInitialized = false;
	private readonly overrideInitDelay: Promise<void>;

	private readonly contextFilter: AssignmentContextFilter;
	private readonly telemetry: WorkbenchAssignmentServiceTelemetry;
	private readonly keyValueStorage: IKeyValueStorage;

	private readonly experimentsEnabled: boolean;

	private readonly _onDidRefetchAssignments = this._register(new Emitter<void>());
	public readonly onDidRefetchAssignments = this._onDidRefetchAssignments.event;

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();

		this.experimentsEnabled = experimentsEnabled(configurationService, productService, this.environmentService);

		if (this.experimentsEnabled) {
			this.tasClient = this.setupTASClient();
		}

		this.contextFilter = this._register(new AssignmentContextFilter(storageService));
		this.telemetry = this._register(new WorkbenchAssignmentServiceTelemetry(telemetryService, productService, this.contextFilter));
		this._register(this.telemetry.onDidUpdateAssignmentContext(() => this._onDidRefetchAssignments.fire()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('experiments.override')) {
				this._onDidRefetchAssignments.fire();
			}
		}));

		this.keyValueStorage = new MementoKeyValueStorage(new Memento<Record<string, unknown>>('experiment.service.memento', storageService));

		// For development purposes, configure the delay until tas local tas treatment ovverrides are available
		const overrideDelaySetting = configurationService.getValue('experiments.overrideDelay');
		const overrideDelay = typeof overrideDelaySetting === 'number' ? overrideDelaySetting : 0;
		this.overrideInitDelay = timeout(overrideDelay);
	}

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		const result = await this.doGetTreatment<T>(name);
		this.logTreatment(name, result);
		return result;
	}

	async getTreatmentWithAssignment<T extends string | number | boolean>(name: string): Promise<ITreatmentWithAssignment<T>> {
		await this.overrideInitDelay;
		const override = this.configurationService.getValue<T>(`experiments.override.${name}`);
		const result = await resolveTreatmentWithAssignment(override, () => this.getAssignedTreatment<T>(name, true));
		this.logTreatment(name, result.value);
		return result;
	}

	private logTreatment(name: string, result: string | number | boolean | undefined): void {
		type TASClientReadTreatmentData = {
			treatmentName: string;
			treatmentValue: string;
		};

		type TASClientReadTreatmentClassification = {
			owner: 'sbatten';
			comment: 'Logged when a treatment value is read from the experiment service';
			treatmentValue: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The value of the read treatment' };
			treatmentName: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The name of the treatment that was read' };
		};

		this.telemetryService.publicLog2<TASClientReadTreatmentData, TASClientReadTreatmentClassification>('tasClientReadTreatmentComplete', {
			treatmentName: name,
			treatmentValue: JSON.stringify(result)
		});
	}

	private async doGetTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		await this.overrideInitDelay; // For development purposes, allow overriding tas assignments to test variants locally.

		const override = this.configurationService.getValue<T>(`experiments.override.${name}`);
		if (override !== undefined) {
			return override;
		}

		return this.getAssignedTreatment<T>(name, false);
	}

	private async getAssignedTreatment<T extends string | number | boolean>(name: string, requireCurrentClient: boolean): Promise<T | undefined> {
		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		for (let attempt = 0; attempt < 2; attempt++) {
			if (requireCurrentClient && this._store.isDisposed) {
				throw new CancellationError();
			}
			const clientPromise: Promise<TASClient> = this.tasClient;
			const client = await clientPromise;

			// Prefer cached treatments while the initial fetch is still pending.
			if (!this.networkInitialized) {
				await client.getTreatmentVariableAsync<T>('vscode', `${ASSIGNMENTS_SCOPE_PREFIX}${name}`, true);
			}
			// Assignment metadata must not outlive its client; legacy value-only reads retain their original contract.
			if (requireCurrentClient) {
				if (this._store.isDisposed) {
					throw new CancellationError();
				}
				if (clientPromise !== this.tasClient) {
					continue;
				}
			}
			return resolveScopedTreatment<T>(readName => client.getTreatmentVariable<T>('vscode', readName), name);
		}
		throw new CancellationError();
	}

	private async setupTASClient(): Promise<TASClient> {
		this.tasSetupDisposables.clear();

		const targetPopulation = this.productService.quality === 'stable' ?
			TargetPopulation.Public : (this.productService.quality === 'exploration' ?
				TargetPopulation.Exploration : TargetPopulation.Insiders);

		const filterProvider = new AssignmentFilterProvider(
			this.productService.version,
			this.productService.nameLong,
			this.telemetryService.machineId,
			this.telemetryService.devDeviceId,
			targetPopulation,
			this.productService.date ?? '',
			this.environmentService.isSessionsWindow ? WindowKind.Agents : WindowKind.Editor
		);

		const tasConfig = this.productService.tasConfig!;

		const tasClientModule = await importAMDNodeModule<typeof import('tas-client')>('tas-client', 'dist/tas-client.min.js');

		// Measure the client-side latency of the first network call to the
		// Treatment Assignment Service. The fetch is triggered by constructing
		// the client, so start timing right before construction to exclude
		// module loading time from the measurement.
		const fetchStopWatch = StopWatch.create();
		const tasClient = new tasClientModule.ExperimentationService({
			filterProviders: [filterProvider],
			telemetry: this.telemetry,
			storageKey: ASSIGNMENT_STORAGE_KEY,
			keyValueStorage: this.keyValueStorage,
			assignmentContextTelemetryPropertyName: tasConfig.assignmentContextTelemetryPropertyName,
			telemetryEventName: tasConfig.telemetryEventName,
			endpoint: tasConfig.endpoint,
			refetchInterval: ASSIGNMENT_REFETCH_INTERVAL,
		});

		await tasClient.initializePromise;
		tasClient.initialFetch.then(() => {
			this.networkInitialized = true;
			this.logFetchLatency('initial', fetchStopWatch.elapsed());
		}).catch(() => undefined);

		return tasClient;
	}

	private logFetchLatency(fetchType: 'initial' | 'refetch', durationMs: number): void {
		type TASClientFetchLatencyData = {
			fetchType: string;
			durationMs: number;
		};

		type TASClientFetchLatencyClassification = {
			owner: 'sbatten';
			comment: 'Measures the client-side latency of fetching treatment assignments from the experiment service (TAS)';
			fetchType: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether this was the initial fetch or a refetch' };
			durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Time in milliseconds the fetch took to complete' };
		};

		this.telemetryService.publicLog2<TASClientFetchLatencyData, TASClientFetchLatencyClassification>('tasClientFetchLatency', {
			fetchType,
			durationMs
		});
	}

	async getCurrentExperiments(): Promise<string[] | undefined> {
		if (!this.tasClient) {
			return undefined;
		}

		if (!this.experimentsEnabled) {
			return undefined;
		}

		await this.tasClient;

		return this.telemetry.assignmentContext;
	}

	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void {
		this.contextFilter.addFilter(filter);
	}
}

registerSingleton(IWorkbenchAssignmentService, WorkbenchAssignmentService, InstantiationType.Delayed);

const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
registry.registerConfiguration({
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.enableExperiments': {
			'type': 'boolean',
			'description': localize('workbench.enableExperiments', "Fetches experiments to run from a Microsoft online service."),
			'default': true,
			'scope': ConfigurationScope.APPLICATION,
			'restricted': true,
			'tags': ['usesOnlineServices']
		}
	}
});
