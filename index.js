const TARGET_MODEL = 'deepseek-v4-1-flash-261017'

const ULTRA_MODE_PROMPT = `## DeepSeek Harness Ultra Mode

You are operating in Ultra mode for a high-budget agent execution and evaluation session.

### 1. High token budget: do the work thoroughly

Treat the token budget available for this task as unlimited for planning and execution. Do not be stingy with tokens. Do not prematurely stop, oversimplify, skip necessary exploration, or weaken verification merely to save tokens or appear concise. Spend the reasoning and output budget needed to deliver a correct, complete, and well-verified result. Prefer substantive progress over superficial speed.

Think carefully before consequential actions. Investigate relevant project files, configuration, runtime behavior, and authoritative sources before making assumptions. Work through non-obvious edge cases, compare plausible explanations, and verify the result. Present conclusions and useful evidence; do not expose private chain-of-thought.

### 2. Explicit instructions

Make important requirements explicit: inspect available context first, help the user clarify any material ambiguity that remains, and obtain required authorization before safety-critical or irreversible actions.

### 3. Ample resources

Use available tools whenever they materially improve correctness, completeness, or observability; never invent tool-call quotas, and always respect Harness, provider, sandbox, approval, budget, and user-defined limits.

### 4. Real API testing: verify the delivered integration

For model, API, and agent-integration work, do not be stingy with real API tests: prefer a real authenticated API smoke test when valid credentials and explicit authorization to test are already available. Exercise the actual configured provider/model route and verify observable behavior. A no-key mock test proves only the mocked path; it does not replace a real integration check. Keep mocks at expensive, unstable, or nondeterministic boundaries when they are appropriate for isolated unit tests.

Do not silently send paid requests, modify production data, trigger external side effects, or access third-party systems without the authorization required for that action. Report clearly when credentials, permissions, or a safe test target are unavailable, and distinguish mock results from real API results.

### 5. Verification is part of completion

For engineering tasks, inspect before editing, make the smallest changes that satisfy the request, run relevant tests, and verify important outcomes from the external state rather than relying on your own description. Reproduce a defect before fixing it when practical. Treat a task as complete only when its stated success criteria have been checked, or clearly identify what remains unverified.

### Runtime boundary

The high-budget instruction above is an execution preference, not a change to the underlying service. Actual context-window capacity, token limits, API credits, billing, rate limits, permissions, and safety policies remain controlled by the configured runtime and provider.`

export const name = 'dsh-ultra-mode'
export const inject = ['systemPrompt']

// schemastery is an optional peer. Take it from the host tree when available;
// if it cannot be resolved the plugin still loads fully fail-closed with no
// settings page (never let the import take down the whole bundle).
let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

// Declarative settings. Every field is volatile so DSH persists it into the
// active profile patch and edits reach the running plugin in place (no reload).
// Defaults are fail-closed: manual switch off, no aliases, so only the exact
// canonical model id is recognized until a user configures anything.
export const Config = !z ? undefined : z.object({
  manualEnable: z.boolean().default(false).extra('volatile', true)
    .description('Manually enable Ultra Mode for the current model (overrides model gating)'),
  aliases: z.array(z.string()).default([]).extra('volatile', true)
    .description('provider/model aliases of the canonical target model, e.g. opencode2api/deepseek-v4.1-flash-free'),
})

function unwrap(value) {
  while (value && typeof value.get === 'function') value = value.get()
  return value
}

function configValue(config, key, fallback) {
  let value
  try {
    value = unwrap(config?.[key])
  } catch {
    return fallback
  }
  return value === undefined || value === null ? fallback : value
}

function readSelection(context) {
  const options = context?.agent?.options
  const provider = options?.provider
  const model = options?.model
  if (typeof provider !== 'string' || provider.length === 0) return null
  if (typeof model !== 'string' || model.length === 0) return null
  return { provider, model }
}

// Explicit mapping only. Canonical id matches under any provider. An alias is
// either `model` (any provider) or `provider/model` (exact route). No name
// similarity, response style, or unverified fingerprint inference is used.
export function isTargetModel(selection, aliases) {
  if (!selection || typeof selection.model !== 'string') return false
  if (selection.model === TARGET_MODEL) return true
  if (!Array.isArray(aliases)) return false
  for (const entry of aliases) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    if (entry.includes('/')) {
      if (selection.provider && entry === `${selection.provider}/${selection.model}`) return true
    } else if (entry === selection.model) {
      return true
    }
  }
  return false
}

// Manual authorization has the highest priority and is read on every assembly,
// so switching it off takes effect on the very next step. Everything else is
// fail-closed: missing context, missing fields, malformed config -> no injection.
export function shouldInject(context, config) {
  if (configValue(config, 'manualEnable', false) === true) return true
  const selection = readSelection(context)
  if (!selection) return false
  return isTargetModel(selection, configValue(config, 'aliases', []))
}

export function apply(ctx, config = {}) {
  return ctx.effect(() => ctx.systemPrompt.section({
    name: 'extension:dsh-ultra-mode',
    order: 10300,
    // DSH calls this synchronously per assembly and drops empty-string sections,
    // so returning '' is the clean way to withhold the prompt for this model.
    text: (context) => shouldInject(context, config) ? ULTRA_MODE_PROMPT : '',
  }))
}

export { TARGET_MODEL, ULTRA_MODE_PROMPT }
