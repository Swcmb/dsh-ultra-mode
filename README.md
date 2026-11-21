# DeepSeek Harness Apex Mode

Apex is a **virtual top reasoning tier** for DeepSeek Harness (DSH). It is not a new official reasoning effort and not a manual toggle. Selecting Apex in the model selector means:

$$
\text{Apex} = \text{current model's highest official reasoning effort} + \text{Apex high-budget prompt}
$$

The canonical target is `deepseek-v4-1-flash-261017`. The Apex prompt is injected only when the session was switched to Apex **and** the request resolves to the target model (or a configured alias). Everything else fails closed.

- Display: **Apex** / 巅峰模式 — the highest execution tier (最高执行等级)
- Full name: **DeepSeek Harness Apex Mode**
- Internal id: `apex`
- Position: a virtual option at the top of the model's reasoning-effort list

## What Apex actually does

| User picks | Upstream reasoning effort | Apex prompt |
| --- | --- | --- |
| Any official tier (Off/Low/High/Max/…) | that official tier | not injected |
| **Apex** | the model's highest **official** tier (max → xhigh → high → medium → low) | injected |

Apex never sends the literal string `apex` upstream — DSH's effort validation would reject it. It sends a real official effort and marks the session Apex-active through a separate state channel. The prompt is injected only for that session, and only for the target model.

If a model declares no reasoning efforts, Apex cannot resolve a highest tier and cannot be chosen — no fake capabilities.

## No settings, no toggle

There is no settings page, no composer chip, and no `manualEnable` flag. The only user control is the **Apex** option inside the model selector. Alias mapping lives in code or in the profile patch, not in a UI.

The Apex prompt tells the agent to treat the token budget as high, make requirements explicit, respect tool/approval limits, prefer a real authenticated API test when authorized, and verify important outcomes. It changes model-facing instructions only — never provider, model, reasoning effort, context window, token ceiling, quota, billing, permissions, sandboxing, approval gates, or safety policies.

## How it works

Three official DSH extension points, no DOM hacking and no core changes:

1. **UI** — the client takes over the `conversation.input.model` seat (`priority: -20`) and appends an Apex option above the model's native efforts. Third-party plugins cannot use the official `directoryFor()`, so the client builds a small directory store over the public `remote.session.modelCatalog()` / `selectModel()` RPC — the same proven approach as `dsh-ultra-slider`.
2. **State** — choosing Apex POSTs `{ sessionId, active }` to the host's local `/dsh-apex/state` route. The host stores Apex-active sessions in the profile's `storageDomain`, separate from `reasoningEffort`. The write is guarded by a custom header and a same-origin check; reads are side-effect free.
3. **Injection** — the host registers `ctx.systemPrompt.section()` with a per-assembly `text` callback. It injects the prompt only when the assembly's session is Apex-active and the selected model matches the target. The host reads `context.modelSelection` (per-step authoritative) with `context.agent.options` as fallback. Empty sections are dropped by DSH.

## Aliases

The canonical id `deepseek-v4-1-flash-261017` always matches, under any provider. Extra aliases can be passed to `apply(ctx, config)` as `config.aliases` (also settable in the `cordis.patch.yml` row config):

- `model` — matches that id under any provider
- `provider/model` — matches only that exact route

`hy4-flash-free` and `deepseek-v4.1-flash-free` are **not** auto-recognized. DSH/gateway data has no real-upstream-model field, so identity is never inferred from name similarity, response style, or fingerprints. Add an alias only with a reliable basis, or rely on the target id.

## Install

Install the bundle from the DSH Web **Plugins** manager using the `.tgz` built from this folder, or select the source folder via the external-bundle flow. The bundle manifest is `package.json`; the plugin row is `cordis.patch.yml`; the browser half is `client.js`, exported as `./client` (required by DSH's client module loader). HMR-enabled profiles apply on refresh; others need a DSH restart.

## Verify

```bash
npm test
```

The smoke test covers metadata, canonical/alias matching, session-and-model gating, state-route activate/deactivate, untrusted-write rejection, dynamic `text()` results, and lifecycle cleanup. It needs no schemastery and no running DSH host.

In a live profile: open the model selector, switch to Apex, confirm the chip shows Apex and the request uses the model's highest official effort; switch back to a normal tier and confirm the Apex prompt is no longer injected.

## License

MIT — see [LICENSE](LICENSE).
