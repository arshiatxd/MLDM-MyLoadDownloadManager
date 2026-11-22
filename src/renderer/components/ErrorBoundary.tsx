import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected interface error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('MyLoad UI error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex h-screen flex-col items-center justify-center bg-[var(--bg-canvas)] p-6 text-center text-[var(--text-primary)]">
          <div className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 shadow-xl">
            <h1 className="mb-2 text-lg font-semibold text-[var(--accent-text)]">
              MyLoad encountered an unexpected error
            </h1>
            <p className="mb-4 text-xs text-[var(--text-secondary)]">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Reload interface
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

