const path = require("path");
const http = require("http");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const { Server } = require("socket.io");
const helmet = require("helmet");
const { init, run, get, all } = require("./db");

const PORT = Number(process.env.PORT || 5076);
const SESSION_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-me";
const SQLiteStore = SQLiteStoreFactory(session);

const app = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  store: new SQLiteStore({
    dir: path.join(__dirname, "..", "data"),
    db: "sessions.sqlite"
  }),
  name: "chat.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});

const io = new Server(server);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.error = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeMessage(value) {
  return String(value || "").trim();
}

app.get("/", (req, res) => {
  res.redirect(req.session.user ? "/rooms" : "/login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res, next) => {
  try {
    const username = normalizeName(req.body.username);
    const password = String(req.body.password || "");

    if (username.length < 3 || username.length > 30) {
      res.status(400).render("register", { error: "Username must be 3-30 characters." });
      return;
    }

    if (password.length < 6) {
      res.status(400).render("register", { error: "Password must be at least 6 characters." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      [username, passwordHash]
    );

    req.session.user = { id: result.id, username };
    res.redirect("/rooms");
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT") {
      res.status(409).render("register", { error: "That username is already taken." });
      return;
    }
    next(err);
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res, next) => {
  try {
    const username = normalizeName(req.body.username);
    const password = String(req.body.password || "");
    const user = await get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).render("login", { error: "Invalid username or password." });
      return;
    }

    req.session.user = { id: user.id, username: user.username };
    res.redirect("/rooms");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    res.clearCookie("chat.sid");
    res.redirect("/login");
  });
});

app.get("/rooms", requireAuth, async (req, res, next) => {
  try {
    const rooms = await all(`
      SELECT
        rooms.*,
        users.username AS creator,
        COUNT(messages.id) AS message_count,
        MAX(messages.created_at) AS last_message_at
      FROM rooms
      JOIN users ON users.id = rooms.created_by
      LEFT JOIN messages ON messages.room_id = rooms.id
      GROUP BY rooms.id
      ORDER BY COALESCE(MAX(messages.id), rooms.id) DESC
    `);
    res.render("rooms", { rooms });
  } catch (err) {
    next(err);
  }
});

app.post("/rooms", requireAuth, async (req, res, next) => {
  try {
    const name = normalizeName(req.body.name);
    const description = normalizeMessage(req.body.description).slice(0, 160);

    if (name.length < 2 || name.length > 50) {
      const rooms = await all("SELECT * FROM rooms ORDER BY id DESC");
      res.status(400).render("rooms", { rooms, error: "Room name must be 2-50 characters." });
      return;
    }

    const result = await run(
      "INSERT INTO rooms (name, description, created_by) VALUES (?, ?, ?)",
      [name, description, req.session.user.id]
    );
    res.redirect(`/rooms/${result.id}`);
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT") {
      const rooms = await all("SELECT * FROM rooms ORDER BY id DESC");
      res.status(409).render("rooms", { rooms, error: "A room with that name already exists." });
      return;
    }
    next(err);
  }
});

app.get("/rooms/:id", requireAuth, async (req, res, next) => {
  try {
    const room = await get(`
      SELECT rooms.*, users.username AS creator
      FROM rooms
      JOIN users ON users.id = rooms.created_by
      WHERE rooms.id = ?
    `, [req.params.id]);

    if (!room) {
      res.status(404).render("not-found");
      return;
    }

    const messages = await all(`
      SELECT messages.id, messages.body, messages.created_at, users.username
      FROM messages
      JOIN users ON users.id = messages.user_id
      WHERE messages.room_id = ?
      ORDER BY messages.id ASC
      LIMIT 300
    `, [room.id]);

    res.render("chat", { room, messages });
  } catch (err) {
    next(err);
  }
});

io.use((socket, next) => {
  const user = socket.request.session.user;
  if (!user) {
    next(new Error("Authentication required"));
    return;
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("join room", async (roomId, ack) => {
    const numericRoomId = Number(roomId);
    if (!Number.isInteger(numericRoomId)) {
      if (ack) ack({ ok: false, error: "Invalid room." });
      return;
    }

    const room = await get("SELECT id FROM rooms WHERE id = ?", [numericRoomId]);
    if (!room) {
      if (ack) ack({ ok: false, error: "Room not found." });
      return;
    }

    socket.join(`room:${numericRoomId}`);
    if (ack) ack({ ok: true });
  });

  socket.on("chat message", async ({ roomId, body }, ack) => {
    try {
      const numericRoomId = Number(roomId);
      const messageBody = normalizeMessage(body);

      if (!Number.isInteger(numericRoomId) || messageBody.length === 0 || messageBody.length > 1000) {
        if (ack) ack({ ok: false, error: "Message must be 1-1000 characters." });
        return;
      }

      const room = await get("SELECT id FROM rooms WHERE id = ?", [numericRoomId]);
      if (!room) {
        if (ack) ack({ ok: false, error: "Room not found." });
        return;
      }

      const result = await run(
        "INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)",
        [numericRoomId, socket.request.session.user.id, messageBody]
      );

      const message = await get(`
        SELECT messages.id, messages.body, messages.created_at, users.username
        FROM messages
        JOIN users ON users.id = messages.user_id
        WHERE messages.id = ?
      `, [result.id]);

      io.to(`room:${numericRoomId}`).emit("chat message", message);
      if (ack) ack({ ok: true });
    } catch (err) {
      if (ack) ack({ ok: false, error: "Could not send message." });
    }
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error");
});

init().then(() => {
  server.listen(PORT, () => {
    console.log(`Chat app listening on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialize database", err);
  process.exit(1);
});
