import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: '#0D0F14',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, padding: 32, textAlign: 'center',
        }}>
          <p style={{ fontSize: 22, fontWeight: 300, color: '#ffffff', margin: 0 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0, maxWidth: 360 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '10px 28px',
              background: '#1C1F28',
              border: '1px solid #2A2E3A',
              borderRadius: 100,
              fontSize: 14, fontWeight: 600,
              color: '#e2e8f0',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
