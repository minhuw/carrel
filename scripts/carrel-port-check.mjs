#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORBIDDEN_ROOTS = [
	'build/agent-sdk',
	'build/agentHost',
	'build/dictation-runtime',
	'extensions/copilot',
	'extensions/debug-auto-launch',
	'extensions/mermaid-markdown-features',
	'src/vs/platform/agentHost',
	'src/vs/platform/browserView',
	'src/vs/platform/chat',
	'src/vs/platform/customizationMarketplace',
	'src/vs/platform/mcp',
	'src/vs/platform/networkFilter',
	'src/vs/platform/telemetry/electron-browser',
	'src/vs/platform/webContentExtractor',
	'src/vs/sessions',
	'src/vs/workbench/contrib/agentsVoice',
	'src/vs/workbench/contrib/browserView',
	'src/vs/workbench/contrib/canvases',
	'src/vs/workbench/contrib/chat',
	'src/vs/workbench/contrib/debug',
	'src/vs/workbench/contrib/editTelemetry',
	'src/vs/workbench/contrib/inlineChat',
	'src/vs/workbench/contrib/interactive',
	'src/vs/workbench/contrib/mcp',
	'src/vs/workbench/contrib/notebook',
	'src/vs/workbench/contrib/onboarding',
	'src/vs/workbench/contrib/replNotebook',
	'src/vs/workbench/contrib/telemetry',
	'src/vs/workbench/contrib/terminalContrib/chatAgentTools',
	'src/vs/workbench/contrib/testing',
	'src/vs/workbench/contrib/update',
	'src/vs/workbench/services/agentHost',
	'src/vs/workbench/services/browserView',
	'src/vs/workbench/services/chat',
	'src/vs/workbench/services/notebook',
	'src/vs/workbench/services/telemetry',
	'src/vs/workbench/services/update',
	'test/integration/agentHost',
	'test/smoke/src/areas/agentsWindow',
	'test/smoke/src/areas/browserView',
	'test/smoke/src/areas/chat',
];

export const AI_DEPENDENCIES = [
	'@anthropic-ai/claude-agent-sdk',
	'@github/copilot',
	'@github/copilot-sdk',
	'@hpke/core',
	'@microsoft/mxc-sdk',
	'@openai/codex',
	'@vscode/copilot-api',
	'foundry-local-sdk',
	'libsodium-wrappers',
];

const MANIFEST_ROOTS = ['.', 'remote', 'extensions/markdown-language-features'];
const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

export function findForbiddenFiles(files) {
	return files.filter(file => FORBIDDEN_ROOTS.some(root => file === root || file.startsWith(`${root}/`)));
}

export function auditManifest(pkg, lock) {
	const errors = [];
	if (pkg.version && lock.version && pkg.version !== lock.version) {
		errors.push(`version ${pkg.version} does not match lock version ${lock.version}`);
	}
	const lockRoot = lock.packages?.[''] ?? {};
	for (const kind of DEPENDENCY_KINDS) {
		const manifestDeps = pkg[kind] ?? {};
		const lockDeps = lockRoot[kind] ?? {};
		for (const [name, spec] of Object.entries(manifestDeps)) {
			if (!(name in lockDeps)) {
				errors.push(`${kind}.${name} is missing from lock root`);
			} else if (lockDeps[name] !== spec) {
				errors.push(`${kind}.${name} spec ${spec} does not match lock root ${lockDeps[name]}`);
			}
		}
		for (const name of Object.keys(lockDeps)) {
			if (!(name in manifestDeps)) {
				errors.push(`${kind}.${name} is only present in lock root`);
			}
		}
	}
	for (const name of AI_DEPENDENCIES) {
		if (DEPENDENCY_KINDS.some(kind => name in (pkg[kind] ?? {}))) {
			errors.push(`AI dependency ${name} was reintroduced in manifest`);
		}
	}
	return errors;
}

function listFiles() {
	return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
		.split('\0')
		.filter(Boolean);
}

function conflictMarkerFiles() {
	const args = ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>)', '--',
		'*.ts', '*.tsx', '*.js', '*.mjs', '*.json', '*.md', '*.rs', '*.toml',
		'*.yml', '*.yaml', '*.sh', '*.bat', '*.ps1', '*.py', '*.css', '*.html'];
	try {
		return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
			.split('\n')
			.filter(Boolean);
	} catch (error) {
		if (error.status === 1) {
			return [];
		}
		throw error;
	}
}

export function main() {
	const errors = [];
	const files = listFiles();
	for (const root of FORBIDDEN_ROOTS) {
		const matches = findForbiddenFiles(files).filter(file => file === root || file.startsWith(`${root}/`));
		if (matches.length) {
			errors.push(`${root}: ${matches.length} file(s) in removed root; examples: ${matches.slice(0, 5).join(', ')}`);
		}
	}
	for (const root of MANIFEST_ROOTS) {
		if (!existsSync(join(root, 'package.json')) || !existsSync(join(root, 'package-lock.json'))) {
			continue;
		}
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
		for (const error of auditManifest(pkg, lock)) {
			errors.push(`${root}: ${error}`);
		}
	}
	for (const file of conflictMarkerFiles()) {
		errors.push(`${file}: conflict marker`);
	}
	if (errors.length) {
		console.error(`Carrel port check failed:\n${errors.map(error => `  - ${error}`).join('\n')}`);
		process.exitCode = 1;
		return;
	}
	console.log(`Carrel port check passed (${files.length} files, ${MANIFEST_ROOTS.length} manifest/lock pairs).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
