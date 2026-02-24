/**
 * Minimal frontmatter parser: extract --- ... --- block and parse key: value.
 * Supports name, description, disable-model-invocation.
 */

export interface ParsedFrontmatter<T = Record<string, unknown>> {
	frontmatter: T;
	body: string;
}

function normalizeNewlines(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractBlock(content: string): { yaml: string | null; body: string } {
	const norm = normalizeNewlines(content);
	if (!norm.startsWith("---")) {
		return { yaml: null, body: norm };
	}
	const end = norm.indexOf("\n---", 3);
	if (end === -1) {
		return { yaml: null, body: norm };
	}
	return {
		yaml: norm.slice(4, end),
		body: norm.slice(end + 4).trim(),
	};
}

function parseYamlBlock(yaml: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let key = "";
	let value: string[] = [];
	const flush = () => {
		if (key) {
			const v = value.join("\n").trim();
			if (v === "true") out[key] = true;
			else if (v === "false") out[key] = false;
			else out[key] = v;
			key = "";
			value = [];
		}
	};
	for (const line of yaml.split(/\n/)) {
		const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
		if (match) {
			flush();
			key = match[1];
			const rest = match[2].trim();
			if (rest) value.push(rest);
		} else if (key && (line.startsWith("  ") || line.startsWith("\t"))) {
			value.push(line.replace(/^\s+/, ""));
		} else {
			flush();
		}
	}
	flush();
	return out;
}

export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> {
	const { yaml, body } = extractBlock(content);
	if (!yaml) {
		return { frontmatter: {} as T, body };
	}
	const parsed = parseYamlBlock(yaml);
	return { frontmatter: parsed as T, body };
}
