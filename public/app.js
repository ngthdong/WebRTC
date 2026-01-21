const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${location.host}`);

let rtcConfig;
let localStream;
let peerConnections = {};

let myName = '';
let selectedRoom = '';
let currentRoom = '';
let lastRoomList = [];

async function ensureLocalStream() {
    if (localStream) return;

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

    const video = document.getElementById('localVideo');
    video.srcObject = localStream;
    video.muted = true;
    video.style.transform = 'scaleX(-1)';
    await video.play();
}

function stopLocalMedia() {
    if (!localStream) return;

    localStream.getTracks().forEach(track => {
        track.stop(); 
    });

    localStream = null;

    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = null;

    document.getElementById('toggleMic').disabled = true;
    document.getElementById('toggleCamera').disabled = true;
}

async function register() {
    myName = document.getElementById('nameInput').value.trim();
    if (!myName) return alert('Name required');

    ws.send(JSON.stringify({ type: 'register', name: myName }));
    ws.send(JSON.stringify({ type: 'listRooms' }));

    document.getElementById('connectButton').disabled = true;
    document.getElementById('createRoom').disabled = false;
}

ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
        case 'ice':
            rtcConfig = msg.data;
            break;

        case 'roomList':
            updateRoomList(msg.rooms);
            break;

        case 'roomMembers':
            await callRoomMembers(msg.members);
            break;

        case 'offer':
            await handleOffer(msg);
            break;

        case 'answer':
            await handleAnswer(msg);
            break;

        case 'candidate':
            await handleCandidate(msg);
            break;
        
        case 'roomRenamed':
            if (currentRoom === msg.oldRoom) {
                currentRoom = msg.newRoom;
            }
            updateRoomListAfterRename(msg);
            break;

        case 'endCall':
            closePeer(msg.sender);
            break;
    }
};

function updateRoomList(rooms) {
    lastRoomList = rooms;
    const ul = document.getElementById('roomList');
    ul.innerHTML = '';

    rooms.forEach(r => {
        const li = document.createElement('li');
        li.textContent = `${r.room} (${r.members})`;

        if (r.room === currentRoom) {
            li.classList.add('current-room');
        }

        else if (r.room === selectedRoom) {
            li.classList.add('active-room');
        }
        
        li.onclick = () => {
            selectedRoom = r.room;
            document.getElementById('callButton').disabled = false;
            updateRoomList(lastRoomList);
        };

        if (r.room === selectedRoom) li.classList.add('active-room');
        ul.appendChild(li);
    });
}

async function createRoom() {
    await ensureLocalStream();

    const room = `room-${myName}`;
    ws.send(JSON.stringify({ type: 'createRoom', room }));

    currentRoom = room;
    document.getElementById('createRoom').disabled = true;
    document.getElementById('hangupButton').disabled = false;

    document.getElementById('toggleMic').disabled = false;
    document.getElementById('toggleCamera').disabled = false;
}

async function startCall() {
    if (!selectedRoom) return alert('Select room');

    if (currentRoom !== selectedRoom) {
        stopCall();
    }

    await ensureLocalStream();

    ws.send(JSON.stringify({
        type: 'joinRoom',
        room: selectedRoom
    }));

    currentRoom = selectedRoom;

    document.getElementById('createRoom').disabled = true;
}

async function callRoomMembers(members) {
    for (const peer of members) {
        const pc = setupPeerConnection(peer);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.send(JSON.stringify({
            type: 'offer',
            offer,
            target: peer,
            sender: myName
        }));
    }

    document.getElementById('callButton').disabled = true;
    document.getElementById('hangupButton').disabled = false;

    document.getElementById('toggleMic').disabled = false;
    document.getElementById('toggleCamera').disabled = false;
}

function setupPeerConnection(target) {
    const pc = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = e => {
        let video = document.getElementById(`remote-${target}`);

        if (!video) {
            video = document.createElement('video');
            video.id = `remote-${target}`;
            video.autoplay = true;
            video.playsInline = true;

            video.muted = true;

            video.className = 'video remote';
            document.getElementById('videos').appendChild(video);
        }

        video.srcObject = e.streams[0];

        video.play().catch(err => {
            console.warn('Autoplay blocked:', err);
        });
    };

    pc.onicecandidate = e => {
        if (e.candidate) {
            ws.send(JSON.stringify({
                type: 'candidate',
                candidate: e.candidate,
                target,
                sender: myName
            }));
        }
    };

    peerConnections[target] = pc;
    return pc;
}

async function handleOffer(msg) {
    await ensureLocalStream();

    const pc = setupPeerConnection(msg.sender);
    await pc.setRemoteDescription(msg.offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.send(JSON.stringify({
        type: 'answer',
        answer,
        target: msg.sender,
        sender: myName
    }));
}

async function handleAnswer(msg) {
    const pc = peerConnections[msg.sender];
    if (pc) await pc.setRemoteDescription(msg.answer);
}

async function handleCandidate(msg) {
    const pc = peerConnections[msg.sender];
    if (pc) await pc.addIceCandidate(msg.candidate);
}

function closePeer(peer) {
    if (peerConnections[peer]) {
        peerConnections[peer].close();
        delete peerConnections[peer];
    }

    const video = document.getElementById(`remote-${peer}`);
    if (video) video.remove();
}

function closeAllConnections() {
    Object.keys(peerConnections).forEach(peer => {
        closePeer(peer); 
    });

    peerConnections = {};
}

function stopCall() {
    Object.keys(peerConnections).forEach(peer => {
        ws.send(JSON.stringify({
            type: 'endCall',
            sender: myName,
            target: peer
        }));

        closePeer(peer);
    });

    ws.send(JSON.stringify({
        type: 'leaveRoom',
        room: currentRoom
    }));

    closeAllConnections();
    stopLocalMedia();
    currentRoom = '';

    document.getElementById('createRoom').disabled = false;
    document.getElementById('callButton').disabled = true;
    document.getElementById('hangupButton').disabled = true;
}

toggleMic.onclick = () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    toggleMic.classList.toggle('on', track.enabled);
    toggleMic.classList.toggle('off', !track.enabled);
};

toggleCamera.onclick = () => {
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    toggleCamera.classList.toggle('on', track.enabled);
    toggleCamera.classList.toggle('off', !track.enabled);
};

document.getElementById('createRoom').onclick = createRoom;
document.getElementById('callButton').onclick = startCall;
document.getElementById('hangupButton').onclick = stopCall;
