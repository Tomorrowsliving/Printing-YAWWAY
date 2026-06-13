import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import Layout from './components/Layout';
import Fleet from './pages/Fleet';
import Nodes from './pages/Nodes';
import PrinterDetail from './pages/PrinterDetail';
import Files from './pages/Files';
import GcodeHub from './components/GcodeHub';
import Slicer from './pages/Slicer';
import Filament from './pages/Filament';
import Assignments from './pages/Assignments';
import Events from './pages/Events';
import Backups from './pages/Backups';
import Settings from './pages/Settings';
import NetworkSetup from './pages/NetworkSetup';
import { ToastContainer } from './components/UI';

const NETWORK_SETUP_ROUTE = '/setup/network';

const AppRoutes = ({ addToast }) => {
  const location = useLocation();
  const [networkSetupRequired, setNetworkSetupRequired] = useState(null);

  const refreshNetworkSetupRequired = useCallback(async () => {
    try {
      const res = await axios.get('/api/settings/network');
      setNetworkSetupRequired(Boolean(res.data.requires_setup));
    } catch (err) {
      console.error("Network setup check error:", err);
      setNetworkSetupRequired(false);
    }
  }, []);

  useEffect(() => {
    refreshNetworkSetupRequired();
  }, [refreshNetworkSetupRequired]);

  const handleNetworkSaved = (settings) => {
    setNetworkSetupRequired(Boolean(settings.requires_setup));
  };

  if (networkSetupRequired === null) {
    return (
      <div className="min-h-[320px] flex items-center justify-center text-sm text-slate-400">
        Checking network setup...
      </div>
    );
  }

  if (networkSetupRequired && location.pathname !== NETWORK_SETUP_ROUTE) {
    return <Navigate to={NETWORK_SETUP_ROUTE} replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<Fleet addToast={addToast} />} />
      <Route path="/nodes" element={<Nodes addToast={addToast} />} />
      <Route path="/nodes/assignments" element={<Assignments addToast={addToast} />} />
      <Route path="/printers/:id" element={<PrinterDetail addToast={addToast} />} />
      <Route path="/assignments" element={<Navigate to="/nodes/assignments" replace />} />
      <Route path="/gcode" element={<GcodeHub addToast={addToast} />} />
      <Route path="/slicer" element={<Slicer addToast={addToast} />} />
      <Route path="/filament" element={<Filament addToast={addToast} />} />
      <Route path="/files" element={<Files addToast={addToast} />} />
      <Route path="/backups" element={<Backups addToast={addToast} />} />
      <Route path="/events" element={<Events addToast={addToast} />} />
      <Route path="/settings" element={<Settings addToast={addToast} />} />
      <Route
        path={NETWORK_SETUP_ROUTE}
        element={<NetworkSetup addToast={addToast} onNetworkSaved={handleNetworkSaved} />}
      />
    </Routes>
  );
};

function App() {
  const [toasts, setToasts] = useState([]);
  const toastCounter = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info') => {
    toastCounter.current += 1;
    const id = `${Date.now()}-${toastCounter.current}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  }, [removeToast]);

  return (
    <Router>
      <Layout>
        <AppRoutes addToast={addToast} />
      </Layout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </Router>
  );
}

export default App;
