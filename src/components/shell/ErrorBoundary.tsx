/**
 * A boundary that keeps one broken screen from blanking the window.
 *
 * A desktop app has no address bar and no reload button, so an uncaught render error is a
 * dead window. Each boundary offers the two things a reader can actually do: try the surface
 * again, or reload the application. The error is logged with its component stack so it can be
 * reported instead of guessed at.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

import { Button } from '@/components/ui';
import { logError } from '@/lib/log';

interface Props {
  children: ReactNode;
  /** Replaces the default copy: what this boundary wraps. */
  label?: string;
  /** Called after the reader chooses to try again, before the children re-render. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only record of what happened once the fallback replaces the tree.
    void logError('render', error, { componentStack: info.componentStack });
    console.error('openlab could not render this surface', error, info.componentStack);
  }

  private reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid h-full min-h-0 place-items-center p-8" role="alert">
        <div className="max-w-md text-center">
          <CircleAlert className="mx-auto size-6 text-danger" aria-hidden />
          <h1 className="mt-3 text-title text-foreground">
            {this.props.label ?? 'This surface could not be drawn'}
          </h1>
          <p className="mt-2 text-body text-muted">
            The rest of the workbench is still running. Trying again re-renders this surface; reloading
            restarts the window.
          </p>
          <p className="mt-3 truncate font-mono text-meta text-danger" title={error.message}>
            {error.message}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onPress={this.reset}>
              Try again
            </Button>
            <Button onPress={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      </div>
    );
  }
}
