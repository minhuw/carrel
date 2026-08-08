/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../base/common/platform.js';
import { stripUTF8BOM } from '../../../base/common/strings.js';
import { getDevDeviceId, getMachineId, getSqmMachineId } from '../../../base/node/id.js';
import { ILogService } from '../../log/common/log.js';
import { IStateService } from '../../state/node/state.js';
import { devDeviceIdKey, machineIdKey, sqmIdKey } from '../../telemetry/common/telemetry.js';

export async function resolveMachineId(stateService: IStateService, logService: ILogService): Promise<string> {
	logService.trace('Resolving machine identifier...');
	// We cache the machineId for faster lookups
	// and resolve it only once initially if not cached or we need to replace the macOS iBridge device
	let machineId = stateService.getItem<string>(machineIdKey);
	if (typeof machineId !== 'string' || (isMacintosh && machineId === '6c9d2bc8f91b89624add29c0abeae7fb42bf539fa1cdb2e3e57cd668fa9bcead')) {
		machineId = await getMachineId(logService.error.bind(logService));
	}
	stateService.setItem(machineIdKey, machineId);
	logService.trace(`Resolved machine identifier: ${machineId}`);
	return machineId;
}

export async function resolveSqmId(stateService: IStateService, logService: ILogService): Promise<string> {
	logService.trace('Resolving SQM identifier...');
	let sqmId = stateService.getItem<string>(sqmIdKey);
	if (typeof sqmId !== 'string') {
		sqmId = await getSqmMachineId(logService.error.bind(logService));
	}
	stateService.setItem(sqmIdKey, sqmId);
	logService.trace(`Resolved SQM identifier: ${sqmId}`);
	return sqmId;
}

export async function resolveDevDeviceId(stateService: IStateService, logService: ILogService): Promise<string> {
	logService.trace('Resolving devDevice identifier...');
	let devDeviceId = stateService.getItem<string>(devDeviceIdKey);
	if (typeof devDeviceId !== 'string') {
		devDeviceId = stripUTF8BOM(await getDevDeviceId(logService.error.bind(logService)));
	}
	stateService.setItem(devDeviceIdKey, devDeviceId);
	logService.trace(`Resolved devDevice identifier: ${devDeviceId}`);
	return devDeviceId;
}

export async function validateDevDeviceId(stateService: IStateService, logService: ILogService): Promise<void> {
	const actualDeviceId = await getDevDeviceId(logService.error.bind(logService));
	const currentDeviceId = await resolveDevDeviceId(stateService, logService);
	if (actualDeviceId !== currentDeviceId) {
		stateService.setItem(devDeviceIdKey, actualDeviceId);
	}
}
