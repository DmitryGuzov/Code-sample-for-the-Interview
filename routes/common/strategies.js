const Promise = require('bluebird');
const logger = require('../../core/common/loggers').get('AUTHN');
const tokens = require('../../core/tools/tokens');
const User = require('../../core/models/user');

// Authenticates the given request.
const withToken = (req) => {
  // There is an Authorization header.
  if (!req.headers || !req.headers.authorization) {
    logger.error('Failed to find the Authorization header.');
    return false;
  }
  // In the form of 'Bearer [token]'.
  const parts = req.headers.authorization.split(' ');
  if (parts.length !== 2) {
    logger.error('Failed to parse the Authorization header.');
    return false;
  }
  const scheme = parts[0];
  const token = parts[1];
  if (!/^Bearer$/i.test(scheme)) {
    logger.error('Failed to validate the Authorization header.');
    return false;
  }
  // Verify the token.
  return Promise.try(() => {
    return tokens.verify(token);
  })
    .then((decoded) => {
      return User.findOne({
        _id: decoded.id,
      });
    })
    .then((user) => {
      if (!user) {
        return false;
      }
      req.pod = req.pod || {};
      req.pod.accessor = user;
      return true;
    })
    .catch((error) => {
      logger.error('Failed to verify the token.', error);
      return false;
    });
};
const withoutToken = async (req) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    logger.error(`User not found`);
    return false;
  }

  req.pod = req.pod || {};
  req.pod.accessor = user;
  return true;
};

module.exports = {
  withToken,
  withoutToken,
};
