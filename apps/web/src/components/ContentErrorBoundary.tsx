import { Component, type ReactNode } from 'react';

import { logger } from '../lib/logger';

const log = logger.child({ module: 'ContentErrorBoundary' });

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ContentErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    log.error({ error, componentStack: info.componentStack }, 'ContentErrorBoundary caught render error');
  }

  override render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="p-8 max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-xl">
          <h2 className="text-lg font-bold text-red-800 mb-2">Erreur d&apos;affichage</h2>
          <pre className="text-sm text-red-700 whitespace-pre-wrap break-words overflow-auto max-h-96">
            {this.state.error.message}
          </pre>
          <p className="text-xs text-gray-600 mt-2">
            Vérifiez la console (F12) pour plus de détails.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
