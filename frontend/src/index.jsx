import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// notifyAppReady() lives in App.jsx, deliberately AFTER the tree mounts: calling it here would
// confirm the bundle as good even if React then failed to render, defeating the rollback.

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
