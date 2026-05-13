import React from 'react';
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

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Fleet />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/nodes" element={<Nodes />} />
          <Route path="/printers/:printerId" element={<PrinterDetail />} />
          <Route path="/files" element={<Files />} />
          <Route path="/assignments" element={<Assignments />} />
          <Route path="/events" element={<Events />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
