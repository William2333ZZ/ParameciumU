/**
 * Generate a simple unique id for messages/tools (no crypto dependency).
 */
let counter = 0;
const prefix = `monou_${Date.now().toString(36)}_`;

export function createId(): string {
	return `${prefix}${(++counter).toString(36)}`;
}
