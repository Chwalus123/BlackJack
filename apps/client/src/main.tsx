import { render } from 'preact';
import '@fontsource-variable/cinzel/index.css';
import '@fontsource-variable/montserrat/index.css';
import './styles/global.css';
import { applyTokens } from './shared/tokens';
import { locale } from './i18n';
import { App } from './app/App';

applyTokens();
document.documentElement.lang = locale.value;
render(<App />, document.getElementById('app')!);
