// Local development / any normal Node host: serves the API *and* the frontend on one port.
const path = require('path');
const express = require('express');
const app = require('./app');
const { env } = require('./config/env');

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: 'index.html' }));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(env.PORT, () => {
  console.log(`\nNew Brahmani Beauty World is running:  http://localhost:${env.PORT}\n`);
});
