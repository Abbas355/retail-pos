const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

/* Use 3131 to avoid conflict with dev server (3000) */
const API_PORT = Number(process.env.ELECTRON_API_PORT) || 3131;
process.env.ELECTRON_API_PORT = String(API_PORT);
let serverProcess = null;

function startApiServer() {
  return new Promise((resolve, reject) => {
    const serverDir = path.join(__dirname, '..', 'server');
    const dbPath = path.join(app.getPath('userData'), 'retail_pos.db');
    const env = {
      ...process.env,
      DB_TYPE: 'sqlite',
      PORT: String(API_PORT),
      ELECTRON_API_PORT: String(API_PORT),
      SQLITE_DB_PATH: dbPath,
    };
    serverProcess = spawn('node', ['src/index.js'], {
      cwd: serverDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout?.on('data', (d) => process.stdout.write(d.toString()));
    serverProcess.stderr?.on('data', (d) => process.stderr.write(d.toString()));
    serverProcess.on('error', reject);

    function check() {
      const req = http.get(`http://127.0.0.1:${API_PORT}/api/permissions/role-permissions`, (res) => {
        req.destroy();
        resolve();
      });
      req.on('error', () => setTimeout(check, 150));
      req.setTimeout(2000, () => { req.destroy(); setTimeout(check, 150); });
    }
    setTimeout(check, 300);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false, /* allow fetch from file:// to localhost */
    },
  });

  const useDev = process.env.ELECTRON_DEV === '1';
  const distPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (useDev) {
    win.loadURL('http://localhost:8080');
  } else if (fs.existsSync(distPath)) {
    win.loadFile(distPath);
  } else {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Retail POS</title></head><body style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;line-height:1.5;">' +
      '<h1>Build required</h1>' +
      '<p>Run from the project root:</p>' +
      '<pre style="background:#eee;padding:12px;border-radius:6px;">npm run build</pre>' +
      '<p>Then start Electron again:</p>' +
      '<pre style="background:#eee;padding:12px;border-radius:6px;">npm run electron</pre>' +
      '<p>Or use dev mode: <code>ELECTRON_DEV=1 npm run electron</code> (with <code>npm run dev</code> in another terminal).</p>' +
      '</body></html>'
    ));
  }
}

app.whenReady().then(() => {
  startApiServer()
    .then(createWindow)
    .catch((err) => {
      console.error('Failed to start API server:', err);
      createWindow();
    });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});
