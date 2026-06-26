const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const { nanoid } = require("nanoid");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 5055);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: path.join(__dirname, "..", "data") }),
    secret: process.env.SESSION_SECRET || "local-development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.error = null;
  res.locals.notice = null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function getSurveyForUser(id, userId) {
  return db.prepare("SELECT * FROM surveys WHERE id = ? AND user_id = ?").get(id, userId);
}

function getQuestions(surveyId) {
  return db.prepare("SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order, id").all(surveyId);
}

app.get("/", (req, res) => {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }
  res.render("home");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || password.length < 6) {
    return res.status(400).render("register", { error: "Use an email and a password with at least 6 characters." });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  try {
    const result = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, passwordHash);
    req.session.user = { id: result.lastInsertRowid, email };
    res.redirect("/dashboard");
  } catch (error) {
    res.status(409).render("register", { error: "An account with that email already exists." });
  }
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render("login", { error: "Invalid email or password." });
  }

  req.session.user = { id: user.id, email: user.email };
  res.redirect("/dashboard");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/dashboard", requireAuth, (req, res) => {
  const surveys = db
    .prepare(
      `SELECT surveys.*,
        COUNT(DISTINCT responses.id) AS response_count,
        COUNT(DISTINCT questions.id) AS question_count
       FROM surveys
       LEFT JOIN responses ON responses.survey_id = surveys.id
       LEFT JOIN questions ON questions.survey_id = surveys.id
       WHERE surveys.user_id = ?
       GROUP BY surveys.id
       ORDER BY surveys.created_at DESC`
    )
    .all(req.session.user.id);
  res.render("dashboard", { surveys });
});

app.get("/surveys/new", requireAuth, (req, res) => {
  res.render("survey_form", { form: {}, questions: [{ prompt: "", question_type: "text", required: true }] });
});

app.post("/surveys", requireAuth, (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const prompts = Array.isArray(req.body.prompt) ? req.body.prompt : [req.body.prompt];
  const types = Array.isArray(req.body.question_type) ? req.body.question_type : [req.body.question_type];
  const requiredValues = new Set(Array.isArray(req.body.required) ? req.body.required : [req.body.required].filter(Boolean));

  const questions = prompts
    .map((prompt, index) => ({
      prompt: String(prompt || "").trim(),
      question_type: types[index] === "textarea" ? "textarea" : "text",
      required: requiredValues.has(String(index))
    }))
    .filter((question) => question.prompt);

  if (!title || questions.length === 0) {
    return res.status(400).render("survey_form", {
      error: "Add a survey title and at least one question.",
      form: { title, description },
      questions: questions.length ? questions : [{ prompt: "", question_type: "text", required: true }]
    });
  }

  const createSurvey = db.transaction(() => {
    const slug = nanoid(10);
    const result = db
      .prepare("INSERT INTO surveys (user_id, slug, title, description) VALUES (?, ?, ?, ?)")
      .run(req.session.user.id, slug, title, description);

    const insertQuestion = db.prepare(
      "INSERT INTO questions (survey_id, prompt, question_type, sort_order, required) VALUES (?, ?, ?, ?, ?)"
    );
    questions.forEach((question, index) => {
      insertQuestion.run(result.lastInsertRowid, question.prompt, question.question_type, index + 1, question.required ? 1 : 0);
    });
    return result.lastInsertRowid;
  });

  const surveyId = createSurvey();
  res.redirect(`/surveys/${surveyId}`);
});

app.get("/surveys/:id", requireAuth, (req, res) => {
  const survey = getSurveyForUser(req.params.id, req.session.user.id);
  if (!survey) {
    return res.status(404).render("not_found");
  }

  const questions = getQuestions(survey.id);
  const responses = db.prepare("SELECT * FROM responses WHERE survey_id = ? ORDER BY submitted_at DESC").all(survey.id);
  const answers = db
    .prepare(
      `SELECT answers.response_id, answers.question_id, answers.answer_text
       FROM answers
       JOIN responses ON responses.id = answers.response_id
       WHERE responses.survey_id = ?`
    )
    .all(survey.id);

  const answerMap = new Map();
  answers.forEach((answer) => {
    answerMap.set(`${answer.response_id}:${answer.question_id}`, answer.answer_text);
  });

  res.render("survey_detail", { survey, questions, responses, answerMap });
});

app.get("/s/:slug", (req, res) => {
  const survey = db.prepare("SELECT * FROM surveys WHERE slug = ?").get(req.params.slug);
  if (!survey) {
    return res.status(404).render("not_found");
  }
  res.render("public_survey", { survey, questions: getQuestions(survey.id), values: {} });
});

app.post("/s/:slug", (req, res) => {
  const survey = db.prepare("SELECT * FROM surveys WHERE slug = ?").get(req.params.slug);
  if (!survey) {
    return res.status(404).render("not_found");
  }

  const questions = getQuestions(survey.id);
  const values = {};
  const missingRequired = questions.some((question) => {
    const answer = String(req.body[`q_${question.id}`] || "").trim();
    values[`q_${question.id}`] = answer;
    return question.required && !answer;
  });

  if (missingRequired) {
    return res.status(400).render("public_survey", {
      survey,
      questions,
      values,
      error: "Please answer all required questions."
    });
  }

  db.transaction(() => {
    const response = db.prepare("INSERT INTO responses (survey_id) VALUES (?)").run(survey.id);
    const insertAnswer = db.prepare("INSERT INTO answers (response_id, question_id, answer_text) VALUES (?, ?, ?)");
    questions.forEach((question) => {
      insertAnswer.run(response.lastInsertRowid, question.id, values[`q_${question.id}`] || "");
    });
  })();

  res.render("thanks", { survey });
});

app.use((req, res) => {
  res.status(404).render("not_found");
});

app.listen(PORT, () => {
  console.log(`Survey builder running at http://localhost:${PORT}`);
});
