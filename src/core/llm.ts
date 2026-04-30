import { listProvidersSync } from './registry.js';
import { MANUAL_CONFIG_HINT } from './config.js';

const LOG_DIVIDER = '-'.repeat(60);

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

  // Build a fill-in-the-blank table that's hard for weak models to misinterpret
  const rows = envVars.map(v => `  ${v}  ->  provider: ______  (or "unmatched")`).join('\n');

  return [
    'For each env var, fill in the provider (the SERVICE it belongs to).',
    '',
    'Env vars:',
    rows,
    '',
    'Registered providers: ' + providerList,
    '',
    'RULE 1: An API key contains KEY, SECRET, or TOKEN in the name.',
    '  Examples: GEMINI_API_KEY, OPENROUTER_API_KEY, UPSTASH_REDIS_REST_TOKEN, SARVAM_KEY',
    'RULE 2: provider is ONE lowercase word = the service name.',
    '  CORRECT: "posthog", "gemini", "openrouter", "upstash", "sarvam", "stripe", "turn"',
    '  WRONG: "secret credential", "authentication", "api key", "credential"',
    'RULE 3: These are NOT API keys -> put in unmatched:',
    '  - *_MODEL (GEMINI_MODEL, SARVAM_MODEL, OPENROUTER_MODEL) -> config, not secrets',
    '  - *_URL, *_HOST, *_ENDPOINT -> endpoints, not secrets',
    '  - *_ENABLED, *_FLAG -> booleans, not secrets',
    '  - *_USERNAME (without paired *_PASSWORD) -> not a secret alone',
    'RULE 4: NEXT_PUBLIC_ prefix does NOT disqualify an API key.',
    '  NEXT_PUBLIC_POSTHOG_KEY -> IS an API key, provider: "posthog"',
    '  NEXT_PUBLIC_POSTHOG_ENABLED -> NOT an API key (boolean flag)',
    '',
    'Respond with ONLY valid JSON like this example:',
    '{"suggestions":[{"envVar":"OPENAI_API_KEY","provider":"openai","reason":"API key"}],"unmatched":["OPENAI_MODEL","SOME_URL"]}',
  ].join('\n');
}

// Shared instructions for how to set the API key
const KEY_INSTRUCTIONS =
  `Then either:\n  export OPENROUTER_API_KEY=sk_or_...\n  envguard init\n\nOr:\n  envguard init --api-key sk_or_...`;

async function callLLM(prompt: string, apiKey?: string, model?: string): Promise<string> {
  // Priority: explicit param > user env vars
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  const resolvedModel = model || process.env.OPENROUTER_MODEL || 'openrouter/free';

  if (!key) {
    throw new Error(
      `envguard init requires an OpenRouter API key to detect API keys in your .env files.\n\n` +
      `Get a free key at: https://openrouter.ai/keys\n\n` +
      `${KEY_INSTRUCTIONS}\n\n` +
      `Alternatively, ${MANUAL_CONFIG_HINT}`
    );
  }

  if (key.trim() === 'your_openrouter_api_key_here' || key.trim() === 'your_llm_api_key_here') {
    throw new Error(
      `OPENROUTER_API_KEY appears to be a placeholder value.\n\n` +
      `Get a real key at: https://openrouter.ai/keys\n\n` +
      `${KEY_INSTRUCTIONS}`
    );
  }

  console.error(`[envguard] LLM model: ${resolvedModel}`);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        {
          role: 'system',
          content: 'You fill in blanks. provider = one lowercase word (service name). NEVER multi-word descriptions like "secret credential". If var is not an API key (no KEY/SECRET/TOKEN in name), put it in unmatched. Respond with ONLY valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

/** Strip markdown code fences from LLM output. */
function stripCodeFences(text: string): string {
  let out = text.trim();
  if (out.startsWith('```json')) out = out.slice(7);
  else if (out.startsWith('```')) out = out.slice(3);
  if (out.endsWith('```')) out = out.slice(0, -3);
  return out.trim();
}

/** Whether a provider string is a valid single-word identifier. */
function isValidProvider(provider: string | null): provider is string {
  return !!provider && provider !== 'unknown' && provider !== 'null' && provider !== 'unmatched' && !/\s/.test(provider);
}

/**
 * Post-process raw LLM output into a clean result:
 *  - Strips code fences, parses JSON
 *  - Splits suggestions into valid vs invalid by provider
 *  - Marks unregistered providers
 *  - Recovers dropped env vars as unmatched
 */
function processLLMResponse(response: string, envVars: string[], providers: string[]): LLMAnalysisResult {
  const jsonStr = stripCodeFences(response);
  const raw = JSON.parse(jsonStr) as LLMAnalysisResult;

  if (!raw.suggestions || !Array.isArray(raw.suggestions)) {
    throw new Error('Invalid LLM response format');
  }

  // Partition into valid and invalid suggestions
  const valid = raw.suggestions.filter(s => isValidProvider(s.provider));
  const invalid = raw.suggestions.filter(s => !isValidProvider(s.provider));

  // Mark suggestions whose provider isn't in the registry
  const suggestions = valid.map(s => ({
    ...s,
    unregistered: !providers.includes(s.provider!),
  }));

  // Collect unmatched: from LLM + filtered-out invalid + dropped vars
  const llmUnmatched: string[] = raw.unmatched ?? [];
  const filteredOut = invalid.map(s => s.envVar);

  const classified = new Set([
    ...suggestions.map(s => s.envVar),
    ...llmUnmatched,
    ...filteredOut,
  ]);
  const dropped = envVars.filter(v => !classified.has(v));
  if (dropped.length > 0) {
    console.error(LOG_DIVIDER);
    console.error(`[envguard] LLM dropped ${dropped.length} var(s) (not in suggestions or unmatched): ${dropped.join(', ')}`);
  }

  return {
    suggestions,
    unmatched: [...new Set([...llmUnmatched, ...filteredOut, ...dropped])],
  };
}

export async function analyzeEnvVarsWithLLM(
  envVars: string[],
  apiKey?: string,
  model?: string,
): Promise<LLMAnalysisResult> {
  const providers = getAvailableProviders();
  const prompt = buildAnalysisPrompt(envVars, providers);

  const response = await callLLM(prompt, apiKey, model);
  console.error(LOG_DIVIDER);
  console.error('[envguard] LLM request:', prompt);
  console.error(LOG_DIVIDER);
  console.error('[envguard] LLM response:', response);

  try {
    return processLLMResponse(response, envVars, providers);
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}\n` +
      `Raw response: ${response.slice(0, 500)}`
    );
  }
}

