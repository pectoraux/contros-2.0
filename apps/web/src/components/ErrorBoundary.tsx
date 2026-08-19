/**
 * ErrorBoundary — catch render errors, show a safe user-facing message.
 * Never leaks stack traces / internal details. (Phase 2C.1 §17)
 */
import { Component, type ReactNode } from 'react'
import { styles } from '../styles'

interface State { hasError: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }
  static getDerivedStateFromError(): State { return { hasError: true } }
  render() {
    if (this.state.hasError) {
      return <div style={styles.error}>Something went wrong. Please reload the page.</div>
    }
    return this.props.children
  }
}
