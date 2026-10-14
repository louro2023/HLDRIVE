import { Component } from 'react'
import { I18nContext } from '../lib/i18n.jsx'

// Without this, any render error in a view unmounts the whole app to a blank screen with no
// clue why. Class components can't use useI18n(), so it reads the context via contextType instead.
export default class ErrorBoundary extends Component {
  static contextType = I18nContext

  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[HLDRIVE] view crashed:', error, info)
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      const t = this.context?.t || ((key) => key)
      return (
        <div className="rounded-lg border border-err/40 bg-err/10 p-4 text-sm text-err">
          <div className="mb-1 font-semibold">{t('errorBoundary.title')}</div>
          <div className="font-mono text-xs opacity-80" dir="ltr">{String(this.state.error?.message || this.state.error)}</div>
        </div>
      )
    }
    return this.props.children
  }
}
