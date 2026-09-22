import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { notifyAppReady } from './services/updater.service';

// Mandatory for OTA updates: until this is called, the updater treats the running bundle as
// unverified and rolls back to the previous one. Fire-and-forget, and a no-op on the web.
notifyAppReady();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
