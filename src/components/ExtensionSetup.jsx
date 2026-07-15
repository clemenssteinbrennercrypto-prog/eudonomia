export default function ExtensionSetup() {
  return (
    <section
      id="extension-setup"
      style={{
        background: '#fff',
        border: '1px solid #E8E3DA',
        borderRadius: 16,
        padding: '18px 20px',
        boxShadow: '0 2px 20px rgba(26,46,74,0.06)',
      }}
    >
      <h2 style={{ margin: 0, color: '#1a2e4a', fontSize: 18, fontWeight: 900, letterSpacing: 0 }}>
        Install Browser Extension
      </h2>
      <ol style={{ margin: '12px 0 0', paddingLeft: 22, color: '#5f6d7f', fontSize: 13, lineHeight: 1.7 }}>
        <li>Open Chrome and go to <strong>chrome://extensions</strong>.</li>
        <li>Enable <strong>Developer Mode</strong>.</li>
        <li>Click <strong>Load unpacked</strong>.</li>
        <li>Select the <strong>extension</strong> folder from this repo.</li>
        <li>Pin Eudonomia Focus Tracker to the toolbar.</li>
      </ol>
    </section>
  )
}
