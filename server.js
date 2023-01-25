const mongoose = require('mongoose');
const path = require('path');
const util = require('util');

require('dotenv').config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'production'}`) })
const app = require('./app');
const blueprint = require('./blueprints/env');
const dblogger = require('./core/common/loggers').get('DB');
const logger = require('./core/common/loggers').get('SYSTEM');
logger.info(`--------${process.env.NODE_ENV}---------`);

const validations = require('./core/common/validations');

mongoose.Promise = require('bluebird');

//Validate the environment.
const result = validations.validate(process.env, blueprint);
if (result.error) {
  logger.error(`The environment is invalid (cause: ${result.error.details[0].message}).`);
  process.exit(1);
}

// Load all models.
require('./core/models/index');

// Load all loaders.
require('./core/loaders/index');

// Load all workers.
require('./core/workers/index');

// Connect to the database.
const auth = process.env.MONGODB_USER || process.env.MONGODB_PASSWORD ? `${process.env.MONGODB_USER}:${process.env.MONGODB_PASSWORD}` : '';
const host = process.env.MONGODB_HOST;
const name = process.env.MONGODB_NAME;
const uri = `mongodb+srv://${auth}@${host}/${name}`; 

mongoose.connect(uri, { useCreateIndex: true, useNewUrlParser: true, useUnifiedTopology: true, poolSize: process.env.MONGODB_POOL_SIZE} ).then(() => {
  logger.info(`System connected to the database @ ${process.env.MONGODB_HOST}/${process.env.MONGODB_NAME} .`);
}).catch((error) => {
  logger.error(`System failed to connect to the database.`,  JSON.stringify(error));
});


// Log more details when the log level is debug.
if (process.env.LOG_LEVEL === 'debug') {
  mongoose.set('debug', (collection, method, query, doc) => {
    const iquery = util.inspect(query, false, 30);
    const idoc = util.inspect(doc, false, 30);
    dblogger.debug(`${collection}.${method} ${iquery} ${idoc}`);
  });
}

if (!module.parent) {

  let server = app.listen(process.env.PORT,() => {
    logger.info(`Server started in ${process.env.NODE_ENV} mode on port ${process.env.PORT}.`);
  });
  server.timeout = 5000000
}

module.exports = app;
