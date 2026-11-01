import { render } from 'preact';
import { boot } from './app-services';
import { initPlatform } from './platform';
import './styles.css';
import { App } from './ui/App';

(async () => {
  const p = await initPlatform();
  render(<App />, document.getElementById('app')!);
  boot().catch((e) => console.error(e));

  if (p.kind === 'web' && 'serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
