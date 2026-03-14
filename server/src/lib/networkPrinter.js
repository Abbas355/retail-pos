/**
 * Sends raw data to a network thermal printer via TCP (JetDirect/AppSocket).
 * BIXOLON and most thermal printers use port 9100.
 */

import net from "net";

const DEFAULT_PORT = 9100;
const TIMEOUT_MS = 5000;

/**
 * Send buffer to network printer at given IP and port.
 * @param {Buffer} data - Raw ESC/POS or other print data
 * @param {string} [host] - Printer IP (from env if not provided)
 * @param {number} [port] - Printer port (default 9100)
 * @returns {Promise<void>}
 */
export function sendToNetworkPrinter(data, host, port) {
  const ip = host || process.env.PRINTER_IP;
  const prt = port ?? (Number(process.env.PRINTER_PORT) || DEFAULT_PORT);

  if (!ip || !ip.trim()) {
    return Promise.reject(new Error("PRINTER_IP not set. Add PRINTER_IP to server/.env"));
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUT_MS);
    socket.on("error", (err) => {
      socket.destroy();
      reject(new Error(`Printer connection failed: ${err.message}`));
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Printer connection timeout"));
    });
    socket.connect(prt, ip.trim(), () => {
      socket.write(data, (err) => {
        socket.end();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
