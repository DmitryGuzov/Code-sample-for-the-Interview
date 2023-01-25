const Joi = require('joi');

const customJoi = Joi.extend({
  base: Joi.string().regex(/^[0-9a-fA-F]{24}$/),
  name: 'objectId'
});


module.exports = customJoi
