const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getApiBaseUrl: () => `http://localhost:${process.env.ELECTRON_API_PORT || 3000}`,
});
