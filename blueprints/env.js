const validations = require('../core/common/validations');

const env = validations.object({
  API_BASE_URL: validations.string().uri().required(),
  HOST: validations.string().ip().required(),
  LOG_LEVEL: validations.string().allow([
    'debug',
    'error',
    'info',
    'warn'
  ]).required(),
  MAX_FILE_SIZE: validations.number().integer().required(),
  MAX_REQUEST_BODY_SIZE: validations.number().integer().required(),
  MANDRILL_API_KEY: validations.string().optional().empty(''),
  MONGODB_HOST: validations.string().hostname().required(),
  MONGODB_NAME: validations.string().required(),
  MONGODB_PASSWORD: validations.string().optional().empty(''),
  MONGODB_PORT: validations.number().required(),
  MONGODB_USER: validations.string().optional().empty(''),
  MONGODB_POOL_SIZE: validations.number().required(),
  NODE_ENV: validations.string().allow([
    'development',
    'production',
    'staging',
    'fargate',
    'prod',
    'adminProduction',
    'test'
  ]).required(),
  PORT: validations.number().required(),
  SECRET_KEY: validations.string().required(),
  AXCESSMS_HOST: validations.string().optional().empty(''),
  AXCESSMS_USERID: validations.string().optional().empty(''),
  AXCESSMS_PASSWORD: validations.string().optional().empty(''),
  AXCESSMS_ENTITYID: validations.string().optional().empty(''),
  MAILGUN_API_KEY: validations.string().optional().empty(''),
  MAILGUN_DOMAIN: validations.string().optional().empty(''),
  MAIL_DRIVER: validations.string().optional().empty(''),
  MAIL_FROM_NAME: validations.string().optional().empty(''),
  AWS_ACCESS_KEY: validations.string().required(),
  AWS_SECRET_KEY: validations.string().required(),
  AWS_BUCKET_NAME: validations.string().required(),
  AWS_S3_URL: validations.string().required(),
}).unknown().required();

module.exports = env;
