const multer = require('multer');

const errors = require('../core/common/errors');
const loggers = require('../core/common/loggers');

const _logger = loggers.get('PARSE-MULTIPART');

const options = {
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE, 10),
  },
  storage: multer.memoryStorage()
};
const mupload = multer(options).any();

// Extracts file objects from multipart requests.
const parse = (req, res, next) => {
  mupload(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(new errors.BadRequestError('FILE_TOO_LARGE'));
      } else {
        next(error);
      }
    } else {
      next();
    }
  });
};

module.exports = parse;
