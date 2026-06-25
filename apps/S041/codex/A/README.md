# Express FAQ Editor

A Node.js/Express FAQ app with a public FAQ page, keyword filtering, category grouping, and a password-protected editor for adding, editing, deleting, and ordering questions.

## Run locally on port 5041

```bash
npm install
npm start
```

Open `http://localhost:5041`.

The app uses SQLite and creates `faq.sqlite` automatically on first start. Default editor credentials are:

- Username: `editor`
- Password: `password`

You can override local settings with environment variables:

```bash
PORT=5041 EDITOR_USER=editor EDITOR_PASSWORD=password SESSION_SECRET=replace-me npm start
```

