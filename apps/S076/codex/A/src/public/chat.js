(function initChat() {
  const view = document.querySelector(".chat-view");
  if (!view) return;

  const roomId = Number(view.dataset.roomId);
  const form = document.getElementById("message-form");
  const input = document.getElementById("message-input");
  const messages = document.getElementById("messages");
  const error = document.getElementById("socket-error");
  const socket = io();

  function setError(text) {
    error.textContent = text || "";
  }

  function appendMessage(message) {
    const item = document.createElement("li");
    item.className = "message";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const author = document.createElement("strong");
    author.textContent = message.username;

    const time = document.createElement("time");
    time.dateTime = message.created_at;
    time.textContent = message.created_at;

    const body = document.createElement("p");
    body.textContent = message.body;

    meta.append(author, time);
    item.append(meta, body);
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  }

  socket.on("connect", () => {
    socket.emit("join room", roomId, (response) => {
      if (!response || !response.ok) {
        setError(response && response.error ? response.error : "Could not join room.");
      } else {
        setError("");
      }
    });
  });

  socket.on("connect_error", () => {
    setError("Connection failed. Log in again or refresh the page.");
  });

  socket.on("chat message", appendMessage);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;

    socket.emit("chat message", { roomId, body }, (response) => {
      if (!response || !response.ok) {
        setError(response && response.error ? response.error : "Could not send message.");
        return;
      }
      setError("");
      input.value = "";
      input.focus();
    });
  });

  messages.scrollTop = messages.scrollHeight;
})();
