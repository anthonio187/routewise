import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so a single bad payload never blanks the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a breadcrumb in the console; no third-party telemetry is used.
    console.error('RouteWise UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <div className="card w-full p-6">
          <h1 className="text-lg font-bold text-ink-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-600">
            The interface hit an unexpected error. Your saved journeys are stored on this device and
            are not affected.
          </p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-xl bg-ink-50 p-3 text-left text-[11px] text-ink-500">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              Reload
            </button>
            <a className="btn-secondary" href="/">
              Go to planner
            </a>
          </div>
        </div>
      </div>
    );
  }
}
