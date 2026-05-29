const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const user = process.env.AUTH_USER || 'calmly';
const pass = process.env.AUTH_PASS;

if (!pass) {
  console.error('ERROR: AUTH_PASS environment variable is not set. Refusing to start without a password.');
  process.exit(1);
}

app.use(basicAuth({
  users: { [user]: pass },
  challenge: true,
  realm: 'TMTH Venture Studio'
}));

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
});
