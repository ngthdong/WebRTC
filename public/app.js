const ws = new WebSocket(`wss://supertragic-steadyingly-vernie.ngrok-free.dev`);

const rtcConfig = null

let localStream;
let peerConnections = {};
let myName = '';
let selectedClient = '';

async function register() {
    myName = document.getElementById('nameInput').value.trim();
    if (!myName) {
        alert("Vui lòng nhập tên!");
        return;
    }

    ws.send(JSON.stringify({ type: 'register', name: myName }));
    document.getElementById('callButton').disabled = false;

    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });
    document.getElementById('localVideo').srcObject = localStream;
}

ws.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'ice') {
        rtcConfig = message.data;
    }

    if (message.type === 'clientList') {
        updateClientList(message.clients);
    } else if (message.type === 'endCall') {
        closeAllConnections();
    } else {
        await handleMessage(message);
    }
};

function updateClientList(clients) {
    const list = document.getElementById('clientList');
    list.innerHTML = '';

    clients.forEach(name => {
        if (name !== myName) {
            const li = document.createElement('li');
            li.textContent = name;
            li.onclick = () => selectClient(name);
            list.appendChild(li);
        }
    });
}

function selectClient(name) {
    selectedClient = name;
    document.getElementById('callButton').disabled = false;
}

async function startCall() {
    if (!selectedClient) {
        alert("Select a device to make a call!");
        return;
    }

    closeAllConnections();
    const pc = setupPeerConnection(selectedClient);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'offer',
        offer,
        target: selectedClient,
        sender: myName
    }));

    document.getElementById('hangupButton').disabled = false;
}

function setupPeerConnection(targetClient) {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                target: targetClient,
                sender: myName
            }));
        }
    };

    localStream.getTracks().forEach(track =>
        pc.addTrack(track, localStream)
    );

    peerConnections[targetClient] = pc;
    return pc;
}

async function handleMessage(message) {
    if (message.type === 'offer') {
        closeAllConnections();

        const accept = confirm(
            `${message.sender} Incoming call. Do you want to accept the call?`
        );

        if (!accept) {
            ws.send(JSON.stringify({
                type: 'endCall',
                sender: myName,
                target: message.sender
            }));
            return;
        }

        const pc = setupPeerConnection(message.sender);
        await pc.setRemoteDescription(new RTCSessionDescription(message.offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            answer,
            target: message.sender,
            sender: myName
        }));

        document.getElementById('hangupButton').disabled = false;

    } else if (message.type === 'answer') {
        const pc = peerConnections[message.sender];
        if (pc) {
            await pc.setRemoteDescription(
                new RTCSessionDescription(message.answer)
            );
        }

    } else if (message.type === 'candidate') {
        const pc = peerConnections[message.sender];
        if (pc) {
            await pc.addIceCandidate(
                new RTCIceCandidate(message.candidate)
            );
        }
    }
}

function closeAllConnections() {
    for (const target in peerConnections) {
        peerConnections[target].close();
        delete peerConnections[target];
    }
    document.getElementById('hangupButton').disabled = true;
}

document.getElementById('callButton')
    .addEventListener('click', startCall);

document.getElementById('hangupButton')
    .addEventListener('click', closeAllConnections);
    