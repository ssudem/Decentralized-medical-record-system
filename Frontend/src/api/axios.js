import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:3001/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every outgoing request
API.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('medirecord_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default API;
