import { render } from 'preact';
import { boot } from './app-services';
import { initPlatform } from './platform';
import './styles.css';
import { App } from './ui/App';

(async () => {
  await initPlatform();
  render(<App />, document.getElementById('app')!);
  boot().catch((e) => console.error(e));
})();
