/**
 * dsh-ultra-mode — browser half.
 *
 * Two controls for the same volatile `manualEnable` host setting:
 *   - conversation.input.left — a compact ON/OFF chip in the composer tool row
 *   - settings.section        — the "DSH Ultra Mode" page under Settings
 *
 * Both read and write through configForms, so they stay in sync with each other
 * and with the running host plugin without a reload. Mirror the registration
 * and chip styling used by other DSH plugins (dsh-auto-continue, interim).
 */
window.__ModuleLoader__.load({
  id: 'dsh-ultra-mode',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React
    const NS = 'dsh-ultra-mode'
    const EASE = 'cubic-bezier(0.25, 1, 0.5, 1)'
    const FAST = '0.15s'

    const zh = {
      title: 'DSH Ultra 模式',
      manualEnable: '手动启用 Ultra 模式',
      hint: '覆盖模型检测：开启后当前模型即使不是目标模型也会使用 Ultra 模式；关闭后立即恢复模型门控。底部工具栏的 Ultra 开关与此处的开关是同一个。',
    }
    const en = {
      title: 'DSH Ultra Mode',
      manualEnable: 'Manually enable Ultra Mode',
      hint: 'Override model detection. When on, Ultra Mode applies to the current model even if it is not the target. Turn it off to restore model gating immediately. The Ultra chip in the composer tool row is the same switch.',
    }

    function readEnabled(snap) {
      const ready = snap?.status === 'ready' && snap.value && typeof snap.value === 'object'
      return ready ? snap.value.manualEnable === true : false
    }

    function useManual(form) {
      const [snap, setSnap] = useState(() => form?.getSnapshot())
      useEffect(() => {
        if (!form) return
        setSnap(form.getSnapshot())
        return form.subscribe(() => setSnap(form.getSnapshot()))
      }, [form])
      const enabled = readEnabled(snap)
      const writable = snap?.writable === true
      const toggle = (next) => { if (form && writable) form.set('manualEnable', next) }
      return [enabled, writable, toggle]
    }

    function useHover() {
      const [hover, setHover] = useState(false)
      return [hover, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }]
    }

    // ── composer chip: kind:'list' slot, shares the seat with other plugins ──
    function ComposerChip({ form, t }) {
      const [enabled, writable, toggle] = useManual(form)
      const [hover, hoverProps] = useHover()
      const on = enabled
      const spoken = on ? 'Ultra Mode is ON' : 'Ultra Mode is OFF'
      return h('button', {
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': spoken + (on ? ' — click to turn it off.' : ' — click to turn it on.'),
        title: on
          ? 'Ultra Mode is ON for the current model (manual override). Click to turn it off.'
          : 'Ultra Mode follows model gating. Click to force it ON for the current model.',
        disabled: !writable,
        onClick: () => toggle(!on),
        ...hoverProps,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          alignSelf: 'center', flex: '0 0 auto',
          height: 24, padding: '0 9px', margin: 0,
          fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
          minWidth: 0, maxWidth: '100%',
          borderRadius: 'var(--dsw-radius-sm, 8px)',
          border: '1px solid ' + (on
            ? 'var(--dsw-alias-state-success-secondary, #4ed17e)'
            : 'var(--dsw-alias-border-l2, #0000001a)'),
          background: on
            ? 'var(--dsw-alias-state-success-tertiary, #e6faed)'
            : (hover ? 'var(--dsw-alias-interactive-bg-hover, #2631480f)' : 'transparent'),
          color: on
            ? 'var(--dsw-alias-label-primary, #0f1115)'
            : 'var(--dsw-alias-label-secondary, #61666b)',
          cursor: writable ? 'pointer' : 'default', userSelect: 'none',
          transition: 'background ' + FAST + ' ' + EASE + ', border-color ' + FAST + ' ' + EASE,
        },
      },
        h('span', { 'aria-hidden': 'true', style: { fontSize: 13, lineHeight: 1 } }, '⚡'),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'Ultra'),
        h('span', { style: { fontWeight: 600 } }, on ? 'ON' : 'OFF')
      )
    }

    // ── settings page ─────────────────────────────────────────────────────
    function SettingsCard({ form, t }) {
      const [enabled, writable, toggle] = useManual(form)
      return h('div', { className: 'dsh-ultra-mode-settings' },
        h('label', null, t('manualEnable')),
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: enabled,
          disabled: !writable,
          onChange: (e) => toggle(e.target.checked === true),
        }),
        h('p', null, t('hint'))
      )
    }

    function contribute(ctx, key, options, Component, what) {
      const fail = (e) => console.error('[dsh-ultra-mode] could not register ' + what + ':', e)
      try {
        return ctx.slots.inject(key, () => {
          try { return ctx.slots.register(options, Component) }
          catch (e) { fail(e); return () => {} }
        })
      } catch (e) { fail(e); return () => {} }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ultra-mode: dictionaries')
      const form = ctx.configForms.get(NS)
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () => contribute(ctx, 'conversation.input.left',
          { name: 'conversation.input.left', id: 'ultra-mode' },
          () => h(ComposerChip, { form, t }), 'composer chip'),
        'dsh-ultra-mode: composer chip'
      )
      ctx.effect(
        () => contribute(ctx, 'settings.section',
          { name: 'settings.section', id: 'dsh-ultra-mode', order: 90, label: () => t('title'), locale: NS },
          () => h(SettingsCard, { form, t }), 'settings section'),
        'dsh-ultra-mode: settings section'
      )
    }

    return { name: 'dsh-ultra-mode', inject: ['slots', 'locale', 'configForms'], apply }
  },
})
