const request = require('request-promise');
const logger = require('../common/loggers').get('SYSTEM');
const errors = require('../common/errors');

const approve3ds = async (id3ds) => {
  const url = process.env.STATUS_3DS_URL + id3ds;
  const options = {
    method: 'GET',
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.CHECK_OUT_SECRET_KEY,
    },
  };
  try {
    const result = await request(options);
    const parsedResult = JSON.parse(result);
    logger.info(
      `Check 3ds, order - ${parsedResult.reference}, approved - ${parsedResult.approved} `
    );

    if (parsedResult.approved) {
      return {
        approved: true,
        data: parsedResult,
      };
    } else {
      logger.info(`Payment with 3ds is not approved - ${result}`);
      return {
        approved: false,
        data: parsedResult,
      };
    }
  } catch (err) {
    logger.error(`Something went wrong in approve3ds.`, JSON.stringify(err));
    throw new errors.BadRequestError(
      `Something went wrong in approve3ds.`,
      JSON.stringify(err)
    );
  }
};

module.exports = {
  approve3ds,
};
