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
  updateNode: (id, data) => api.put(`/nodes/${id}`, data),
  deleteNode: (id) => api.delete(`/nodes/${id}`),
  getNodeUsb: (id) => api.get(`/nodes/${id}/usb`),
  createNodeInstance: (id, data) => api.post(`/nodes/${id}/instances/create`, data),
};

export const printerService = {
  getPrinters: () => api.get('/printers'),
  getPrinter: (id) => api.get(`/printers/${id}`),
  getPrinterDetail: (id) => api.get(`/printers/${id}/detail`),
  createPrinter: (data) => api.post('/printers', data),
  updatePrinter: (id, data) => api.put(`/printers/${id}`, data),
  deletePrinter: (id) => api.delete(`/printers/${id}`),
};

export const agentService = {
  // Direct calls to agents are deprecated in favour of backend proxied routes
  getHealth: (ip, port) => axios.get(`http://${ip}:${port}/health`),
  getInstances: (ip, port) => axios.get(`http://${ip}:${port}/instances`),
  controlInstance: (ip, port, action, instance) =>
    axios.post(`http://${ip}:${port}/instances/${action}`, { name: instance }),
};

export default api;
