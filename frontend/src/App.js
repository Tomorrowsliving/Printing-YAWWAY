import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Fleet from './pages/Fleet';
import Nodes from './pages/Nodes';
import PrinterDetail from './pages/PrinterDetail';
import Files from './pages/Files';
import Assignments from './pages/Assignments';
import Events from './pages/Events';
import Backups from './pages/Backups';
import Settings from './pages/Settings';
import { ToastContainer } from './components/UI';

function App() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Fleet addToast={addToast} />} />
          <Route path="/nodes" element={<Nodes addToast={addToast} />} />
          <Route path="/printers/:id" element={<PrinterDetail addToast={addToast} />} />
          <Route path="/assignments" element={<Assignments addToast={addToast} />} />
          <Route path="/files" element={<Files addToast={addToast} />} />
          <Route path="/backups" element={<Backups addToast={addToast} />} />
          <Route path="/events" element={<Events addToast={addToast} />} />
          <Route path="/settings" element={<Settings addToast={addToast} />} />
        </Routes>
      </Layout>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </Router>
  );
}

export default App;
