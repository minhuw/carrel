/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IExtHostContext, extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { IQuotaSnapshotsDto, MainContext, MainThreadChatQuotaShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadChatQuota)
export class MainThreadChatQuota extends Disposable implements MainThreadChatQuotaShape {

	constructor(
		extHostContext: IExtHostContext,
	) {
		super();
	}

	$updateQuotas(_quotas: IQuotaSnapshotsDto): void {
		// no-op: chat entitlements are removed
	}
}
