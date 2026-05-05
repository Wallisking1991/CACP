const WebSocket = require('./node_modules/ws');

const url = 'ws://127.0.0.1:3737/rooms/room_5hUKsAoXCuvzayVO93b8Hw/stream?token=cacp_NCv-jTM-IEoGQ88yaim7L6LUXtMIWF-651tbTum-cC8';
const ws = new WebSocket(url, { origin: 'http://127.0.0.1:3737' });

ws.on('open', () => {
  console.log('WebSocket opened');
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());
  console.log('Received:', event.type);
});

ws.on('close', (code, reason) => {
  console.log('WebSocket closed:', code, reason.toString());
});

ws.on('error', (err) => {
  console.log('WebSocket error:', err.message);
});

setTimeout(() => {
  console.log('Still alive after 30s');
}, 30000);
