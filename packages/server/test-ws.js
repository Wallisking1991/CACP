const WebSocket = require('ws');

const url = 'ws://127.0.0.1:3737/rooms/room_5hUKsAoXCuvzayVO93b8Hw/stream?token=cacp_lVCMOV3amFhnDuxpB2ZuzgQ-H9IAOcgp0vSJMgdgOws';
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
  process.exit(0);
});

ws.on('error', (err) => {
  console.log('WebSocket error:', err.message);
});

setTimeout(() => {
  console.log('Still alive after 30s');
}, 30000);
