const validations = require('../core/common/validations');

const create = {
  body: {
    numOfTickets: validations.number().required(),
    prizeType: validations
      .string()
      .valid('raffle', 'prize', 'fixedOdds')
      .required(),
    prizeId: validations.string().allow(null),
    bonus: validations.boolean(),
  },
};

const verify3dsUnAuth = {
  body: {
    ...verify3ds.body,
    email: validations.string().required(),
  },
};

module.exports = {
  create,
  verify3dsUnAuth,
};
