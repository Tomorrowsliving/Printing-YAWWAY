import React from 'react';
import { useNavigate } from 'react-router-dom';
import NetworkSetupPanel from '../components/NetworkSetupPanel';

const NetworkSetup = ({ addToast, onNetworkSaved }) => {
  const navigate = useNavigate();

  const handleSaved = (settings) => {
    onNetworkSaved?.(settings);
    if (!settings.requires_setup) {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <p className="text-xs uppercase tracking-widest text-cyan-400 font-bold">First run</p>
        <h2 className="text-2xl font-bold mt-1">Network Setup</h2>
      </div>

      <NetworkSetupPanel
        addToast={addToast}
        onSaved={handleSaved}
        title="Dashboard Address"
      />
    </div>
  );
};

export default NetworkSetup;
