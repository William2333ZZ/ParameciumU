/**
 * Skill frontmatter (YAML block in SKILL.md).
 * Agent Skills spec: name, description; optional disable-model-invocation.
 */
export interface SkillFrontmatter {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	[key: string]: unknown;
}

/**
 * Loaded skill: name, description, file path, base dir, source label, and invocation flag.
 */
export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: string;
	disableModelInvocation: boolean;
}

/**
 * Result of loading skills from one or more locations.
 */
export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/**
 * Diagnostic from loading (warning or collision).
 */
export interface ResourceDiagnostic {
	type: "warning" | "collision";
	message: string;
	path: string;
	collision?: {
		resourceType: string;
		name: string;
		winnerPath: string;
		loserPath: string;
	};
}

export interface LoadSkillsFromDirOptions {
	dir: string;
	source: string;
}

export interface LoadSkillsOptions {
	cwd?: string;
	agentDir?: string;
	skillPaths?: string[];
	includeDefaults?: boolean;
}
