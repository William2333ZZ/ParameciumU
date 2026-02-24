import { registerModel, registerProvider } from "../registry.js";
import { createOpenAIProvider } from "./openai.js";

export function registerBuiltins(): void {
	const openai = createOpenAIProvider();
	registerProvider("openai", openai);
	registerModel("openai", "gpt-4o", { api: "openai", id: "gpt-4o", provider: "openai" });
	registerModel("openai", "gpt-4o-mini", { api: "openai", id: "gpt-4o-mini", provider: "openai" });
	registerModel("openai", "gpt-4-turbo", { api: "openai", id: "gpt-4-turbo", provider: "openai" });
}
