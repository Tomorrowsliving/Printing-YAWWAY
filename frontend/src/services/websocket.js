import { useEffect, useRef } from 'react';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws/status';

export const useStatusWebSocket = (onMessage) => {
  const ws = useRef(null);

  useEffect(() => {
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => console.log('WebSocket Connected');
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (onMessage) onMessage(data);
    };
    ws.current.onerror = (error) => console.error('WebSocket Error:', error);
    ws.current.onclose = () => console.log('WebSocket Disconnected');

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [onMessage]);

  return ws.current;
};
