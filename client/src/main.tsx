import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './design-system.css';
import SetupPage from './pages/SetupPage';
import CameraPage from './pages/CameraPage';
import ArbitragePage from './pages/ArbitragePage';
import GuidePage from './pages/GuidePage';
import SettingsPage from './pages/SettingsPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/camera" element={<CameraPage />} />
        <Route path="/arbitrage" element={<ArbitragePage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
