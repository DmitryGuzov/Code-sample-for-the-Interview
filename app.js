const bodyParser = require('body-parser');
const compress = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const expressWinston = require('express-winston');
const helmet = require('helmet');
const morgan = require('morgan');

const errors = require('./core/common/errors');
const handle = require('./middlewares/handle-errors');
const logger = require('./core/common/loggers').get('HTTP');
const routes = require('./routes/index');

const app = express();

// Log more details when the log level is debug.
if (process.env.LOG_LEVEL === 'debug') {
  // Log HTTP requests & responses.
  app.use(morgan('dev'));
  // Verbose winston logging.
  expressWinston.requestWhitelist.push('body');
  expressWinston.responseWhitelist.push('body');
  app.use(
    expressWinston.logger({
      winstonInstance: logger,
      meta: true,
      msg: 'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
      colorStatus: true,
      responseFilter: (res, propName) => {
        const contentType = res.get('Content-Type');

        // If the response is an image, avoid logging binary data.
        if (
          contentType &&
          contentType.startsWith('image') &&
          propName === 'body'
        ) {
          return '<image omitted>';
        }

        // Log normally.
        return res[propName];
      },
    })
  );
}

// Parse body parameters and attach them to req.body.
const limit = `${process.env.MAX_REQUEST_BODY_SIZE}kb`;
app.use(bodyParser.json({ limit }));
app.use(bodyParser.urlencoded({ extended: true, limit }));

app.use(cookieParser());
app.use(compress());

// Secure the application by setting various HTTP headers.
app.use(helmet());

// Enable CORS (Cross Origin Resource Sharing).
app.use(cors());

// Mount application routes on /api path.
app.use('/api', routes);

// Mount hooks on /hooks path.
app.use('/static', express.static(__dirname + '/static'));
// Catch requests to unknown endpoints, and forward them to the error handler.
app.use('/', (req, _res, _next) => {
  _res.send('Healthy');
});
app.use((req, _res, _next) => {
  throw new errors.NotFoundError(`Nothing to ${req.method} @ ${req.url}.`);
});

// Set the error handler.
app.use(handle);

module.exports = app;
