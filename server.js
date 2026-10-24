const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
require('./src/db'); // creates tables on first run

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// The pages use inline onclick="" handlers and Google Fonts, so the policy allows exactly that and nothing more.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    version: '2.0',
    ai: config.modelServiceUrl ? 'notebook-model' : 'local-vision',
    model_service: !!config.modelServiceUrl,
    care: config.googlePlacesKey ? 'google+osm' : 'osm',
  })
);
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/analysis', require('./src/routes/analysis'));
app.use('/api/care', require('./src/routes/care'));
app.use('/api/journal', require('./src/routes/journal'));
app.use('/api/trek', require('./src/routes/trek'));
app.use('/api/appointments', require('./src/routes/appointments'));
app.use('/api', require('./src/routes/products'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, 'public')));

// Central error handler: friendly messages for expected errors, no stack traces to the client.
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image is too large (max 5 MB).' });
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That already exists.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side.' : err.message });
});

app.listen(config.port, () => {
  console.log(`SkinSakhi running at http://localhost:${config.port}`);
  console.log(
    config.modelServiceUrl
      ? `AI analysis: notebook model service at ${config.modelServiceUrl}`
      : 'AI analysis: local vision engine (set MODEL_SERVICE_URL to use the .keras models)'
  );
  console.log(`Care finder: ${config.googlePlacesKey ? 'Google Places + OpenStreetMap' : 'OpenStreetMap (no API key needed)'}`);
});
