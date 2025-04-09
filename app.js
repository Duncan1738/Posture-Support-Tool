// posture-detection-app.js

let config = loadConfig();

function loadConfig() {
    try {
        const stored = localStorage.getItem('postureConfig');
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.error('Failed to parse stored config:', e);
        return null;
    }
}

function saveConfigToStorage() {
    try {
        localStorage.setItem('postureConfig', JSON.stringify(config));
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

let badPostureStartTime = null;
let lastAlertTime = null;
let alertsEnabled = true;

const overlay = document.querySelector('.camera-overlay');
const alertToggle = document.getElementById('toggleAlert');

async function startWebcam() {
    const video = document.getElementById('video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.onloadedmetadata = () => overlay.classList.add('hidden');
    } catch (err) {
        overlay.textContent = 'Camera access error';
        console.error('Webcam error:', err);
    }
}

async function sendFrame() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await (await fetch(canvas.toDataURL('image/jpeg'))).blob();
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');

    try {
        const res = await fetch('/api/process-image', { method: 'POST', body: formData });
        const data = await res.json();
        updateUI(data);
    } catch (e) {
        console.error('Failed to send frame:', e);
    }
}

function updateUI(data) {
    const statusEl = document.getElementById('status');
    const neckEl = document.getElementById('angle');
    const backEl = document.getElementById('backAngle');
    const shoulderEl = document.getElementById('shoulderTilt');
    const kneeEl = document.getElementById('rightKneeAngle');
    const timerEl = document.getElementById('timer');
    const videoBox = document.querySelector('.video-container');

    if (data.error) {
        statusEl.textContent = `Status: ${data.error}`;
        statusEl.className = 'status-message';
        videoBox.className = 'video-container';
        return;
    }

    statusEl.textContent = data.status;
    statusEl.className = `status-message ${data.is_good ? 'good-posture' : 'bad-posture'}`;
    videoBox.className = `video-container ${data.is_good ? 'good-posture-shadow' : 'bad-posture-shadow'}`;

    if (data.angles) {
        let text = [];
        if (data.angles.right !== undefined) text.push(`Right: ${data.angles.right.toFixed(2)}°`);
        if (data.angles.left !== undefined) text.push(`Left: ${data.angles.left.toFixed(2)}°`);
        neckEl.textContent = `Neck Angles: ${text.join(' | ')}`;
    }

    if (data.metrics) {
        if (data.metrics.back_angle !== undefined) backEl.textContent = `Back Angle: ${data.metrics.back_angle.toFixed(2)}°`;
        if (data.metrics.shoulder_tilt !== undefined) shoulderEl.textContent = `Shoulder Tilt: ${data.metrics.shoulder_tilt.toFixed(2)}°`;
        if (data.metrics.right_knee_angle !== undefined) kneeEl.textContent = `Right Knee Angle: ${data.metrics.right_knee_angle.toFixed(2)}°`;
    }

    if (data.landmarks) drawPoseMarkers(data.landmarks);

    if (!data.is_good) {
        if (!badPostureStartTime) badPostureStartTime = Date.now();
        const duration = Math.floor((Date.now() - badPostureStartTime) / 1000);
        timerEl.textContent = `Bad Posture Time: ${duration}s`;
        timerEl.classList.remove('hidden');

        const alertThreshold = config.alertInterval / 1000;
        if (duration >= alertThreshold && (!lastAlertTime || (Date.now() - lastAlertTime) >= config.alertInterval)) {
            playAlert();
            lastAlertTime = Date.now();
        }
    } else {
        badPostureStartTime = null;
        timerEl.classList.add('hidden');
    }
}

function playAlert() {
    if (!alertsEnabled) return;
    const audio = new Audio('sounds/soft-alert.mp3');
    audio.play().catch(err => console.log('Alert play failed:', err));
}

function drawPoseMarkers(landmarks) {
    const canvas = document.getElementById('pose-canvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('video');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw landmarks
    landmarks.forEach(lm => {
        if (lm.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, 2 * Math.PI);
            ctx.fillStyle = '#00FF00';
            ctx.fill();
        }
    });

    // Draw lines
    drawConnections(ctx, landmarks, canvas.width, canvas.height);
}

function drawConnections(ctx, lm, w, h) {
    const connections = [
        [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
        [9,10], [11,12],
        [11,13],[13,15],[15,17],[15,19],[15,21],
        [12,14],[14,16],[16,18],[16,20],[16,22],
        [11,23],[12,24],[23,24],
        [23,25],[25,27],[27,29],[29,31],
        [24,26],[26,28],[28,30],[30,32]
    ];

    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;

    connections.forEach(([a, b]) => {
        const s = lm[a], e = lm[b];
        if (s && e && s.visibility > 0.5 && e.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(s.x * w, s.y * h);
            ctx.lineTo(e.x * w, e.y * h);
            ctx.stroke();
        }
    });
}

// UI Events

document.getElementById('saveConfig').addEventListener('click', () => {
    const rMin = +document.getElementById('rightMinAngle').value;
    const rMax = +document.getElementById('rightMaxAngle').value;
    const lMin = +document.getElementById('leftMinAngle').value;
    const lMax = +document.getElementById('leftMaxAngle').value;
    const interval = +document.getElementById('alertInterval').value * 1000;

    if (rMin >= rMax || lMin >= lMax || rMin > 0 || rMax > 0 || lMin < 0 || lMax < 0)
        return alert('Invalid angle configuration');

    config = {
        ...config,
        rightMinAngle: rMin,
        rightMaxAngle: rMax,
        leftMinAngle: lMin,
        leftMaxAngle: lMax,
        alertInterval: interval
    };
    saveConfigToStorage();
});

document.getElementById('resetConfig').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/config');
        const def = await res.json();
        config = {
            rightMinAngle: def.right_min_angle,
            rightMaxAngle: def.right_max_angle,
            leftMinAngle: def.left_min_angle,
            leftMaxAngle: def.left_max_angle,
            alertInterval: 10000
        };
        document.getElementById('rightMinAngle').value = config.rightMinAngle;
        document.getElementById('rightMaxAngle').value = config.rightMaxAngle;
        document.getElementById('leftMinAngle').value = config.leftMinAngle;
        document.getElementById('leftMaxAngle').value = config.leftMaxAngle;
        document.getElementById('alertInterval').value = config.alertInterval / 1000;
        localStorage.removeItem('postureConfig');
    } catch (e) {
        console.error('Failed to reset config:', e);
    }
});

document.getElementById('startBtn').addEventListener('click', async () => {
    const btn = document.getElementById('startBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Starting...';
    await startWebcam();
    setInterval(sendFrame, 1000);
    btn.innerHTML = '<span class="loader running"></span> Detection Running';
});

alertToggle.addEventListener('click', () => {
    alertsEnabled = !alertsEnabled;
    alertToggle.classList.toggle('disabled');
    alertToggle.innerHTML = alertsEnabled ?
        '<span class="alert-icon">🔔</span> Alerts Enabled' :
        '<span class="alert-icon">🔕</span> Alerts Disabled';
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/config');
        const def = await res.json();
        const stored = loadConfig();
        config = stored || {
            rightMinAngle: def.right_min_angle,
            rightMaxAngle: def.right_max_angle,
            leftMinAngle: def.left_min_angle,
            leftMaxAngle: def.left_max_angle,
            alertInterval: 10000
        };
        document.getElementById('rightMinAngle').value = config.rightMinAngle;
        document.getElementById('rightMaxAngle').value = config.rightMaxAngle;
        document.getElementById('leftMinAngle').value = config.leftMinAngle;
        document.getElementById('leftMaxAngle').value = config.leftMaxAngle;
        document.getElementById('alertInterval').value = config.alertInterval / 1000;
    } catch (e) {
        console.error('Initial config load failed:', e);
    }
});
