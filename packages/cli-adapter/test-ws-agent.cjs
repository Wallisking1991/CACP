const WebSocket = require('ws');

const config = {
  server_url: 'http://127.0.0.1:3737',
  room_id: 'room_5hUKsAoXCuvzayVO93b8Hw',
  agent_token: 'cacp_NCv-jTM-IEoGQ88yaim7L6LUXtMIWF-651tbTum-cC8'
};

const streamUrl = `ws://127.0.0.1:3737/rooms/${config.room_id}/stream?token=${config.agent_token}`;
const ws = new WebSocket(streamUrl, { origin: config.server_url });

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
