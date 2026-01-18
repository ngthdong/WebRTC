const fs = require('fs');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();

function getIceConfig() {
    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            {
                urls: `turn:${process.env.TURN_SERVER}`,
                username: process.env.TURN_USER,
                credential: process.env.TURN_PASSWORD
            }
        ]
    };
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map();
const activeCalls = new Map();

wss.on('connection', (ws) => {
    let clientName = null;

    ws.send(JSON.stringify({
        type: 'ice',
        data: getIceConfig()
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'register') {
                clientName = data.name;
                clients.set(clientName, ws);
                broadcastClients();
            }

            if (data.type === 'offer') {
                if (activeCalls.has(data.target)) {
                    let oldCaller = activeCalls.get(data.target);
                    if (clients.has(oldCaller)) {
                        clients.get(oldCaller).send(JSON.stringify({ type: 'endCall' }));
                    }
                }
                activeCalls.set(data.target, data.sender);
                activeCalls.set(data.sender, data.target);
                forwardMessage(data);
            }

            if (data.type === 'answer' || data.type === 'candidate') {
                forwardMessage(data);
            }

            if (data.type === 'endCall') {
                endCall(data.sender);
            }   
        } catch (error) {
            console.error('Error handle message:', error);
        }
    });

    ws.on('close', () => {
        if (clientName) {
            endCall(clientName);
            clients.delete(clientName);
            broadcastClients();
        }
    });
});

function broadcastClients() {
    const clientList = Array.from(clients.keys());
    for (const [name, client] of clients.entries()) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'clientList', clients: clientList }));
        }
    }
}

function forwardMessage(data) {
    const targetClient = clients.get(data.target);
    if (targetClient && targetClient.readyState === WebSocket.OPEN) {
        targetClient.send(JSON.stringify(data));
    }
}

function endCall(client) {
    if (activeCalls.has(client)) {
        let partner = activeCalls.get(client);
        activeCalls.delete(client);
        activeCalls.delete(partner);
        forwardMessage({ type: 'endCall', target: partner });
    }
}

server.listen(3000, '0.0.0.0', () => {
    console.log(`Server is running on https://supertragic-steadyingly-vernie.ngrok-free.dev`);
});
