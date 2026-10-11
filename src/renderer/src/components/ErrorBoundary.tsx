import React from 'react'

type State = { error: Error | null }

/** Arayüzde beklenmeyen bir hata olursa boş ekran yerine hatayı ve kurtarma düğmesini gösterir. */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[arayüz hatası]', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="home">
        <div className="home__card">
          <h1>Beklenmeyen bir hata oluştu</h1>
          <p className="error">{this.state.error.message}</p>
          <button className="btn btn--primary btn--lg" onClick={() => this.setState({ error: null })}>
            Devam et
          </button>
        </div>
      </div>
    )
  }
}
