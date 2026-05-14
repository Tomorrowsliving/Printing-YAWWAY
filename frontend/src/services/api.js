import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const nodeService = {
  getNodes: () => api.get('/api/nodes'),
  getNode: (id) => api.get(`/api/nodes/${id}`),
  registerNode: (data) => api.post('/api/nodes', data),
};

export const printerService = {
  getPrinters: () => api.get('/api/printers'),
  getPrinter: (id) => api.get(`/api/printers/${id}`),
  createPrinter: (data) => api.post('/api/printers', data),
  updatePrinter: (id, data) => api.put(`/api/printers/${id}`, data),
  deletePrinter: (id) => api.delete(`/api/printers/${id}`),
};

export const agentService = {
  getHealth: (ip, port = 8001) => axios.get(`http://${ip}:${port}/health`),
  getUsb: (ip, port = 8001) => axios.get(`http://${ip}:${port}/usb`),
  getInstances: (ip, port = 8001) => axios.get(`http://${ip}:${port}/instances`),
  controlInstance: (ip, port, action, instance) =>
    axios.post(`http://${ip}:${port}/instances/${action}`, { name: instance }),
};

export default api;
