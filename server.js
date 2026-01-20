const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const clients = new Map(); 
const rooms = new Map();   

wss.on('connection', (ws) => {
    let clientName = null;

    ws.send(JSON.stringify({
        type: 'ice',
        data: getIceConfig()
    }));

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        switch (data.type) {
            case 'register':
                clientName = data.name;
                clients.set(clientName, ws);
                broadcastRooms();
                break;

            case 'createRoom':
                rooms.set(data.room, {
                    owner: clientName,
                    members: new Set([clientName])
                });
                broadcastRooms();
                break;

            case 'joinRoom': {
                const room = rooms.get(data.room);
                if (!room) return;

                room.members.add(clientName);

                ws.send(JSON.stringify({
                    type: 'roomMembers',
                    members: [...room.members].filter(u => u !== clientName)
                }));

                broadcastRooms();
                break;
            }

            case 'leaveRoom': {
                const room = rooms.get(data.room);
                if (!room) return;

                room.members.delete(clientName);

                if (room.owner === clientName) {
                    const newOwner = room.members.values().next().value;

                    if (!newOwner) {
                        rooms.delete(data.room);
                        broadcastRooms();
                        break;
                    }

                    const newRoomId = renameRoom(data.room, newOwner);

                    broadcastRoomRenamed(data.room, newRoomId, newOwner);
                    broadcastRooms();
                    break;
                }

                broadcastRooms();
                break;
            }

            case 'offer':
            case 'answer':
            case 'candidate':
            case 'endCall':
                forwardMessage(data);
                break;

            case 'listRooms':
                sendRooms(ws);
                break;
        }
    });

    ws.on('close', () => {
        if (!clientName) return;

        for (const [roomId, room] of rooms.entries()) {
            if (!room.members.has(clientName)) continue;

            room.members.delete(clientName);

            if (room.owner === clientName) {
                const newOwner = room.members.values().next().value;

                if (!newOwner) {
                    rooms.delete(roomId);
                    continue;
                }

                const newRoomId = renameRoom(roomId, newOwner);
                broadcastRoomRenamed(roomId, newRoomId, newOwner);
            }

            if (room.members.size === 0) {
                rooms.delete(roomId);
            }
        }

        clients.delete(clientName);
        broadcastRooms();
    });
});

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

function forwardMessage(data) {
    const ws = clients.get(data.target);
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastRooms() {
    const list = [];

    for (const [roomId, room] of rooms.entries()) {
        list.push({
            room: roomId,
            owner: room.owner,
            members: room.members.size
        });
    }

    clients.forEach(ws => {
        ws.send(JSON.stringify({ type: 'roomList', rooms: list }));
    });
}

function sendRooms(ws) {
    const list = [];

    for (const [roomId, room] of rooms.entries()) {
        list.push({
            room: roomId,
            owner: room.owner,
            members: room.members.size
        });
    }

    ws.send(JSON.stringify({ type: 'roomList', rooms: list }));
}

function renameRoom(oldRoomId, newOwner) {
    const room = rooms.get(oldRoomId);
    if (!room) return null;

    const newRoomId = `room-${newOwner}`;

    rooms.set(newRoomId, {
        owner: newOwner,
        members: room.members
    });

    rooms.delete(oldRoomId);

    return newRoomId;
}

function broadcastRoomRenamed(oldId, newId, owner) {
    clients.forEach(ws => {
        ws.send(JSON.stringify({
            type: 'roomRenamed',
            oldRoom: oldId,
            newRoom: newId,
            owner
        }));
    });
}

server.listen(3000, '0.0.0.0', () => {
    console.log('Server running');
});
