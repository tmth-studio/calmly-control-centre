const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./studio-director-context');

const app = express();
const PORT = process.env.PORT || 3000;

const user = process.env.AUTH_USER || 'calmly';
const pass = process.env.AUTH_PASS;

if (!pass) {
  console.error('ERROR: AUTH_PASS environment variable is not set. Refusing to start without a password.');
  process.exit(1);
}

// Anthropic client — only if a key is present. Chat degrades gracefully without it.
const apiKey = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CHAT_MODEL || 'claude-sonnet-4-6';
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

app.use(basicAuth({
  users: { [user]: pass },
  challenge: true,
  realm: 'TMTH Venture Studio'
}));

app.use(express.json({ limit: '256kb' }));

// ─── Studio Director chat endpoint ───
// Body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }
app.post('/api/chat', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({
      error: 'Chat is not configured. Set ANTHROPIC_API_KEY on the server to enable the Studio Director.'
    });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Keep only role + string content, cap history to last 20 turns for cost control.
  const cleaned = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'last message must be from the user' });
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: cleaned
    });
    const text = (response.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
    res.json({ reply: text || 'Sorry, I had nothing to say to that.' });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'The Studio Director is unavailable right now. Try again in a moment.' });
  }
});

app.use(express.static(path.join(__dirname)));

// Clean URL support — serve .html files without extension
app.get('*', (req, res, next) => {
  const filePath = path.join(__dirname, req.path + '.html');
  res.sendFile(filePath, err => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`TMTH Venture Studio running on port ${PORT}`);
  console.log(`Studio Director chat: ${anthropic ? 'ENABLED (' + MODEL + ')' : 'DISABLED — set ANTHROPIC_API_KEY'}`);
});
