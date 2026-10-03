import { registerRootComponent } from 'expo';

// Dev preview only: ?shell=android makes the web app behave as it does inside the
// Android WebView shell (app layout, native Google button, Radar bridge stub).
// __DEV__ is false in production bundles, so this block is stripped there.
if (__DEV__ && typeof window !== 'undefined' && /[?&]shell=android\b/.test(window.location.search)) {
  const w = window as any;
  w.__NETWORQ_SHELL__ = { googleAuth: true };
  w.ReactNativeWebView = {
    postMessage(raw: string) {
      const msg = JSON.parse(raw);
      console.info('[shell ←]', msg);
      const reply = (detail: unknown) =>
        setTimeout(() => window.dispatchEvent(new CustomEvent('networq-native', { detail })), 30);
      if (msg.type === 'radar:capabilities') reply({ type: 'radar:capabilities', state: 'on', permission: 'granted' });
      if (msg.type === 'radar:start') reply({ type: 'radar:state', state: 'on' });
      if (msg.type === 'auth:google') reply({ type: 'auth:error', message: 'Google sign-in runs in the real app (system browser).' });
    },
  };
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
