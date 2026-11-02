import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button, Card } from './ui';

interface State {
  error: Error | null;
  reference: string | null;
}

/**
 * Last-resort boundary. It deliberately shows a reference, not the exception text: a stack trace is
 * not useful to a sender standing at a door, and it can carry values from the page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, reference: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, reference: crypto.randomUUID().slice(0, 8).toUpperCase() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only. Nothing is shipped to a third party from this build.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, reference } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg py-10">
        <Card>
          <h1 className="text-xl font-semibold text-ink-900">Something went wrong on our side</h1>
          <p className="mt-2 text-sm text-ink-700">
            The page stopped working. Reloading usually fixes it. If it keeps happening, contact support and quote
            the reference below.
          </p>
          <p className="mt-3 rounded-input bg-canvas px-3 py-2 font-mono text-sm text-ink-900">
            Reference {reference}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => window.location.assign('/')}>Go to the home page</Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
