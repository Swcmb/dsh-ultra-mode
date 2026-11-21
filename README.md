# DSH Ultra Mode

A DeepSeek Harness (DSH) bundle that injects a high-budget Ultra-mode system prompt — **only for one specific model**. It does not apply to every agent scope.

The canonical target is `deepseek-v4-1-flash-261017`. A request gets the Ultra prompt only when the model DSH is actually using for that request matches this id or one of its explicitly configured aliases. Everything else fails closed: no match, no prompt. A user-controlled manual switch can override the gate for the current model.

The bundle is a prompt-layer plugin only. It never changes the provider, model, reasoning effort, context window, token ceiling, API quota, billing, rate limits, permissions, sandboxing, approval gates, or safety policies.

## Scope: which model gets the prompt

Ultra Mode is injected when **either** condition holds:

1. **Model gating (automatic)** — the request's model id equals the canonical target `deepseek-v4-1-flash-261017` (under any provider), or equals an entry in the configured `aliases` list.
2. **Manual authorization** — the `manualEnable` switch is on. This has the highest priority and enables Ultra Mode for the current model regardless of what it is.

Otherwise the plugin contributes an empty section, which DSH drops at render time. No prompt is injected.

The current model is read from the running request itself (`context.agent.options.provider` / `.model` in the system-prompt assembly context). The decision is re-evaluated on every assembly, so turning the switch off takes effect on the very next step — no reload required.

### Identification is explicit, never inferred

DSH and its gateway do not expose a "real upstream model id" field. A proxy can serve `deepseek-v4-1-flash-261017` under a different public id, and the data available to a plugin cannot prove the two are the same. This bundle therefore does **not** guess identity:

- No model-name similarity matching.
- No response-style or behavior probing.
- No unverified fingerprint inference (context window, reasoning efforts, price).

Only the exact canonical id and aliases you declare count. Two consequences worth stating plainly:

- `hy4-flash-free` is **not** treated as the target by default. It is the current profile default in one known setup, but nothing in DSH data proves it is `deepseek-v4-1-flash-261017`. Add it as an alias only if you have a reliable basis.
- `deepseek-v4.1-flash-free` is also not auto-recognized — the similar name is not evidence.

If you want Ultra Mode on a model that is not the canonical target, use the manual switch rather than a guessed alias.

## Settings

Two volatile settings are persisted into the active profile patch:

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `manualEnable` | boolean | `false` | When on, enables Ultra Mode for the current model and overrides model gating. Off restores the gate immediately. |
| `aliases` | string[] | `[]` | Provider/model aliases of the canonical target model. A hit injects the prompt automatically. |

The `manualEnable` switch appears in **two places, both the same setting**:

- A compact **⚡ Ultra ON/OFF** chip in the composer tool row (next to Auto-Continue). Click it to flip manual authorization without opening Settings. Styled like the other DSH tool-row chips: 24px pill, green when ON, subtle hover background when OFF.
- A checkbox under Settings → **DSH Ultra Mode**.

Both read and write the same volatile field through `configForms`, so they stay in sync with each other and with the running plugin instantly — no reload. `aliases` is configured only from the Settings page.

`aliases` entries accept two forms:

- `model` — matches that model id under any provider (e.g. `deepseek-v4.1-flash-free`).
- `provider/model` — matches only that exact route (e.g. `opencode2api/deepseek-v4.1-flash-free`).

If `@deepseek-ai/schemastery` is unavailable, the plugin still loads fully fail-closed; it simply has no editable settings page.

## Fail-closed behavior

The gate is deliberately conservative. Ultra Mode is withheld when any of the following is true:

- the request context has no agent or no model/provider fields;
- the model matches neither the canonical id nor a declared alias;
- `manualEnable` is not strictly boolean `true` (strings, numbers, and missing values do not enable it);
- config values are missing or malformed (only the canonical id can still match).

The only way to inject on a non-target model is an explicit `manualEnable: true`.

## Install

Install the bundle from the DSH Web **Plugins** manager using the `.tgz` package built from this folder. The bundle is enabled when added; HMR-enabled profiles apply it immediately, others require a restart.

For a local source folder, use the Plugins manager's external-bundle install flow. The bundle manifest is `package.json`; the plugin entry list is `cordis.patch.yml`; the browser toggle is `client.js`. The patch row id (`dsh-ultra-mode`) matches the settings namespace, so the settings page binds to the correct entry.

## What the prompt does

When injected, the Ultra prompt instructs the agent to:

- treat the token budget as high — no premature stopping, oversimplifying, or weakened verification to save tokens;
- make key requirements explicit, inspect context first, clarify material ambiguity, and get authorization for high-risk actions;
- use tools when they genuinely help, without inventing quotas or bypassing Harness, provider, sandbox, approval, budget, or user-defined limits;
- prefer a real authenticated API smoke test when valid credentials and authorization already exist, and distinguish mocks from real calls;
- treat verification as part of completion and report honestly what remains unverified.

The prompt is registered through `ctx.systemPrompt.section()` with a per-assembly `text` callback and attached to the plugin lifecycle via `ctx.effect()`. Disabling or unloading the plugin withdraws the section.

## Verify

Run from this directory:

```bash
npm test
```

The smoke test uses a minimal Cordis-shaped context and covers: canonical-id hit, bare and `provider/model` alias hits, alias/provider mismatch, unknown and similar-name models, `hy4-flash-free` not auto-recognized, missing/malformed fields and config, manual override (on/off and immediate re-gating), volatile config references, dynamic `text()` results, and lifecycle cleanup. It does not require schemastery or a running DSH host.

To verify in a live profile: install the bundle, open Settings → **DSH Ultra Mode**, and confirm the toggle appears. With `manualEnable` off, a canonical/alias model receives the Ultra prompt and an unknown model does not; turning the switch on makes the current model receive it; turning it off removes it on the next step.

## License

MIT — see [LICENSE](LICENSE).
