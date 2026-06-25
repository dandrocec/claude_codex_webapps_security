const express = require('express');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 5005;

app.use(express.static('public'));
app.use(express.json({ limit: '1mb' }));

marked.setOptions({
  breaks: true,
  gfm: true
});

app.post('/render', (req, res) => {
  const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
  const html = marked.parse(markdown);

  res.json({ html });
});

app.listen(PORT, () => {
  console.log(`Markdown preview app running on http://localhost:${PORT}`);
});
