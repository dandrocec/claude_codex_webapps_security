const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { getDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 5051;
const STATUSES = ["Want to Watch", "Watching", "Watched"];

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: path.join(__dirname, "..")
    }),
    secret: process.env.SESSION_SECRET || "replace-this-secret-for-local-use",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.statuses = STATUSES;
  res.locals.error = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function normalizeMovieInput(body) {
  const title = String(body.title || "").trim();
  const year = body.year ? Number(body.year) : null;
  const status = String(body.status || "");
  const rating = body.rating ? Number(body.rating) : null;

  if (!title) {
    return { error: "Title is required." };
  }
  if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2100)) {
    return { error: "Year must be between 1888 and 2100." };
  }
  if (!STATUSES.includes(status)) {
    return { error: "Choose a valid status." };
  }
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { error: "Rating must be from 1 to 5." };
  }

  return { movie: { title, year, status, rating } };
}

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/movies");
  }
  return res.redirect("/login");
});

app.get("/register", (req, res) => {
  res.render("auth", { mode: "register" });
});

app.post("/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (username.length < 3 || password.length < 6) {
      return res.status(400).render("auth", {
        mode: "register",
        error: "Username must be at least 3 characters and password at least 6."
      });
    }

    const db = await getDb();
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await db.run(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      username,
      passwordHash
    );

    req.session.user = { id: result.lastID, username };
    return res.redirect("/movies");
  } catch (error) {
    if (error && error.code === "SQLITE_CONSTRAINT") {
      return res.status(409).render("auth", {
        mode: "register",
        error: "That username is already taken."
      });
    }
    return next(error);
  }
});

app.get("/login", (req, res) => {
  res.render("auth", { mode: "login" });
});

app.post("/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE username = ?", username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).render("auth", {
        mode: "login",
        error: "Invalid username or password."
      });
    }

    req.session.user = { id: user.id, username: user.username };
    return res.redirect("/movies");
  } catch (error) {
    return next(error);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/movies", requireAuth, async (req, res, next) => {
  try {
    const selectedStatus = String(req.query.status || "");
    const db = await getDb();
    const params = [req.session.user.id];
    let sql = "SELECT * FROM movies WHERE user_id = ?";

    if (STATUSES.includes(selectedStatus)) {
      sql += " AND status = ?";
      params.push(selectedStatus);
    }

    sql += " ORDER BY created_at DESC, id DESC";
    const movies = await db.all(sql, params);
    const counts = await db.all(
      "SELECT status, COUNT(*) AS count FROM movies WHERE user_id = ? GROUP BY status",
      req.session.user.id
    );

    res.render("movies", {
      movies,
      selectedStatus,
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      form: { title: "", year: "", status: "Want to Watch", rating: "" }
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/movies", requireAuth, async (req, res, next) => {
  try {
    const input = normalizeMovieInput(req.body);
    if (input.error) {
      const db = await getDb();
      const movies = await db.all(
        "SELECT * FROM movies WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        req.session.user.id
      );
      return res.status(400).render("movies", {
        movies,
        selectedStatus: "",
        counts: {},
        form: req.body,
        error: input.error
      });
    }

    const { title, year, status, rating } = input.movie;
    const db = await getDb();
    await db.run(
      "INSERT INTO movies (user_id, title, year, status, rating) VALUES (?, ?, ?, ?, ?)",
      req.session.user.id,
      title,
      year,
      status,
      rating
    );
    return res.redirect("/movies");
  } catch (error) {
    return next(error);
  }
});

app.post("/movies/:id/status", requireAuth, async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!STATUSES.includes(status)) {
      return res.redirect("/movies");
    }

    const db = await getDb();
    await db.run(
      "UPDATE movies SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
      status,
      req.params.id,
      req.session.user.id
    );
    return res.redirect(req.get("referer") || "/movies");
  } catch (error) {
    return next(error);
  }
});

app.post("/movies/:id/delete", requireAuth, async (req, res, next) => {
  try {
    const db = await getDb();
    await db.run("DELETE FROM movies WHERE id = ? AND user_id = ?", req.params.id, req.session.user.id);
    return res.redirect("/movies");
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render("error", { message: "Something went wrong." });
});

getDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Movie watchlist running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
