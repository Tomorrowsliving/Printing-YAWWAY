import React from 'react';
import { useNavigate } from 'react-router-dom';
import NetworkSetupPanel from '../components/NetworkSetupPanel';
import { PageHeader } from '../components/DesignSystem';

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
      <PageHeader
        eyebrow="First Run"
        title="Network Setup"
        description="Choose the LAN address or hostname that Pi nodes should use to reach this dashboard."
      />

      <NetworkSetupPanel
        addToast={addToast}
        onSaved={handleSaved}
        title="Dashboard Address"
      />
    </div>
  );
};

export default NetworkSetup;
