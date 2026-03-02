module.exports = {
  apps: [{
    name: 'restaurant-reporter',
    script: 'src/index.js',
    restart_delay: 5000,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
