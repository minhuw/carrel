/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { GitHubActor } from '../../common/githubPullRequestService.js';
import { isPullRequestFeedbackAuthor } from '../../common/pullRequestFeedback.js';

suite('PullRequestFeedback', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts maintainer associations as feedback authors', () => {
		assert.deepStrictEqual(['OWNER', 'member', 'COLLABORATOR'].map(association =>
			isPullRequestFeedbackAuthor(upcastPartial<GitHubActor>({ login: 'reviewer', association }))), [true, true, true]);
	});
});
