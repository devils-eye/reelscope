import { render } from 'solid-js/web';

import '@fontsource-variable/archivo/wdth.css';
import '@/assets/tokens.css';
import './style.css';
import { applyTheme, currentTheme } from '@/lib/pageTheme';
import App from './App';

applyTheme(currentTheme());
render(() => <App />, document.getElementById('root')!);
