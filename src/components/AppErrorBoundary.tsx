import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  language: 'hr' | 'en';
  resetKey: string;
  onReset: () => void;
}

interface State { error: Error | null; }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DravaInt module error', error, info);
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const hr = this.props.language === 'hr';
    return <section className="module-error-card" role="alert">
      <span className="module-error-mark">!</span>
      <div><span className="eyebrow">Safe recovery</span><h2>{hr ? 'Modul se nije mogao učitati' : 'This module could not be loaded'}</h2><p>{hr ? 'Ostatak aplikacije i spremljeni podaci su sigurni. Vratite se na nadzornu ploču ili ponovno učitajte ovu radnu stanicu.' : 'The rest of the app and your saved data are safe. Return to the dashboard or reload this workstation.'}</p><details><summary>{hr ? 'Tehnički detalji' : 'Technical details'}</summary><code>{this.state.error.message}</code></details><div><button className="btn btn-blue" onClick={() => { this.setState({ error: null }); this.props.onReset(); }}>{hr ? 'Nadzorna ploča' : 'Dashboard'}</button><button className="btn btn-ghost" onClick={() => window.location.reload()}>{hr ? 'Ponovno učitaj' : 'Reload app'}</button></div></div>
    </section>;
  }
}
