const express = require('express');

const lift = require('../middlewares/lift-http');
const respond = require('../middlewares/respond');
const validate = require('../middlewares/validate');
const authenticate = require('../middlewares/authenticate');
const strategies = require('./common/strategies');

const blueprint = require('../blueprints/orders');
const method = require('../core/methods/orders');

const validatePaymentWith3ds = require('../middlewares/validatePaymentWith3ds');

const router = express.Router();

router
  .route('/verify3dsUnAuth')
  .post(
    validate(blueprint.verify3dsUnAuth),
    authenticate(strategies.withoutToken),
    validatePaymentWith3ds(),
    lift(method.verify),
    respond
  );

router
  .route('/')
  .post(
    validate(blueprint.create),
    authenticate(strategies.withToken),
    lift(method.create),
    respond
  );
