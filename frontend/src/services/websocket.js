import { useEffect, useRef } from 'react';

const getWsUrl = () => {
  if (process.env.REACT_APP_WS_URL) return process.env.REACT_APP_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws/status`;
};

export const useStatusWebSocket = (onMessage) => {
  const ws = useRef(null);

  useEffect(() => {
    const url = getWsUrl();
    ws.current = new WebSocket(url);

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Invalid WebSocket payload:', error);
        }
      }
    };
    ws.current.onerror = (error) => console.error('WebSocket Error:', error);

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [onMessage]);

  return ws.current;
};
