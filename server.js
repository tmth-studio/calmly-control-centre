const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

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

// ─── Role registry ───
// Each role module exports { SYSTEM_PROMPT }. Add a role here to expose it.
const ROLES = {
  'studio-director': { label: 'Studio Director', prompt: require('./studio-director-context').SYSTEM_PROMPT },
  'cos':             { label: 'Chief of Staff',  prompt: require('./cos-context').SYSTEM_PROMPT },
  'cfo':             { label: 'CFO',              prompt: require('./cfo-context').SYSTEM_PROMPT },
  'property':        { label: 'Head of Property', prompt: require('./property-context').SYSTEM_PROMPT },
};

app.use(basicAuth({
  users: { [user]: pass },
  challenge: true,
  realm: 'TMTH Venture Studio'
}));

app.use(express.json({ limit: '256kb' }));

// ─── Shared chat handler ───
// Body: { messages: [{ role: 'user'|'assistant', content: string }, ...] }
async function handleChat(roleKey, req, res) {
  const role = ROLES[roleKey];
  if (!role) {
    return res.status(404).json({ error: `Unknown role "${roleKey}".` });
  }
  if (!anthropic) {
    return res.status(503).json({
      error: 'Chat is not configured. Set ANTHROPIC_API_KEY on the server to enable the team.'
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
      system: role.prompt,
      messages: cleaned
    });
    const text = (response.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
    res.json({ reply: text || 'Sorry, I had nothing to say to that.' });
  } catch (err) {
    console.error(`Chat error (${roleKey}):`, err.message);
    res.status(500).json({ error: `${role.label} is unavailable right now. Try again in a moment.` });
  }
}

// Role-specific endpoint: /api/chat/cos, /api/chat/cfo, /api/chat/property, /api/chat/studio-director
app.post('/api/chat/:role', (req, res) => handleChat(req.params.role, req, res));

// Backward-compatible default (studio-director.html posts here)
app.post('/api/chat', (req, res) => handleChat('studio-director', req, res));

// Clean URLs for the shared role-chat page: /cos /cfo /property -> role-chat.html
app.get(['/cos', '/cfo', '/property'], (req, res) => {
  res.sendFile(path.join(__dirname, 'role-chat.html'));
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
  console.log(`Team chat: ${anthropic ? 'ENABLED (' + MODEL + ') — roles: ' + Object.keys(ROLES).join(', ') : 'DISABLED — set ANTHROPIC_API_KEY'}`);
});
