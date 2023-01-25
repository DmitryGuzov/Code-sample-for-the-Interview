module.exports = {
  apps: [
    {
      name: 'project',
      script: 'server.js',
      exec_mode: 'cluster',
      //args: '',
      node_args: '--max-old-space-size=2048 -r dotenv/config',
      instances: 1,
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm',
      error_file: `./.pm2/logs/project-errors.log`,
      out_file: `./.pm2/logs/project-stdout.log`,
      max_memory_restart: '4100M',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'development',
        watch: true,
      },
      env_staging: {
        NODE_ENV: 'staging',
        watch: false,
      },
      env_fargate: {
        NODE_ENV: 'fargate',
        watch: false,
      },
      env_production: {
        NODE_ENV: 'production',
        watch: false,
      },
      env_prod: {
        NODE_ENV: 'prod',
        watch: false,
      },
    },
  ],
};
