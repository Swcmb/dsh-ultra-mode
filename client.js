/**
 * dsh-ultra-mode — browser half.
 *
 * Adds a single "manual enable" toggle to Settings. It edits the volatile
 * `manualEnable` field of this plugin's host Config through configForms, which
 * persists it to the active profile patch and reaches the running plugin in
 * place (no reload). Everything else about model gating lives in index.js.
 *
 * Only the frozen `react` module is required; the toggle is plain DOM so no
 * private UI-primitive package is needed. Registration is wrapped in
 * whileServed so the page vanishes if the host plugin is not composed.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ultra-mode',
  factory: (require) => {
    const React = require('react')
    const NS = 'dsh-ultra-mode'

    function SettingsCard(props) {
      const form = props.form
      const snap = form ? form.getSnapshot() : null
      const value = snap?.status === 'ready' && snap.value && typeof snap.value === 'object'
        ? snap.value
        : {}
      const enabled = value.manualEnable === true
      const writable = snap?.writable === true
      const busy = props.busy === true

      const onChange = (event) => {
        if (!form || busy) return
        form.set('manualEnable', event.target.checked === true)
      }

      return React.createElement(
        'div',
        { className: 'dsh-ultra-mode-settings', style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0' } },
        React.createElement(
          'label',
          { htmlFor: 'dsh-ultra-mode-manual-enable' },
          'Manually enable Ultra Mode for the current model'
        ),
        React.createElement('input', {
          id: 'dsh-ultra-mode-manual-enable',
          type: 'checkbox',
          role: 'switch',
          checked: enabled,
          disabled: !writable || busy,
          onChange,
        }),
        React.createElement(
          'p',
          { style: { margin: '4px 0 0', opacity: 0.7 } },
          'Override model detection. When on, Ultra Mode applies to the current model even if it is not the target. Turn it off to restore model gating immediately.'
        )
      )
    }

    function apply(ctx) {
      const form = ctx.configForms.get(NS)
      const off = ctx.configForms.whileServed([NS], () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-ultra-mode',
              order: 90,
              label: () => 'DSH Ultra Mode',
            },
            () => React.createElement(SettingsCard, { form })
          )
        )
      )
      ctx.effect(() => () => off?.())
    }

    return { name: 'dsh-ultra-mode', inject: ['configForms', 'slots'], apply }
  },
})
