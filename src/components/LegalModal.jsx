import { useState } from 'react'

const navy = 'var(--ultra)'

// TODO(legal): § 5 ECG verlangt die GEOGRAFISCHE Anschrift — Straße, Hausnummer
// und PLZ. "Wien, Österreich" erfüllt das nicht, und es ist der am häufigsten
// abgemahnte Einzelpunkt überhaupt, weil er trivial nachprüfbar ist. Eine
// Ausnahme für Einzelunternehmer gibt es nicht: ohne andere Niederlassung muss
// die Wohnadresse hier stehen. Vor dem Launch ausfüllen.
const IMPRESSUM = [
  {
    heading: 'Angaben gemäß § 5 ECG',
    body: `Name: Clemens Steinbrenner
Adresse: Wien, Österreich
E-Mail: clemenssteinbrenner.crypto@gmail.com`,
  },
  {
    heading: 'Haftungsausschluss',
    body: `Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte wird keine Gewähr übernommen.`,
  },
]

// Diese Erklärung beschreibt, was der Code TATSÄCHLICH tut. Sie stand einmal auf
// "verlassen Ihr Gerät nicht" — während die App beim Start und danach alle fünf
// Minuten GitHub nach Updates fragt und dabei die IP-Adresse in die USA
// überträgt. Eine zu weit gefasste Zusage ist schlimmer als eine ausführliche
// Erklärung: sie ist widerlegbar, und sie ist zugleich das Marketingversprechen.
//
// Wer hier etwas ändert: erst prüfen, ob der Code es noch hergibt.
//   Update-Intervall      src/lib/useUpdateAvailable.js  (CHECK_INTERVAL_MS)
//   Cloud-Anbieter        src/lib/intentContract.js      (cloudProvider)
//   Standard = aus        src/lib/storage.js             (CONTRACT_DEFAULTS)
//   Nur Metadaten         companion/src-tauri/src/output.rs
const DATENSCHUTZ = [
  {
    heading: 'Verantwortlicher',
    body: `Clemens Steinbrenner, Wien, Österreich (siehe Impressum)`,
  },
  {
    heading: 'Grundsatz',
    body: `Eudaimonia betreibt keinen Server und kein Nutzerkonto. Ihre Sitzungsdaten werden ausschließlich auf Ihrem Gerät verarbeitet und gespeichert. Zwei Ausnahmen gibt es — die Update-Prüfung und ein optionales Sprachmodell. Beide sind unten einzeln beschrieben.`,
  },
  {
    heading: 'Kamera',
    body: `Die Kamera dient ausschließlich der Aufmerksamkeitsanalyse auf Ihrem Gerät. Es werden keine Video- oder Bilddaten gespeichert, gepuffert oder übertragen. Die Analyse läuft lokal mit MediaPipe; aus dem Kamerabild werden nur Messwerte wie Lidöffnung, Blinzelrate und Kopfhaltung abgeleitet, und auch diese verlassen das Gerät nicht.

Gesichtsmerkmale werden NICHT zur Identifizierung von Personen verarbeitet. Es findet kein Gesichtsabgleich und keine Wiedererkennung statt. Damit handelt es sich nicht um biometrische Daten im Sinne von Art. 9 DSGVO, der nur die Verarbeitung zum Zweck der eindeutigen Identifizierung erfasst.`,
  },
  {
    heading: 'Lokale Speicherung',
    body: `Auf Ihrem Gerät gespeichert werden (localStorage):
– Sitzungsstatistiken: Dauer, Fokus-Score, Ablenkungsereignisse, Zeitverlauf
– Namen der während der Sitzung aktiven Apps und Websites
– Ihr eingegebenes Ziel sowie Namen bearbeiteter Dateien, falls Sie die Fortschrittsmessung nutzen
– Workspace-Konfiguration, Blockierlisten, Onboarding-Status

Sie können alles jederzeit über History → Clear all oder Ihre Browser-Einstellungen löschen.`,
  },
  {
    heading: 'Companion-App (macOS)',
    body: `Während einer Sitzung fragt die Companion-App alle drei Sekunden ab, welche App im Vordergrund ist, und bei Browsern die Adresse des aktiven Tabs. Das dient dem Blockieren und der Ablenkungserkennung und bleibt im Arbeitsspeicher.

Wenn Sie einen Projektordner für die Fortschrittsmessung auswählen, werden ausschließlich Metadaten gelesen: Dateinamen, Größen, Änderungszeitpunkte und Git-Zähler. Dateiinhalte werden nie geöffnet oder gelesen, Tastatureingaben nie aufgezeichnet.`,
  },
  {
    heading: 'Update-Prüfung (verlässt das Gerät)',
    body: `Die App fragt beim Start und anschließend alle fünf Minuten bei GitHub an, ob eine neuere signierte Version vorliegt. Dabei werden technisch bedingt Ihre IP-Adresse und die installierte Versionsnummer an GitHub Inc. (Microsoft Corporation, USA) übermittelt.

Es werden dabei keine Sitzungs-, Kamera- oder Aktivitätsdaten übertragen. Rechtsgrundlage ist unser berechtigtes Interesse an sicheren und aktuellen Installationen (Art. 6 Abs. 1 lit. f DSGVO).`,
  },
  {
    heading: 'Zielverständnis per Sprachmodell (optional)',
    body: `Standardmäßig ausgeschaltet. Die Voreinstellung arbeitet mit lokalen Stichwortprofilen und ohne jede Netzwerkverbindung.

Schalten Sie unter Focus Apps auf "Lokal", läuft ein Modell über Ollama auf Ihrem Gerät — es wird nichts übertragen.

Schalten Sie auf "Cloud", wird ausschließlich der von Ihnen eingegebene Zielsatz an Anthropic (USA) übermittelt. Nicht übertragen werden Aktivitätsprotokolle, Fenstertitel und Dateinamen. Rechtsgrundlage ist Ihre Einwilligung durch das aktive Umschalten (Art. 6 Abs. 1 lit. a DSGVO); Sie können sie jederzeit widerrufen, indem Sie zurückschalten.`,
  },
  {
    heading: 'Cookies',
    body: `Es werden keine Cookies gesetzt und kein Analyse- oder Tracking-Dienst eingebunden. Der verwendete localStorage dient ausschließlich der von Ihnen angeforderten Funktion und ist damit nicht einwilligungsbedürftig.`,
  },
  {
    heading: 'Ihre Rechte',
    body: `Ihnen stehen die Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch zu, ebenso ein Beschwerderecht bei der Österreichischen Datenschutzbehörde.

In der Praxis liegen Ihre Daten ausschließlich bei Ihnen: Wir speichern keine Sitzungsdaten und können Sie anhand einer Update-Anfrage nicht identifizieren, weshalb wir Auskunfts- oder Löschbegehren dazu nicht zuordnen können (Art. 11 DSGVO). Ihre lokalen Daten löschen Sie selbst über History → Clear all.`,
  },
  {
    heading: 'Kontakt',
    body: `Bei Fragen: clemenssteinbrenner.crypto@gmail.com`,
  },
]

function Section({ heading, body }) {
  return (
    <div>
      <p style={{
        fontSize: 13, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.07em',
        color: 'var(--text-muted)', marginTop: 28, marginBottom: 8,
      }}>
        {heading}
      </p>
      <p style={{
        fontSize: 15, lineHeight: 1.7, color: 'var(--text)',
        whiteSpace: 'pre-line',
      }}>
        {body}
      </p>
    </div>
  )
}

export default function LegalModal({ open, onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab ?? 'impressum')

  if (!open) return null
  // Sync active tab whenever the modal is reopened with a different initialTab
  if (tab !== initialTab && initialTab) {
    setTab(initialTab)
  }

  const sections = tab === 'impressum' ? IMPRESSUM : DATENSCHUTZ

  return (
    <div
      className="legal-modal-enter"
      style={{
        position: 'fixed', inset: 0,
        background: 'var(--bg)',
        overflowY: 'auto',
        zIndex: 400,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.022em', color: 'var(--text)', margin: 0 }}>
            {tab === 'impressum' ? 'Impressum' : 'Datenschutz'}
          </h1>
          <button
            onClick={onClose}
            style={{
              padding: '9px 22px', fontSize: 14, fontWeight: 600,
              background: navy, color: 'var(--text)',
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
                border:     tab === t.id ? 'none' : '1px solid var(--line)',
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
