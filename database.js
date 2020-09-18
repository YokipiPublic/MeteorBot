'use strict';

const Sequelize = require('sequelize');

// Production or Development?
const env = process.env.NODE_ENV || 'dev';

// Load environment variables
if (env === 'dev') {
  require('dotenv').config();
}

const db = {};

// Connect to database
const sequelize_options = {
    host: 'localhost',
    dialect: 'sqlite',
    logging: false,
    dialectOptions: {
      charset: 'utf8',
      collate: 'utf8_general_ci',
    }
  };
sequelize_options.storage = env === 'dev' ?
    process.env.DEV_DATABASE_URL : process.env.DATABASE_URL;
const sequelize = new Sequelize('database', 'user', 'password', sequelize_options);

// Create models
db.users = sequelize.define('users', {
  discord_id: {
    type: Sequelize.STRING,
    unique: true,
  },
  amq_name: {
    type: Sequelize.STRING,
    unique: true,
  },
  lowercase_name: {
    type: Sequelize.STRING,
    unique: true,
  },
  banned: {
    type: Sequelize.BOOLEAN,
    defaultValue: '0',
  },
}, {
  underscored: true,
});

db.queues = sequelize.define('queues', {
  name: {
    type: Sequelize.STRING,
    unique: true,
  },
  lowercase_name: {
    type: Sequelize.STRING,
    unique: true,
  },
  expired: {
    type: Sequelize.BOOLEAN,
    defaultValue: '0',
  },
  message_id: {
    type: Sequelize.STRING,
  },
  reaction: {
    type: Sequelize.STRING,
  },
  realtime_reward_role: {
    type: Sequelize.STRING,
  },
  custom_reward_role: {
    type: Sequelize.STRING,
  },
  required_role: {
    type: Sequelize.STRING,
  },
}, {
  underscored: true,
});

db.tournaments = sequelize.define('tournaments', {
  name: {
    type: Sequelize.STRING,
    unique: true,
  },
  required_role: {
    type: Sequelize.STRING,
  },
}, {
  underscored: true,
});

db.lfm_users = sequelize.define('lfm_users', {
  timestamp: {
    type: Sequelize.DATE,
  },
}, {
  underscored: true,
});

db.matches = sequelize.define('matches', {
  timestamp: {
    type: Sequelize.DATE,
  },
  result: {
    type: Sequelize.STRING,
  },
  rating_change1: {
    type: Sequelize.INTEGER,
  },
  rating_change2: {
    type: Sequelize.INTEGER,
  },
  rank1: {
    type: Sequelize.STRING,
  },
  rank2: {
    type: Sequelize.STRING,
  },
}, {
  underscored: true,
});

db.match_confirmations = sequelize.define('match_confirmations', {
  author_id: {
    type: Sequelize.STRING,
  },
  message_id: {
    type: Sequelize.STRING,
  },
  result: {
    type: Sequelize.STRING,
  },
}, {
  underscored: true,
});

db.autoqueues = sequelize.define('autoqueues', {
}, {
  underscored: true,
});

db.user_ratings = sequelize.define('user_ratings', {
  rating: {
    type: Sequelize.INTEGER,
    defaultValue: '1500',
  },
  wins: {
    type: Sequelize.INTEGER,
    defaultValue: '0',
  },
  draws: {
    type: Sequelize.INTEGER,
    defaultValue: '0',
  },
  losses: {
    type: Sequelize.INTEGER,
    defaultValue: '0',
  },
  aborts: {
    type: Sequelize.INTEGER,
    defaultValue: '0',
  },
  peak_rating: {
    type: Sequelize.INTEGER,
    defaultValue: '1500',
  },
}, {
  underscored: true,
});

db.lfm_users.belongsTo(db.users);
db.lfm_users.belongsTo(db.queues);
db.matches.belongsTo(db.users, {as: 'user1'});
db.matches.belongsTo(db.users, {as: 'user2'});
db.matches.belongsTo(db.queues);
db.match_confirmations.belongsTo(db.matches);
db.autoqueues.belongsTo(db.users);
db.autoqueues.belongsTo(db.queues);
db.users.belongsToMany(db.queues, {through: db.user_ratings});
db.queues.belongsToMany(db.users, {through: db.user_ratings});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;