import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type {
	LoadSkillsFromDirOptions,
	LoadSkillsOptions,
	LoadSkillsResult,
	ResourceDiagnostic,
	Skill,
	SkillFrontmatter,
} from "./types.js";

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const CONFIG_DIR_NAME = ".pi";

function validateName(name: string, parentDirName: string): string[] {
	const err: string[] = [];
	if (name !== parentDirName) {
		err.push(`name "${name}" does not match parent directory "${parentDirName}"`);
	}
	if (name.length > MAX_NAME_LENGTH) {
		err.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		err.push("name must be lowercase a-z, 0-9, hyphens only");
	}
	if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
		err.push("name must not start/end with hyphen or contain consecutive hyphens");
	}
	return err;
}

function validateDescription(desc: string | undefined): string[] {
	if (!desc || desc.trim() === "") return ["description is required"];
	if (desc.length > MAX_DESCRIPTION_LENGTH) {
		return [`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`];
	}
	return [];
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	try {
		const raw = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		const descErrors = validateDescription(frontmatter.description);
		for (const e of descErrors) diagnostics.push({ type: "warning", message: e, path: filePath });

		const name = frontmatter.name ?? parentDirName;
		const nameErrors = validateName(name, parentDirName);
		for (const e of nameErrors) diagnostics.push({ type: "warning", message: e, path: filePath });

		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, diagnostics };
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir: skillDir,
				source,
				disableModelInvocation: frontmatter["disable-model-invocation"] === true,
			},
			diagnostics,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message: msg, path: filePath });
		return { skill: null, diagnostics };
	}
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootMd: boolean,
	rootDir: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	if (!existsSync(dir)) return { skills, diagnostics };

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;

			const fullPath = join(dir, entry.name);
			let isDir = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const st = statSync(fullPath);
					isDir = st.isDirectory();
					isFile = st.isFile();
				} catch {
					continue;
				}
			}

			if (isDir) {
				const sub = loadSkillsFromDirInternal(fullPath, source, false, rootDir);
				skills.push(...sub.skills);
				diagnostics.push(...sub.diagnostics);
				continue;
			}

			if (!isFile) continue;
			const isRootMd = includeRootMd && entry.name.endsWith(".md");
			const isSkillMd = !includeRootMd && entry.name === "SKILL.md";
			if (!isRootMd && !isSkillMd) continue;

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) skills.push(result.skill);
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { skills, diagnostics };
}

/**
 * Load skills from a single directory.
 * Discovery: direct .md in root, recursive SKILL.md under subdirs.
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true, dir);
}

function normalizePath(p: string): string {
	const t = p.trim();
	if (t === "~") return homedir();
	if (t.startsWith("~/")) return join(homedir(), t.slice(2));
	if (t.startsWith("~")) return join(homedir(), t.slice(1));
	return t;
}

function resolveSkillPath(p: string, cwd: string): string {
	const n = normalizePath(p);
	return isAbsolute(n) ? n : resolve(cwd, n);
}

function getDefaultAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

/**
 * Load skills from all configured locations: agentDir/skills, cwd/.pi/skills, and explicit skillPaths.
 * Dedupes by realpath; reports collisions by name.
 */
export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	const skillPaths = options.skillPaths ?? [];
	const includeDefaults = options.includeDefaults !== false;

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function add(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			let realPath: string;
			try {
				realPath = realpathSync(skill.filePath);
			} catch {
				realPath = skill.filePath;
			}
			if (realPathSet.has(realPath)) continue;
			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		add(loadSkillsFromDir({ dir: join(agentDir, "skills"), source: "user" }));
		add(loadSkillsFromDir({ dir: resolve(cwd, CONFIG_DIR_NAME, "skills"), source: "project" }));
	}

	for (const rawPath of skillPaths) {
		const resolved = resolveSkillPath(rawPath, cwd);
		if (!existsSync(resolved)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolved });
			continue;
		}
		try {
			const st = statSync(resolved);
			if (st.isDirectory()) {
				add(loadSkillsFromDir({ dir: resolved, source: "path" }));
			} else if (st.isFile() && resolved.endsWith(".md")) {
				const result = loadSkillFromFile(resolved, "path");
				if (result.skill) add({ skills: [result.skill], diagnostics: result.diagnostics });
				else allDiagnostics.push(...result.diagnostics);
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolved });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message: msg, path: resolved });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}
