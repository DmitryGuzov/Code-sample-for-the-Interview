const Promise = require('bluebird');

const errors = require('../core/common/errors');
const logger = require('../core/common/loggers').get('SYSTEM');
const payMethod = require('../core/methods/payment');

const validatePaymentWith3ds = () => {
    return (req, res, next) => {
        return Promise.try(() => {
            return payMethod.approve3ds(req.body.id3ds);
        }).then((result) => {
            if (result.approved) {
                req.body.reference = result.data.reference;
                req.body.payment_id = result.data.id;
                next();
            } else {
                res.send(result.data);
            };
            return null;
        }).catch((error) => {
            logger.error('Failed to validate payment.', error);
            next(new errors.BadRequestError(JSON.stringify(error)));
        });
    };
};

module.exports = validatePaymentWith3ds;