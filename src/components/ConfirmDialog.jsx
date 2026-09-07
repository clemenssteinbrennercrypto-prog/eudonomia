import { useEffect, useId, useRef } from 'react'

const backdropStyle = {
  position: 'fixed', inset: 0, zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24, background: 'rgba(5, 7, 12, 0.78)', backdropFilter: 'blur(4px)',
}

const dialogStyle = {
  width: 'min(420px, 100%)', padding: 24,
  border: '1px solid var(--line)', borderRadius: 16,
  background: 'var(--surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
}

const buttonStyle = {
  border: '1px solid var(--line)', borderRadius: 100, padding: '9px 20px',
  background: 'transparent', color: 'var(--text)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel = 'Working…',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const previousFocus = typeof document !== 'undefined' ? document.activeElement : null
    cancelRef.current?.focus()
    return () => previousFocus?.focus?.()
  }, [])

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) onCancel()
      return
    }
    if (event.key !== 'Tab') return

    // Keep keyboard users inside the modal while it is open. The dialog only
    // has two controls today, but querying makes this safe if a future error
    // state adds a retry link or another action.
    const dialog = event.currentTarget
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div style={backdropStyle} onKeyDown={handleKeyDown}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        style={dialogStyle}
      >
        <h2 id={titleId} style={{ margin: 0, color: 'var(--text)', fontSize: 20 }}>{title}</h2>
        <p id={descriptionId} style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
          {description}
        </p>
        {error && (
          <p role="alert" style={{ margin: '12px 0 0', color: 'var(--bad)', fontSize: 13, lineHeight: 1.5 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            style={{ ...buttonStyle, opacity: busy ? 0.55 : 1, cursor: busy ? 'default' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{ ...buttonStyle, border: 'none', background: 'var(--bad)', color: '#fff', opacity: busy ? 0.7 : 1, cursor: busy ? 'default' : 'pointer' }}
          >
            {busy ? pendingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
