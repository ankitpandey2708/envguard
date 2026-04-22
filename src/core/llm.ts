import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProvidersSync } from './registry.js';

export interface ProviderSuggestion {
  envVar: string;
  provider: string | null;
  reason: string;
  unregistered?: boolean;
}

interface LLMAnalysisResult {
  suggestions: ProviderSuggestion[];
  unmatched: string[];
}

// Get available provider IDs from the registry (sync, may be empty if not initialized)
function getAvailableProviders(): string[] {
  return listProvidersSync();
}

// Build the prompt for LLM analysis
function buildAnalysisPrompt(envVars: string[], providers: string[]): string {
  const providerList = providers.join(', ');

  return `You are analyzing environment variable names to detect API keys and their providers.

Given these environment variable names:
${envVars.map(v => `  - ${v}`).join('\n')}

Currently registered providers: ${providerList}

For each env var, determine if it's an API key and which provider it belongs to, even if that provider is not in the registered list above. Consider:
- Variable name patterns (e.g., OPENAI_API_KEY → openai)
- Known service names (e.g., STRIPE_SECRET_KEY → stripe)
- Common naming conventions

Return a JSON object with this structure:
{
  \"suggestions\": [
    {\"envVar\": \"OPENAI_API_KEY\", \"provider\": \"openai\", \"reason\": \"Standard OpenAI API key naming\"},
    {\"envVar\": \"POSTHOG_PERSONAL_API_KEY\", \"provider\": \"posthog\", \"reason\": \"PostHog personal API key\"},
    {\"envVar\": \"MY_CUSTOM_KEY\", \"provider\": null, \"reason\": \"Unrecognized pattern\"}
  ],
  \"unmatched\": [\"MY_CUSTOM_KEY\"]
}

Include any env var you can identify as an API key in 'suggestions', even if its provider is not in the registered list. Only put truly unrecognizable vars in 'unmatched'.`;
}

// Load package's own .env file for LLM API key
function loadPackageEnv(): Record<string, string> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(__dirname, '../../.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          vars[key] = valueParts.join('=');
        }
      }
      return vars;
    }
  } catch {
    // Ignore errors reading package env
  }
  return {};
}

// Shared instructions for how to set the API key
const KEY_INSTRUCTIONS =
  `Then either:
  export OPENROUTER_API_KEY=sk_or_...
  envguard init

Or:
  envguard init --api-key sk_or_...`;

async function callLLM(prompt: string, apiKey?: string): Promise<string> {
  // Priority: explicit param > user env vars > package's own .env
  const packageEnv = loadPackageEnv();
  const key = apiKey || process.env.OPENROUTER_API_KEY || packageEnv.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(
      `envguard init requires an OpenRouter API key to detect API keys in your .env files.

` +
      `Get a free key at: https://openrouter.ai/keys

` +
      `${KEY_INSTRUCTIONS}

` +
      `Alternatively, create envguard.json manually (see README.md).`
    );
  }

  if (key.trim() === 'your_openrouter_api_key_here' || key.trim() === 'your_llm_api_key_here') {
    throw new Error(
      `OPENROUTER_API_KEY appears to be a placeholder value.

` +
      `Get a real key at: https://openrouter.ai/keys

` +
      `${KEY_INSTRUCTIONS}`
    );
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that analyzes environment variable names. Always respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

export async function analyzeEnvVarsWithLLM(
  envVars: string[],
  apiKey?: string
): Promise<LLMAnalysisResult> {
  const providers = getAvailableProviders();
  const prompt = buildAnalysisPrompt(envVars, providers);

  const response = await callLLM(prompt, apiKey);

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const result = JSON.parse(jsonStr) as LLMAnalysisResult;

    // Validate the result
    if (!result.suggestions || !Array.isArray(result.suggestions)) {
      throw new Error('Invalid LLM response format');
    }

    // Mark suggestions whose provider isn't in the registry as unregistered,
    // but keep them all — the user can decide what to do.
    const allSuggestions = result.suggestions.map(s => ({
      ...s,
      unregistered: s.provider != null && !providers.includes(s.provider),
    }));

    // Collect unmatched vars (LLM couldn't identify as API keys)
    const llmUnmatched = result.unmatched || [];

    return {
      suggestions: allSuggestions,
      unmatched: llmUnmatched,
    };
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}\n` +
      `Raw response: ${response.slice(0, 500)}`
    );
  }
}