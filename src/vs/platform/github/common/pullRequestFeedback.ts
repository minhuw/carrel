/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitHubActor } from './githubPullRequestService.js';

const maintainerAssociations = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export function isPullRequestFeedbackAuthor(actor: GitHubActor | undefined): boolean {
	return !!actor && maintainerAssociations.has(actor.association?.toUpperCase() ?? '');
}
