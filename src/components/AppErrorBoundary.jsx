import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Anka OS render failure', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <section className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-7 text-center shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-400">Anka OS</p>
          <h1 className="mt-3 text-2xl font-semibold">The workspace needs a refresh</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            A newer application version may have been deployed while this browser tab was open.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold hover:bg-purple-500"
          >
            Reload Anka OS
          </button>
        </section>
      </main>
    )
  }
}

