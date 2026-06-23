'use strict';

// --- Tiny API helper ------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// --- State ----------------------------------------------------------------
const state = {
  me: null,
  currentRoomId: null,
  lastMessageId: 0,
  pollTimer: null,
};

// --- Element refs ---------------------------------------------------------
const $ = (id) => document.getElementById(id);
const authView = $('auth-view');
const chatView = $('chat-view');

// --- Auth view ------------------------------------------------------------
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-register').classList.toggle('active', mode === 'register');
  $('auth-submit').textContent = mode === 'login' ? 'Log in' : 'Register';
  $('auth-error').textContent = '';
}

$('tab-login').onclick = () => setAuthMode('login');
$('tab-register').onclick = () => setAuthMode('register');

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const username = $('auth-username').value;
  const password = $('auth-password').value;
  try {
    const { user } = await api('POST', `/api/${authMode}`, { username, password });
    state.me = user;
    enterChat();
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
};

// --- View switching -------------------------------------------------------
function showAuth() {
  stopPolling();
  state.me = null;
  state.currentRoomId = null;
  chatView.classList.add('hidden');
  authView.classList.remove('hidden');
}

async function enterChat() {
  authView.classList.add('hidden');
  chatView.classList.remove('hidden');
  $('me-username').textContent = state.me.username;
  await loadRooms();
}

// --- Rooms ----------------------------------------------------------------
async function loadRooms() {
  const { rooms } = await api('GET', '/api/rooms');
  const list = $('room-list');
  list.innerHTML = '';
  rooms.forEach((room) => {
    const li = document.createElement('li');
    li.dataset.roomId = room.id;
    if (room.id === state.currentRoomId) li.classList.add('active');
    li.innerHTML = `<span># ${escapeHtml(room.name)}</span><span class="count">${room.message_count}</span>`;
    li.onclick = () => selectRoom(room.id, room.name);
    list.appendChild(li);
  });

  // Auto-select first room if none selected.
  if (state.currentRoomId === null && rooms.length > 0) {
    selectRoom(rooms[0].id, rooms[0].name);
  }
}

$('new-room-form').onsubmit = async (e) => {
  e.preventDefault();
  $('room-error').textContent = '';
  const name = $('new-room-name').value.trim();
  if (!name) return;
  try {
    const { room } = await api('POST', '/api/rooms', { name });
    $('new-room-name').value = '';
    await loadRooms();
    selectRoom(room.id, room.name);
  } catch (err) {
    $('room-error').textContent = err.message;
  }
};

// --- Messages -------------------------------------------------------------
async function selectRoom(roomId, roomName) {
  state.currentRoomId = roomId;
  state.lastMessageId = 0;
  $('current-room').textContent = '# ' + roomName;
  $('messages').innerHTML = '';
  $('message-form').classList.remove('hidden');

  document.querySelectorAll('#room-list li').forEach((li) => {
    li.classList.toggle('active', Number(li.dataset.roomId) === roomId);
  });

  await fetchMessages();
  startPolling();
}

async function fetchMessages() {
  if (state.currentRoomId === null) return;
  try {
    const { messages } = await api(
      'GET',
      `/api/rooms/${state.currentRoomId}/messages?after=${state.lastMessageId}`
    );
    messages.forEach(renderMessage);
  } catch (err) {
    // If session expired, bounce back to auth.
    if (/authenticat/i.test(err.message)) showAuth();
  }
}

function renderMessage(msg) {
  if (msg.id <= state.lastMessageId) return;
  state.lastMessageId = msg.id;

  const wrap = document.createElement('div');
  wrap.className = 'msg' + (msg.username === state.me.username ? ' mine' : '');
  const time = new Date(msg.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  wrap.innerHTML =
    `<div class="meta">${escapeHtml(msg.username)} · ${time}</div>` +
    `<div class="bubble">${escapeHtml(msg.body)}</div>`;

  const box = $('messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.appendChild(wrap);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

$('message-form').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('message-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  try {
    const { message } = await api(
      'POST',
      `/api/rooms/${state.currentRoomId}/messages`,
      { body }
    );
    renderMessage(message);
  } catch (err) {
    input.value = body; // restore on failure
    alert(err.message);
  }
};

// --- Polling for new messages --------------------------------------------
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(fetchMessages, 2000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// --- Logout ---------------------------------------------------------------
$('logout-btn').onclick = async () => {
  await api('POST', '/api/logout');
  showAuth();
};

// --- Utils ----------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Boot -----------------------------------------------------------------
(async function init() {
  try {
    const { user } = await api('GET', '/api/me');
    if (user) {
      state.me = user;
      await enterChat();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
})();
