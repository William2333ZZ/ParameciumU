import type { LLMProvider, Model } from "./types.js";

const providerRegistry = new Map<string, LLMProvider>();

/** Models: provider -> modelId -> Model. V1 static; can be replaced by generated list. */
const modelRegistry = new Map<string, Map<string, Model>>();

export function registerProvider(api: string, provider: LLMProvider): void {
	providerRegistry.set(api, provider);
}

export function getProvider(api: string): LLMProvider | undefined {
	return providerRegistry.get(api);
}

export function registerModel(provider: string, modelId: string, model: Model): void {
	let map = modelRegistry.get(provider);
	if (!map) {
		map = new Map();
		modelRegistry.set(provider, map);
	}
	map.set(modelId, model);
}

export function getModel(provider: string, modelId: string): Model | undefined {
	return modelRegistry.get(provider)?.get(modelId);
}

export function getProviders(): string[] {
	return Array.from(providerRegistry.keys());
}
