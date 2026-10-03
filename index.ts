import { registerRootComponent } from 'expo';

// Dev preview only: ?shell=android makes the web app behave as it does inside the
// Android WebView shell (app layout, native Google button, Radar bridge stub).
// __DEV__ is false in production bundles, so this block is stripped there.
if (__DEV__ && typeof window !== 'undefined' && /[?&]shell=android\b/.test(window.location.search)) {
  const w = window as any;
  const params = new URLSearchParams(window.location.search);
  // Simulated Bluetooth: this window "broadcasts" at the chosen signal strength via the dev API
  const rssi = Number(params.get('bleRssi') || -75);
  const deviceId = sessionStorage.getItem('nq-dev-device') || Math.random().toString(36).slice(2);
  sessionStorage.setItem('nq-dev-device', deviceId);
  let token: string | null = null;
  let scanning: ReturnType<typeof setInterval> | null = null;
  const reply = (detail: unknown) => setTimeout(() => window.dispatchEvent(new CustomEvent('networq-native', { detail })), 30);
  const tick = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/dev/ble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, token, rssi }),
      });
      const { heard } = await res.json();
      if (heard?.length) reply({ type: 'radar:sightings', items: heard });
    } catch {
      /* dev API not running */
    }
  };
  w.__NETWORQ_SHELL__ = { googleAuth: true };
  w.ReactNativeWebView = {
    postMessage(raw: string) {
      const msg = JSON.parse(raw);
      console.info('[shell ←]', msg);
      if (msg.type === 'radar:capabilities') reply({ type: 'radar:capabilities', state: 'on', permission: 'granted' });
      if (msg.type === 'radar:start') {
        token = msg.token;
        reply({ type: 'radar:state', state: 'on' });
        if (!scanning) scanning = setInterval(tick, 1500);
        tick();
      }
      if (msg.type === 'radar:token') token = msg.token;
      if (msg.type === 'radar:stop') {
        token = null;
        if (scanning) clearInterval(scanning);
        scanning = null;
        tick();
      }
      if (msg.type === 'auth:google') reply({ type: 'auth:error', message: 'Google sign-in runs in the real app (system browser).' });
    },
  };
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
