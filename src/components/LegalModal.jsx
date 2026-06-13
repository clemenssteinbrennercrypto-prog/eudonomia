import { useState } from 'react'

const navy = '#1a2e4a'

const IMPRESSUM = [
  {
    heading: 'Angaben gemäß § 5 ECG',
    body: `Name: [Vorname Nachname]
Adresse: [Straße, PLZ Ort, Österreich]
E-Mail: [email@example.com]`,
  },
  {
    heading: 'Haftungsausschluss',
    body: `Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte wird keine Gewähr übernommen.`,
  },
]

const DATENSCHUTZ = [
  {
    heading: 'Verantwortlicher',
    body: `[Vorname Nachname], [Adresse] (siehe Impressum)`,
  },
  {
    heading: 'Welche Daten wir verarbeiten',
    body: `Eudaimonia verarbeitet keine personenbezogenen Daten auf einem Server. Alle Daten (Sitzungsstatistiken) werden ausschließlich lokal in Ihrem Browser gespeichert (localStorage) und verlassen Ihr Gerät nicht.`,
  },
  {
    heading: 'Kamera',
    body: `Die Kamera wird ausschließlich zur lokalen Aufmerksamkeitsanalyse verwendet. Es werden keine Video- oder Bilddaten gespeichert oder übertragen. Die Verarbeitung erfolgt vollständig im Browser mittels MediaPipe.`,
  },
  {
    heading: 'Lokale Speicherung',
    body: `Wir speichern folgende Daten in Ihrem Browser (localStorage):\n– Sitzungsstatistiken (Dauer, Fokus-Score, Ablenkungsereignisse)\n– Workspace-Konfiguration\n– Onboarding-Status\n\nSie können diese Daten jederzeit über die Browser-Einstellungen löschen.`,
  },
  {
    heading: 'Ihre Rechte',
    body: `Da keine Daten auf unseren Servern gespeichert werden, entfallen Auskunfts-, Lösch- und Übertragungsanfragen an uns. Für lokale Daten nutzen Sie bitte die Löschfunktion in der App (History → Clear all) oder Ihre Browser-Einstellungen.`,
  },
  {
    heading: 'Kontakt',
    body: `Bei Fragen: [email@example.com]`,
  },
]

function Section({ heading, body }) {
  return (
    <div>
      <p style={{
        fontSize: 13, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em',
        color: '#9CA3AF', marginTop: 28, marginBottom: 8,
      }}>
        {heading}
      </p>
      <p style={{
        fontSize: 15, lineHeight: 1.7, color: '#1A1A1A',
        whiteSpace: 'pre-line',
      }}>
        {body}
      </p>
    </div>
  )
}

export default function LegalModal({ open, onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab ?? 'impressum')

  // Sync tab when initialTab changes (e.g. user clicks Impressum then Datenschutz)
  if (!open) return null

  const sections = tab === 'impressum' ? IMPRESSUM : DATENSCHUTZ

  return (
    <div
      className="legal-modal-enter"
      style={{
        position: 'fixed', inset: 0,
        background: '#F5F4F0',
        overflowY: 'auto',
        zIndex: 400,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.022em', color: '#0f172a', margin: 0 }}>
            {tab === 'impressum' ? 'Impressum' : 'Datenschutz'}
          </h1>
          <button
            onClick={onClose}
            style={{
              padding: '9px 22px', fontSize: 14, fontWeight: 600,
              background: navy, color: '#fff',
              border: 'none', borderRadius: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
          {[
            { id: 'impressum',   label: 'Impressum'   },
            { id: 'datenschutz', label: 'Datenschutz' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600,
                borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                background: tab === t.id ? navy : 'transparent',
                color:      tab === t.id ? '#fff' : '#6B7280',
                border:     tab === t.id ? 'none' : '1px solid #E8E3DA',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div>
          {sections.map((s, i) => (
            <Section key={i} heading={s.heading} body={s.body} />
          ))}
        </div>

      </div>
    </div>
  )
}
