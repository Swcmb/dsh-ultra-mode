/**
 * dsh-ultra-mode — browser half.
 *
 * Adds a "DSH Ultra Mode" section to Settings with a single manual-enable
 * toggle. It edits the volatile `manualEnable` field of this plugin's host
 * Config through configForms, which persists it to the active profile patch
 * and reaches the running plugin in place (no reload).
 *
 * Mirrors the registration pattern used by other DSH settings plugins:
 * inject slots/locale/configForms, register a locale namespace, and contribute
 * a `settings.section` slot. Only the frozen `react` module is required.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ultra-mode',
  factory: (require) => {
    const React = require('react')
    const NS = 'dsh-ultra-mode'

    const zh = {
      title: 'DSH Ultra 模式',
      manualEnable: '手动启用 Ultra 模式',
      hint: '覆盖模型检测：开启后当前模型即使不是目标模型也会使用 Ultra 模式；关闭后立即恢复模型门控。',
    }
    const en = {
      title: 'DSH Ultra Mode',
      manualEnable: 'Manually enable Ultra Mode',
      hint: 'Override model detection. When on, Ultra Mode applies to the current model even if it is not the target. Turn it off to restore model gating immediately.',
    }

    function SettingsCard({ form, t }) {
      const snap = form ? form.getSnapshot() : null
      const ready = snap?.status === 'ready' && snap.value && typeof snap.value === 'object'
      const value = ready ? snap.value : {}
      const enabled = value.manualEnable === true
      const writable = snap?.writable === true

      const onChange = (event) => {
        if (!form) return
        form.set('manualEnable', event.target.checked === true)
      }

      return React.createElement(
        'div',
        { className: 'dsh-ultra-mode-settings' },
        React.createElement('label', null, t('manualEnable')),
        React.createElement('input', {
          type: 'checkbox',
          role: 'switch',
          checked: enabled,
          disabled: !writable,
          onChange,
        }),
        React.createElement('p', null, t('hint'))
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ultra-mode: dictionaries')
      const form = ctx.configForms.get(NS)
      const t = ctx.locale.bind(NS)
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-ultra-mode',
              order: 90,
              label: () => t('title'),
              locale: NS,
            },
            () => React.createElement(SettingsCard, { form, t })
          )
        ),
        'dsh-ultra-mode: settings section'
      )
    }

    return { name: 'dsh-ultra-mode', inject: ['slots', 'locale', 'configForms'], apply }
  },
})
