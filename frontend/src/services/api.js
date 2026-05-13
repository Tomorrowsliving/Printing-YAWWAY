import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const nodeService = {
  getNodes: () => api.get('/nodes'),
  getNode: (id) => api.get(`/nodes/${id}`),
  registerNode: (data) => api.post('/nodes', data),
};

export const printerService = {
  getPrinters: () => api.get('/printers'),
  getPrinter: (id) => api.get(`/printers/${id}`),
  createPrinter: (data) => api.post('/printers', data),
  updatePrinter: (id, data) => api.put(`/printers/${id}`, data),
  deletePrinter: (id) => api.delete(`/printers/${id}`),
};

export const agentService = {
  getHealth: (ip, port = 8000) => axios.get(`http://${ip}:${port}/health`),
  getUsb: (ip, port = 8000) => axios.get(`http://${ip}:${port}/usb`),
  getInstances: (ip, port = 8000) => axios.get(`http://${ip}:${port}/instances`),
  controlInstance: (ip, port, action, instance) =>
    axios.post(`http://${ip}:${port}/instances/${action}`, { name: instance }),
};

export default api;
