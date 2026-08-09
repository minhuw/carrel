/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AccountsActivityActionViewItem } from '../../../browser/parts/globalCompositeBar.js';
import { AuthenticationSession, AuthenticationSessionAccount } from '../../../services/authentication/common/authentication.js';

interface IUpdateAvatarTestHarness {
	avatarImg: HTMLImageElement;
	label: HTMLElement;
	configurationService: { getValue(): boolean };
	groupedAccounts: Map<string, (AuthenticationSessionAccount & { canSignOut: boolean })[]>;
}

interface IAddOrUpdateAccountTestHarness {
	groupedAccounts: Map<string, (AuthenticationSessionAccount & { canSignOut: boolean })[]>;
	sessionFromEmbedder: { value: Promise<undefined> };
	authenticationService: { getSessions(): Promise<readonly AuthenticationSession[]> };
}

const updateAvatar = Reflect.get(AccountsActivityActionViewItem.prototype, 'updateAvatar') as (this: IUpdateAvatarTestHarness) => void;
const addOrUpdateAccount = Reflect.get(AccountsActivityActionViewItem.prototype, 'addOrUpdateAccount') as (this: IAddOrUpdateAccountTestHarness, providerId: string, account: AuthenticationSessionAccount) => Promise<void>;

suite('AccountsActivityActionViewItem - updateAvatar', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses the first account with an icon', () => {
		const firstIcon = URI.parse('https://example.com/first.png');
		const groupedAccounts = new Map<string, (AuthenticationSessionAccount & { canSignOut: boolean })[]>();
		groupedAccounts.set('github', [{ id: 'first-id', label: 'first-account', icon: firstIcon, canSignOut: true }]);
		const harness: IUpdateAvatarTestHarness = {
			avatarImg: document.createElement('img'),
			label: document.createElement('div'),
			configurationService: { getValue: () => true },
			groupedAccounts,
		};

		updateAvatar.call(harness);

		assert.deepStrictEqual(
			{ src: harness.avatarImg.src, hasAvatarClass: harness.label.classList.contains('has-avatar') },
			{ src: firstIcon.toString(true), hasAvatarClass: true }
		);
	});
});

suite('AccountsActivityActionViewItem - addOrUpdateAccount', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function createAddOrUpdateHarness(accounts: (AuthenticationSessionAccount & { canSignOut: boolean })[]): IAddOrUpdateAccountTestHarness {
		return {
			groupedAccounts: new Map([['github', accounts]]),
			sessionFromEmbedder: { value: Promise.resolve(undefined) },
			authenticationService: { getSessions: async () => [] },
		};
	}

	test('updates the icon of an existing account, including clearing a stale one', async () => {
		const harness = createAddOrUpdateHarness([{ id: 'account-id', label: 'account', icon: URI.parse('https://example.com/stale.png'), canSignOut: true }]);

		await addOrUpdateAccount.call(harness, 'github', { id: 'account-id', label: 'account', icon: URI.parse('https://example.com/fresh.png') });
		const updated = harness.groupedAccounts.get('github')?.[0].icon;

		await addOrUpdateAccount.call(harness, 'github', { id: 'account-id', label: 'account' });
		const cleared = harness.groupedAccounts.get('github')?.[0].icon;

		assert.deepStrictEqual(
			[updated, cleared],
			[URI.parse('https://example.com/fresh.png'), undefined]
		);
	});
});
