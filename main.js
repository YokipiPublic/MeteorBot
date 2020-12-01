'use strict';

const Discord = require('discord.js');
const db = require('./database.js');
const err = require('./error_messages.js');
const dbc = require('./database_commands.js');
const helper = require('./helper.js');
const lists = require('./lists.js');
const fs = require('fs');
const blossom = require('edmonds-blossom');

// Production or Development?
const env = process.env.NODE_ENV || 'dev';

// Load environment variables
if (env === 'dev') {
  require('dotenv').config();
}

// Load settings from config.json
const config_file = './config.json';
const config = JSON.parse(fs.readFileSync(config_file));

// Initialize client
const client = new Discord.Client({ partials: ['MESSAGE', 'REACTION'] });

// Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// On connect
client.once('ready', () => {
  console.log('Connected');
  console.log(`Logged in as: ${client.user.tag}`);

  // Sync to database
  db.sequelize.sync();
  console.log('Database synced');

  // Start printing leaderboards
  const ttn_hour = new Date().setMinutes(60) - new Date().getTime();
  console.log(`Printing first leaderboards in ${ttn_hour}`);
  setTimeout(leaderboards_print_loop, ttn_hour, config.leaderboards_print_interval);

  // Start periodic matchmaking attempts
  try_matchmaking_loop();
});

// Following are case-functions for bot-commands in main loop
async function case_register(message, args, flags, guild, member) {
  // Check if user associated with this Discord ID already exists
  const user = await db.users.findOne({
    where: {discord_id: message.author.id}
  });

  // If not, create it
  if (user === null) {
    db.users.create({
      discord_id: message.author.id,
      amq_name: args[0],
      lowercase_name: args[0].toLowerCase()
    }).then((row) => {
      member.roles.add(config.tourney_role);
      console.log(`${args[0]} registered`);
      message.reply(`${args[0]} successfully registered. ` +
          'Please use `m!list <List URL>` to have your list verified ' +
          'if you would like to participate in list formats. ' +
          'This can be sent to the bot via DM.');
    }).catch((e) => {
      if (e.name === 'SequelizeUniqueConstraintError') {
        if(e.fields.includes('amq_name')) {
          return message.channel.send('This AMQ username is already registered.');
        }
      }
      console.log(e.name);
      console.log(e.message);
      return message.channel.send('Error during registration.');
    });

  // If found, update it
  } else {
    user.update({
      amq_name: args[0],
      lowercase_name: args[0].toLowerCase()
    }).then((row) => {
      console.log(`Registration changed to ${args[0]}`);
      message.reply(`Registered AMQ username changed to ${args[0]}.`);
    }).catch((e) => {
      if (e.name === 'SequelizeUniqueConstraintError') {
        if(e.fields.includes('amq_name')) {
          return message.channel.send('This AMQ username is already registered.');
        }
      }
      console.log(e.name);
      console.log(e.message);
      return message.channel.send('Error during registration.');
    });
  }
}

async function case_changediscord(message, args, flags, guild, member) {
  // Find associated user
  const user = await db.users.findOne({
    where: {discord_id: args[0]}
  });

  // If not found
  if (user === null) {
    return message.channel.send('User not found.');
  // If found, update it
  } else {
    user.update({
      discord_id: args[1],
    }).then((row) => {
      return message.channel.send(`Discord ID successfully changed.`);
    }).catch((e) => {
      if (e.name === 'SequelizeUniqueConstraintError') {
        if(e.fields.includes('discord_id')) {
          return message.channel.send('This Discord ID is already registered.');
        }
      }
      console.log(e.name);
      console.log(e.message);
      return message.channel.send('Error during Discord ID change.');
    });
  }
}

async function case_registerlist(message, args, flags, guild, member) {
  const user = await db.users.findOne({
    where: {discord_id: message.author.id}
  });

  // If message author user not found
  if (!user) {
    return message.channel.send('You must register first. ' +
        'Please reply with `m!register <AMQ Username>` in order to register.');
  }

  // Check if enclosed in angle brackets
  let list_url = args[0];
  if (list_url.startsWith('<') && list_url.endsWith('>')) {
    list_url = list_url.slice(1, -1);
  }

  // Send embed to approvals channel
  const embed = new Discord.MessageEmbed()
    .setTitle(args[0])
    .setColor('#2ce660')
    .setURL(list_url)
    .setDescription(`${message.author.username} (${user.amq_name}) ` +
        `is requesting list approval`);
  client.channels.cache.get(config.approvals_channel).send(embed).then((msg) => {
    message.channel.send('List approval requested.');
  }).catch((e) => {
    message.channel.send('Error requesting list approval. List must be a valid URL ' +
        'including the http:// at the start.');
  });
}

async function case_rejectlist(message, args, flags, guild, member) {
  const user = await db.users.findOne({
    where: {lowercase_name: args[0].toLowerCase()}
  });

  // If user not found via AMQ name
  if (!user) {
    return message.channel.send('User with AMQ name given not found.');
  }

  // Send message to requester
  guild.members.fetch(user.discord_id)
    .then(console.log)
    .catch(console.error);
  const listuser = await guild.members.fetch(user.discord_id);
  if (listuser === undefined) {
    message.channel.send("Could not find user from ID.");
    return;
  }
  listuser.send('Your list did not meet the standards of the server ' +
      'and thereby has been rejected.');
  if (args.length === 2) listuser.send(`Included message: ${args[1]}`);
  listuser.send(`Please contact ${client.users.cache.get(config.list_mogul_id)} ` +
      `for further details.`);

  // Send message to moderator
  message.channel.send('Rejection message sent to user.');
}

async function case_acceptlist(message, args, flags, guild, member) {
  const user = await db.users.findOne({
    where: {lowercase_name: args[0].toLowerCase()}
  });

  // If user not found via AMQ name
  if (!user) {
    return message.channel.send('User with AMQ name given not found.');
  }

  // Send message to requester
  const listuser = await guild.members.fetch(user.discord_id);
  if (listuser === undefined) {
    message.channel.send("Could not find user from ID.");
    return;
  }
  listuser.send('Your list has been approved. Congratulations.');
  if (args.length === 2) listuser.send(`Included message: ${args[1]}`);
  listuser.roles.add(config.list_role);

  // Send message to moderator
  message.channel.send('Acceptance message sent to user.');
}

async function case_signup(message, args, flags, guild, member) {
  // Fetch user
  const user = await db.users.findOne({
    where: {discord_id: message.author.id}
  });

  // If message author user not found
  if (!user) {
    return message.channel.send('You must register first. ' +
        'Please reply with `m!register <AMQ Username>` in order to register.');
  }

  // Fetch tournament
  const tournament = await db.tournaments.findOne({
    where: {name: args[0]}
  });

  // If tournament not found
  if (!tournament) {
    return message.channel.send('This tournament does not exist.');
  }

  // Verify that user has necessary role
  if (tournament.required_role !== null) {
    if (!member.roles.cache.has(tournament.required_role)) {
      return message.channel.send(
        'Your list must be approved first before playing in this tournament. ' +
        'Please request approval with `m!registerlist <List URL>` ' +
        'if you have not already done so.');
    }
  }

  // Calculate average elo
  let average_elo = 0;
  const ratings_rows = await db.queues.findAll({
    where: {expired: 0},
    include: [{
      model: db.users,
      where: {discord_id: message.author.id},
      through: {
        attributes: ['rating']
      }
    }]
  });
  if (ratings_rows.length === 0) {
    average_elo = 1500;
  } else {
    for (let i = 0; i < ratings_rows.length; i++) {
      average_elo += ratings_rows[i].users[0].user_ratings.rating;
    }
    average_elo /= ratings_rows.length;
  }
  average_elo = Math.round(average_elo);

  // Send sign-up to tournaments channel
  client.channels.cache.get(config.tournaments_channel).send(
    `${user.amq_name} (${average_elo}) is registering for '${args[0]}'.` +
    (args.length > 1 ? ` Extra parameter: ${args[1]}` : 'Extra parameter: N/A')
  ).then((msg) => {
    message.channel.send('Tournament registration successful.');
  }).catch((e) => {
    message.channel.send('Error registering for tournament.');
  });
}

async function case_result(message, args, flags, guild, member) {
  // Fetch relevant match
  const match = await db.matches.findOne({
    where: {id: args[0]},
    include: [{
      model: db.users,
      as: 'user1'
    }, {
      model: db.users,
      as: 'user2'
    }, {
      model: db.queues
    }]
  });
  if (match === null) return message.channel.send(`Match with ID ${args[0]} not found.`);

  // Fetch players
  // TODO: Wait, there's no way this is necessary
  const user1 = await db.users.findOne({
    where: {id: match.user1.id},
    include: [{
      model: db.queues,
      where: {name: match.queue.name},
    }]
  });
  const user2 = await db.users.findOne({
    where: {id: match.user2.id},
    include: [{
      model: db.queues,
      where: {name: match.queue.name},
    }]
  });

  // Check if it's an 'undo' command
  const winner = args[1].toLowerCase();
  if (winner === 'undo') {
    if (!member.roles.cache.has(config.admin_role))
      return message.channel.send(err.insufficient_privilege);
    if (match.result === 'PENDING')
      return message.channel.send('This match hasn\'t been reported yet.');

    if (match.result === 'ABORT') {
      user1.queues[0].user_ratings.aborts -= 1;
      user1.queues[0].user_ratings.save();
      user2.queues[0].user_ratings.aborts -= 1;
      user2.queues[0].user_ratings.save();
    } else if (match.result === 'DRAW') {
      user1.queues[0].user_ratings.rating -= match.rating_change1;
      user1.queues[0].user_ratings.draws -= 1;
      user1.queues[0].user_ratings.save();
      user2.queues[0].user_ratings.rating -= match.rating_change2;
      user2.queues[0].user_ratings.draws -= 1;
      user2.queues[0].user_ratings.save();
    } else if (match.result === user1.lowercase_name) {
      user1.queues[0].user_ratings.rating -= match.rating_change1;
      user1.queues[0].user_ratings.wins -= 1;
      user1.queues[0].user_ratings.save();
      user2.queues[0].user_ratings.rating -= match.rating_change2;
      user2.queues[0].user_ratings.losses -= 1;
      user2.queues[0].user_ratings.save();
    } else if (match.result === user2.lowercase_name) {
      user1.queues[0].user_ratings.rating -= match.rating_change1;
      user1.queues[0].user_ratings.losses -= 1;
      user1.queues[0].user_ratings.save();
      user2.queues[0].user_ratings.rating -= match.rating_change2;
      user2.queues[0].user_ratings.wins -= 1;
      user2.queues[0].user_ratings.save();
    } else {
      // Something is terribly wrong
      return message.channel.send('Failed to undo match result.');
    }
    match.update({
      result: 'PENDING'
    });
    update_best_player(match.queue.id);
    return message.channel.send(`Result for Match ${args[0]} undone.`);
  }

  // Else, make sure that the message hasn't been reported already
  if (match.result !== 'PENDING')
    return message.channel.send('This match has already been reported. ' +
        'If there was a mistake, please notify a moderator ASAP.');

  // Delete row entirely
  if (winner === 'superabort') {
    if (!member.roles.cache.has(config.admin_role))
      return message.channel.send(err.insufficient_privilege);

    match.destroy();
    return message.channel.send(`Match ${args[0]} deleted.`);

  // Mark match as aborted
  } else if (winner === 'abort') {
    if (!member.roles.cache.has(config.admin_role))
      return message.channel.send(err.insufficient_privilege);

    match.update({
      result: 'ABORT',
      rating_change1: 0,
      rating_change2: 0
    });
    user1.queues[0].user_ratings.aborts += 1;
    user1.queues[0].user_ratings.save();
    user2.queues[0].user_ratings.aborts += 1;
    user2.queues[0].user_ratings.save();
    return message.channel.send(
      `${client.users.cache.get(user1.discord_id)} ` +
      `${client.users.cache.get(user2.discord_id)} ` +
      `Match ${args[0]} aborted.`);

  // Post confirmation message for draw or win
  } else if (winner === 'draw' || winner === 'tie' || winner === 'stalemate' ||
      winner === user1.lowercase_name || winner === user2.lowercase_name) {

    message.channel.send(`Report result of Match ${args[0]}: ` +
        `${user1.amq_name} vs. ${user2.amq_name} (${user1.queues[0].name}) ` +
        `as \`${args[1]}\`?`
    ).then((msg) => {
      // React
      msg.react('✅');
      msg.react('❌');

      // Create database entry for confirmation
      db.match_confirmations.create({
        author_id: message.author.id,
        message_id: msg.id,
        result: args[1]
      }).then((confirmation) => {
        confirmation.setMatch(match);
      });
    });

  // Not a valid entry
  } else {
    return message.channel.send('Please enter a valid result.');
  }
}

async function case_leaderboard(message, args, flags, guild, member) {
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Special case leaderboards
  // Total Games
  if (args[0].toLowerCase() === 'total games') {
    const user_rows = await db.users.findAll({
      include: [{
        model: db.queues,
        through: {
          attributes: ['wins', 'draws', 'losses']
        }
      }]
    });

    // Add WDL for each user
    let user_names = [];
    let user_games = [];
    for (let i = 0; i < user_rows.length; i++) {
      user_names[i] = user_rows[i].amq_name;
      user_games[i] = 0;
      for (let j = 0; j < user_rows[i].queues.length; j++) {
        user_games[i] += user_rows[i].queues[j].user_ratings.wins +
                          user_rows[i].queues[j].user_ratings.draws +
                          user_rows[i].queues[j].user_ratings.losses;
      }
    }

    // Sort both arrays by total games played, descending
    user_names = user_names.slice().sort((a, b) => {
      return user_games[user_names.indexOf(b)] - user_games[user_names.indexOf(a)];
    });
    user_games = user_games.slice().sort((a, b) => {
      return b - a;
    });

    // Print top 40 players
    const string_builder = [];
    string_builder.push('```diff');
    string_builder.push('- Total Games');
    string_builder.push('Name                    |Games')
    for (let i = 0; i < 40; i++) {
      string_builder.push(user_names[i].padEnd(25) + user_games[i].toString().padStart(5));
    }
    string_builder.push('```');
    return message.channel.send(string_builder.join('\n'));
  }

  // Check that queue exists
  const queue = await db.queues.findOne({
    where: {lowercase_name: args[0].toLowerCase()},
  });
  if (queue === null)
    return channel.send('Requested queue does not exist.');

  print_leaderboard(channel, queue.id, false);
}

async function case_profile(message, args, flags, guild, member) {
  // Check if '--full' flag is set
  const full = flags.includes('full');
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Fetch all queues of user, unsorted
  const ratings_rows_where = {};
  const ratings_rows_users_where = {};
  // If no argument supplied, search by author ID, otherwise use amq_name supplied
  if (args.length === 0) ratings_rows_users_where.discord_id = message.author.id;
  else ratings_rows_users_where.lowercase_name = args[0].toLowerCase();
  // If not 'full', ignore expired queues
  if (!full) ratings_rows_where.expired = 0;
  const ratings_rows = await db.queues.findAll({
    where: ratings_rows_where,
    include: [{
      model: db.users,
      where: ratings_rows_users_where,
      through: {
        attributes: ['rating', 'wins', 'draws', 'losses', 'aborts', 'peak_rating']
      }
    }],
    order: [
      ['id', 'ASC']
    ]
  });

  // If user has no ratings yet
  if (ratings_rows.length < 1) {
    return channel.send("This user has not played any games yet.");
  }

  // Calculate overall record and average elo
  let total_wins = 0;
  let total_draws = 0;
  let total_losses = 0;
  let average_elo = 0;
  for (let i = 0; i < ratings_rows.length; i++) {
    average_elo += ratings_rows[i].users[0].user_ratings.rating;
    total_wins += ratings_rows[i].users[0].user_ratings.wins;
    total_draws += ratings_rows[i].users[0].user_ratings.draws;
    total_losses += ratings_rows[i].users[0].user_ratings.losses;
  }
  average_elo /= ratings_rows.length;
  average_elo = Math.round(average_elo);
  let overall_winrate = (total_wins + 0.5*total_draws) /
      (total_wins + total_draws + total_losses);
  overall_winrate = isNaN(overall_winrate) ? 0 : Math.round(100 * overall_winrate);

  // Build string and print
  const string_builder = [];
  string_builder.push(ratings_rows[0].users[0].amq_name.padEnd(20) + ' ' + 
      average_elo.toString().padStart(4) + ' ' +
      (total_wins + '-' + total_draws + '-' + total_losses).padStart(11) + ' ' +
      overall_winrate.toString().padStart(3) + '%');
  string_builder.push('------------------------------------------'); // 42
  string_builder.push('Queue           |Elo |Peak|  W|  D|  L|  A');
  for (let i = 0; i < ratings_rows.length; i++) {
    const queue_rating = ratings_rows[i].users[0].user_ratings;
    string_builder.push(ratings_rows[i].name.padEnd(16) + ' ' +
          queue_rating.rating.toString().padStart(4) + ' ' +
          queue_rating.peak_rating.toString().padStart(4) + ' ' +
          queue_rating.wins.toString().padStart(3) + ' ' +
          queue_rating.draws.toString().padStart(3) + ' ' +
          queue_rating.losses.toString().padStart(3) + ' ' +
          queue_rating.aborts.toString().padStart(3));
  }
  while (string_builder.length > 0) {
    const string_builder_segment = string_builder.splice(0, 40);
    string_builder_segment.unshift('```');
    string_builder_segment.push('```');
    await channel.send(string_builder_segment.join('\n'));
  }
}

async function case_headtohead(message, args, flags, guild, member) {
  // Check if '--full' flag is set
  const full = flags.includes('full');
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Get all desired queues
  const queue_rows_where = {};
  if (!full) queue_rows_where.expired = 0;
  const queue_rows = await db.queues.findAll({
    where: queue_rows_where,
    order: [
      ['id', 'ASC']
    ]
  });

  // Get WDLA for all relevant queues
  const queue_data = [];
  let total_wins = 0;
  let total_draws = 0;
  let total_losses = 0;
  let total_elo_gl = 0;
  for (let i = 0; i < queue_rows.length; i++) {
    queue_data[i] = {};
    queue_data[i].name = queue_rows[i].name;
    const match_rows = await db.matches.findAll({
      where: {
        result: {[db.Sequelize.Op.ne]: 'PENDING'},
        [db.Sequelize.Op.or]: [
          {[db.Sequelize.Op.and]: [
            {'$user1.lowercase_name$': args[0].toLowerCase()},
            {'$user2.lowercase_name$': args[1].toLowerCase()}
          ]},
          {[db.Sequelize.Op.and]: [
            {'$user1.lowercase_name$': args[1].toLowerCase()},
            {'$user2.lowercase_name$': args[0].toLowerCase()}
          ]},
        ]
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues,
        where: {
          id: queue_rows[i].id
        }
      }]
    });

    queue_data[i].wins = 0;
    queue_data[i].draws = 0;
    queue_data[i].losses = 0;
    queue_data[i].aborts = 0;
    queue_data[i].elo_gl = 0;
    for (let j = 0; j < match_rows.length; j++) {
      if (match_rows[j].result === args[0].toLowerCase()) queue_data[i].wins++;
      else if (match_rows[j].result === 'DRAW') queue_data[i].draws++;
      else if (match_rows[j].result === args[1].toLowerCase()) queue_data[i].losses++;
      else if (match_rows[j].result === 'ABORT') queue_data[i].aborts++;
      else console.log('ERROR: Unexpected match result detected while checking hth');

      if (match_rows[j].result !== 'ABORT') {
        queue_data[i].elo_gl += 
            match_rows[j].user1.lowercase_name === args[0].toLowerCase() ?
            match_rows[j].rating_change1 : match_rows[j].rating_change2;
      }
    }

    total_wins += queue_data[i].wins;
    total_draws += queue_data[i].draws;
    total_losses += queue_data[i].losses;
    total_elo_gl += queue_data[i].elo_gl;
  }

  // Calculate overall winrate
  let overall_winrate = (total_wins + 0.5*total_draws) /
      (total_wins + total_draws + total_losses);
  overall_winrate = isNaN(overall_winrate) ? 0 : Math.round(100 * overall_winrate);

  // Build string and print
  const string_builder = [];
  string_builder.push(`${args[0]}'s record against ${args[1]}`);
  string_builder.push(
      ((total_elo_gl >= 0 ? '+' : '') + total_elo_gl).padStart(23) + ' ' +
      (total_wins + '-' + total_draws + '-' + total_losses).padStart(11) + ' ' +
      overall_winrate.toString().padStart(3) + '%');
  string_builder.push('----------------------------------------') // 40
  string_builder.push('Queue           |  W|  D|  L|  A|Elo +/-');
  for (let i = 0; i < queue_data.length; i++) {
    if (queue_data[i].wins + queue_data[i].draws +
        queue_data[i].losses + queue_data[i].aborts < 1) continue;

    string_builder.push(queue_data[i].name.padEnd(16) + ' ' +
          queue_data[i].wins.toString().padStart(3) + ' ' +
          queue_data[i].draws.toString().padStart(3) + ' ' +
          queue_data[i].losses.toString().padStart(3) + ' ' +
          queue_data[i].aborts.toString().padStart(3) + ' ' +
          ((queue_data[i].elo_gl >= 0 ? '+' : '') +
          queue_data[i].elo_gl).padStart(7));
  }
  while (string_builder.length > 0) {
    const string_builder_segment = string_builder.splice(0, 40);
    string_builder_segment.unshift('```');
    string_builder_segment.push('```');
    await channel.send(string_builder_segment.join('\n'));
  }
}

async function case_queued(message, args, flags, guild, member) {
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Fetch all lfms for user
  const lfm_rows = await db.lfm_users.findAll({
    include: [{
      model: db.users,
      where: {discord_id: message.author.id}
    }, {
      model: db.queues
    }]
  });

  // If user is not waiting in any queues
  if (lfm_rows.length < 1) {
    return channel.send("You are currently not waiting in any queues.");
  }

  // Build list of queued queues
  const string_builder = [];
  string_builder.push('```');
  for (let i = 0; i < lfm_rows.length; i++) {
    string_builder.push(lfm_rows[i].queue.name);
  }
  string_builder.push('```');
  channel.send('You are currently waiting in the following queues:');
  channel.send(string_builder.join('\n'));
}

async function case_pending(message, args, flags, guild, member) {
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Fetch all pending matches for user
  let match_rows;
  // If no argument supplied, search by author ID, otherwise use amq_name supplied
  if (args.length === 0) {
      match_rows = await db.matches.findAll({
      where: {
        result: 'PENDING',
        [db.Sequelize.Op.or]: [
          {'$user1.discord_id$': message.author.id},
          {'$user2.discord_id$': message.author.id}
        ]
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues,
      }],
      order: [
        ['id', 'ASC']
      ]
    });
    // If user has no pending matches
    if (match_rows.length < 1) {
      return channel.send('You currently have no games to play.');
    }

  } else {
    match_rows = await db.matches.findAll({
      where: {
        result: 'PENDING',
        [db.Sequelize.Op.or]: [
          {'$user1.lowercase_name$': args[0].toLowerCase()},
          {'$user2.lowercase_name$': args[0].toLowerCase()}
        ]
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues
      }],
      order: [
        ['id', 'ASC']
      ]
    });
    // If user has no pending matches
    if (match_rows.length < 1) {
      return channel.send('This user currently has no games to play.');
    }
  }

  // Build list of pending matches
  const string_builder = [];
  for (let i = 0; i < match_rows.length; i++) {
    const rank1_abbr = match_rows[i].rank1 === null ? '?' : 
        match_rows[i].rank1.substring(0, 1);
    const rank2_abbr = match_rows[i].rank2 === null ? '?' : 
        match_rows[i].rank2.substring(0, 1);
    let match_string = `ID# ${match_rows[i].id.toString().padStart(6)} - ` +
        `${match_rows[i].queue.name.padEnd(16)}: ` + 
        `${match_rows[i].user1.amq_name}(${rank1_abbr}) vs. ` +
        `${match_rows[i].user2.amq_name}(${rank2_abbr})`;
    if (flags.includes('deadlines')) {
      match_string = match_string.padEnd(75);
      if (!match_rows[i].timestamp) {
        match_string = match_string.concat('No Deadline Set');
      } else {
        const deadline_date = new Date(match_rows[i].timestamp);
        deadline_date.setDate(deadline_date.getDate() + 7);
        match_string = match_string.concat(
            `${deadline_date.toLocaleString('en-GB', {timeZone: 'UTC'})}`);
      }
    }
    string_builder.push(match_string);
  }
  channel.send('This user has the following matches to play:');
  while (string_builder.length > 0) {
    const string_builder_segment = string_builder.splice(0, 20);
    string_builder_segment.unshift('```');
    string_builder_segment.push('```');
    await channel.send(string_builder_segment.join('\n'));
  }
}

async function case_matchhistory(message, args, flags, guild, member) {
  // If --dm, send all replies via DM
  const channel = flags.includes('dm') ? message.author : message.channel;

  // Check if searching by author ID or amq_name
  const search_by_author = !(args.length > 0 && isNaN(args[0]));
  const page = (args.length > 0 && !isNaN(args[args.length-1])) ?
      parseInt(args[args.length-1]) : 1;

  // Fetch all user and non-pending matches for user
  let user_row;
  let match_rows;
  if (search_by_author) {
    user_row = await db.users.findOne({where: {discord_id: message.author.id}});
    match_rows = await db.matches.findAll({
      where: {
        result: {[db.Sequelize.Op.ne]: 'PENDING'},
        [db.Sequelize.Op.or]: [
          {'$user1.discord_id$': message.author.id},
          {'$user2.discord_id$': message.author.id}
        ]
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues,
      }],
      order: [
        ['updated_at', 'DESC']
      ],
      limit: 25,
      offset: 25*(page-1)
    });
  } else {
    user_row = await db.users.findOne({where: {lowercase_name: args[0].toLowerCase()}});
    match_rows = await db.matches.findAll({
      where: {
        result: {[db.Sequelize.Op.ne]: 'PENDING'},
        [db.Sequelize.Op.or]: [
          {'$user1.lowercase_name$': args[0].toLowerCase()},
          {'$user2.lowercase_name$': args[0].toLowerCase()}
        ]
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues
      }],
      order: [
        ['updated_at', 'DESC']
      ],
      limit: 25,
      offset: 25*(page-1)
    });
  }

  // If user has no completed matches in range
  if (match_rows.length < 1 || page <= 0) {
    return channel.send('No results found.');
  }

  // Build list of completed matches
  const string_builder = [];
  for (let i = 0; i < match_rows.length; i++) {
    let match_opponent = user_row.id === match_rows[i].user1.id ?
        match_rows[i].user2.amq_name : match_rows[i].user1.amq_name;
    let match_elo_change = user_row.id === match_rows[i].user1.id ?
        match_rows[i].rating_change1 : match_rows[i].rating_change2;
    let match_result;
    if (match_rows[i].result === match_opponent.toLowerCase()) {
      match_result = 'LOSS';
    } else if (match_rows[i].result === user_row.lowercase_name) {
      match_result = 'WIN';
    } else {
      match_result = match_rows[i].result;
    }
    let match_string = `ID# ${match_rows[i].id.toString().padStart(6)} - ` +
        `${match_rows[i].queue.name.padEnd(16)}: vs. ` + 
        `${match_opponent.padEnd(20)} ${match_result.padEnd(6)} ` +
        ((match_elo_change >= 0 ? '+' : '') + match_elo_change.toString()).padStart(3);
    string_builder.push(match_string);
  }
  channel.send(`Page ${page} of ${user_row.amq_name}'s results:`);
  string_builder.unshift('```');
  string_builder.push('```');
  channel.send(string_builder.join('\n'));
}

async function case_oldestmatches(message, args, flags, guild, member) {
  const match_rows = await db.matches.findAll({
    where: {
      result: 'PENDING'
    },
    include: [{
      model: db.users,
      as: 'user1'
    }, {
      model: db.users,
      as: 'user2'
    }, {
      model: db.queues
    }],
    order: [
      ['created_at', 'ASC']
    ],
    limit: 20
  });
  // If there are no pending matches
  if (match_rows.length < 1) {
    return channel.send('There are currently no pending matches. Congratulations?');
  }

  // Build list of pending matches
  const string_builder = [];
  string_builder.push('```');
  for (let i = 0; i < match_rows.length; i++) {
    let match_string = `ID# ${match_rows[i].id.toString().padStart(6)} - ` +
        `${match_rows[i].queue.name.padEnd(16)}: ` + 
        `${match_rows[i].user1.amq_name} vs. ${match_rows[i].user2.amq_name}`;
    match_string = match_string.padEnd(75);
    if (!match_rows[i].timestamp) {
      match_string = match_string.concat('No Deadline Set');
    } else {
      const deadline_date = new Date(match_rows[i].timestamp);
      deadline_date.setDate(deadline_date.getDate() + 7);
      match_string = match_string.concat(
          `${deadline_date.toLocaleString('en-GB', {timeZone: 'UTC'})}`);
    }
    string_builder.push(match_string);
  }
  string_builder.push('```');
  message.channel.send(string_builder.join('\n'));
}

// Suppresses messages if no_unqueue is true
async function enqueue(reply_target, discord_id, queue_name, no_unqueue) {
  try {
    // Fetch user
    const user_row = await db.users.findOne({
      where: {discord_id: discord_id}
    });
    if (!user_row) {
      if (!no_unqueue)
        reply(reply_target, 'You must register first. Please reply with `m!register <AMQ Username>` in order to register.');
      return;
    }

    // Fetch queue
    const queue_row = await db.queues.findOne({
      where: {lowercase_name: queue_name.toLowerCase()}
    });
    if (!queue_row) {
      if (!no_unqueue)
        reply(reply_target, 'Requested queue does not exist.');
      return;
    }

    // Force update member
    const guild = await client.guilds.cache.get(config.guild_id);
    const member = await guild.members.fetch(discord_id);

    // Verify that user has necessary role
    if (queue_row.required_role !== null) {
      if (!member.roles.cache.has(queue_row.required_role)) {
        if (!no_unqueue) {
          reply(reply_target, 'Your list must be approved first before playing in this queue.');
          reply(reply_target, 'Please request approval with `m!registerlist <List URL>` if you have not already done so.');
        }
        return;
      }
    }

    // Check that number of pending matches less than 5
    const match_count = await db.matches.count({
      where: {
        [db.Sequelize.Op.or]: [
          {'$user1.id$': user_row.id},
          {'$user2.id$': user_row.id}
        ],
        result: 'PENDING'
      },
      include: [{
        model: db.users,
        as: 'user1'
      }, {
        model: db.users,
        as: 'user2'
      }, {
        model: db.queues,
        where: {
          id: queue_row.id
        }
      }]
    });
    if (match_count >= 5) {
      if (!no_unqueue)
        reply(reply_target, 'You already have 5 matches to play in this queue.');
      return;
    }

    // Check if already queued
    const lfm_row = await db.lfm_users.findOne({
      include: [{
        model: db.users,
        where: {
          id: user_row.id
        }
      }, {
        model: db.queues,
        where: {
          id: queue_row.id
        }
      }]
    });

    // If not, create queue entry
    if (lfm_row === null) {
      db.lfm_users.create({
        timestamp: db.sequelize.literal('CURRENT_TIMESTAMP'),
      }).then((lfm_user) => {
        lfm_user.setUser(user_row);
        lfm_user.setQueue(queue_row);
      });
      console.log (`${user_row.amq_name} queued to ${queue_row.name}`);
      if (!no_unqueue)
        reply(reply_target, `You have been queued to ${queue_row.name}.`);
      setTimeout(matchmake, 10000, queue_row.name);

    // Otherwise, if no_unqueue is false, unqueue
    } else if (!no_unqueue) {
      lfm_row.destroy();
      console.log (`${user_row.amq_name} unqueued from ${queue_row.name}`);
      reply(reply_target, `You have been unqueued from ${queue_row.name}.`);
    }

  } catch (e) {
    console.log(`Error enqueueing ${discord_id} to ${queue_name}`);
    console.log(e.name + ': ' + e.message);
  }
}

async function case_enqueue(message, args, flags, guild, member) {
  const res = enqueue(message.channel, message.author.id, args[0], 0);
}

async function case_autoqueue(message, args, flags, guild, member) {
  try {
    // Fetch user
    const user_row = await db.users.findOne({
      where: {discord_id: message.author.id}
    });
    if (!user_row) {
      return message.channel.send('You must register first. ' +
          'Please reply with `m!register <AMQ Username>` in order to register.');
    }

    // Fetch queue
    const queue_row = await db.queues.findOne({
      where: {lowercase_name: args[0].toLowerCase()}
    });
    if (!queue_row) {
      return message.channel.send('Requested queue does not exist.');
    }

    // Verify that user has necessary role
    if (queue_row.required_role !== null) {
      if (!member.roles.cache.has(queue_row.required_role)) {
        message.channel.send('Your list must be approved first before ' +
            'playing in this queue.')
          .catch((e) => {
            console.log('Failed to send direct message.');
          });
        message.channel.send('Please request approval with `m!registerlist <List URL>` ' +
            'if you have not already done so.')
          .catch((e) => {
            console.log('Failed to send direct message.');
          });
        return;
      }
    }

    // Check if autoqueue entry already exists
    const aq_row = await db.autoqueues.findOne({
      include: [{
        model: db.users,
        where: {
          id: user_row.id
        }
      }, {
        model: db.queues,
        where: {
          id: queue_row.id
        }
      }]
    });

    // If so, delete it
    if (aq_row) {
      aq_row.destroy();
      return message.channel.send(`Autoqueue for ${args[0]} disabled.`);
    }

    // Else, create a new autoqueue entry
    db.autoqueues.create().then((new_row) => {
      new_row.setUser(user_row);
      new_row.setQueue(queue_row);
      message.channel.send(`Autoqueue for ${args[0]} enabled.`);
    });

    enqueue(message.channel, message.author.id, args[0], 1);

  } catch (e) {
    console.log(e.name);
    console.log(e.message);
    return message.channel.send('Error toggling autoqueue.');
  }
}

async function case_title(message, args, flags, guild, member) {
  // Fetch all active personal reward roles
  const queue_rows = await db.queues.findAll({
    attributes: ['custom_reward_role'],
  });

  // Change role name when found
  let role_found = false;
  for (let i = 0; i < queue_rows.length; i++) {
    if (member.roles.cache.has(queue_rows[i].custom_reward_role)) {
      member.roles.cache.get(queue_rows[i].custom_reward_role).setName(args[0]);
      message.channel.send('Role title successfully changed.');
      role_found = true;
      break;
    }
  }
  if (!role_found)
    message.channel.send('You do not have a personal role that can be customized.');
}

async function case_updaterewards(message, args, flags, guild, member) {
  // Fetch all active reward roles
  const queue_rows = await dbc.find_all_active_queues();
  if (queue_rows === null) {
    reply(message.channel, "No active queues found.");
    return;
  }

  // Forces members cache update
  await guild.members.fetch();

  // Remove personal roles from everyone
  for (let i = 0; i < queue_rows.length; i++) {
    const role = await guild.roles.fetch(queue_rows[i].custom_reward_role);
    if (role === null) {
      reply(message.channel, `Role ${queue_rows[i].custom_reward_role} does not exist.`);
      continue;
    }
    await role.members.forEach((role_member, id) => {
      role_member.roles.remove(queue_rows[i].custom_reward_role);
    });
  }
  console.log('Personal roles removed');

  // Award personal roles to deserving players and message them
  const winners_set = [];
  for (let i = 0; i < queue_rows.length; i++) {
    const role = await guild.roles.fetch(queue_rows[i].realtime_reward_role);
    if (role === null) {
      reply(message.channel, `Role ${queue_rows[i].realtime_reward_role} does not exist.`);
      continue;
    }
    await role.members.forEach((role_member, id) => {
      if (!winners_set.includes(id)) {
        role_member.roles.add(queue_rows[i].custom_reward_role);
        winners_set.push(id);
      }
    });
  }
  for (let i = 0; i < winners_set.length; i++) {
    client.users.fetch(winners_set[i])
      .then((user) => {
        reply(user, 'You have been awarded a personal, ' +
        'customizable role for your outstanding performance in a queue this season. ' +
        'Please reply with `m!title <Role Name>` to change the name of your role.');
      });
  } 
  console.log('Personal roles awarded');
  reply(message.channel, 'Finished updating personal roles.');

  // Print top 3 in each queue
  for (let i = 0; i < queue_rows.length; i++) {
    const top3 = await dbc.find_top_in_queue(queue_rows[i], 3);
    if (top3.length === 0) {
      reply(message.channel, `No rated users found in ${queue_rows[i].name}.`);
      continue;
    }
    const top3_string_builder = [];
    top3_string_builder.push(queue_rows[i].name);
    for (let j = 0; j < top3.length; j++) {
      top3_string_builder.push(`${top3[j][0]}. ${top3[j][1]}`);
    }
    top3_string_builder.push('');
    reply(message.channel, top3_string_builder.join('\n'));
  }
  console.log('Finished printing top 3 in each queue');
}

async function attach_reaction(channel, message_id, emoji) {
  channel.messages.fetch(message_id)
    .then(async (message) => {
      message.react(emoji);
    }).catch((e) => {
      console.log('Error attaching reaction to message ' + message_id);
      console.log(e.name + ': ' + e.message);
    });
}

async function reply(target, message) {
  try {
    const msg = await target.send(message);
    return msg.id;
  } catch (e) {
    if (target instanceof Discord.User)
      console.log('Failed to send direct message to ' + target.username);
    else console.log('Failed to send message in channel');
  }
}

async function case_setupqueue(message, args, flags, guild, member) {
  const required_role = (args.length % 4 === 2) ? args[args.length-1] : null;
  for (let i = 1; i < args.length-1; i+=4) {
    // For each reaction
    dbc.create_queue(args[i], 0, args[0], args[i+1], args[i+2], args[i+3], required_role)
      .then((queue) => {
        attach_reaction(message.channel, args[0], args[i+1]);
      });
  }

  reply(message.author, 'Queue setup complete.');
  console.log('Queue setup complete');
}

async function case_retirequeue(message, args, flags, guild, member) {
  const queue = dbc.retire_queue(args[0]);
  if (queue === null) reply(reply_target, 'Requested queue does not exist.');
  else reply(message.channel, `${args[0]} queue retired.`);
  console.log(`${args[0]} queue retired`);
}

async function case_replacerotation(message, args, flags, guild, member) {
  // Update rewards and retire old rotation queue
  await case_updaterewards(message, args, flags, guild, member);
  const rotation_queue = await dbc.find_rotation_queue();
  if (rotation_queue === null) reply(message.channel, 'No previous rotation queue found.');
  else await case_retirequeue(message, [rotation_queue.name], flags, guild, member);

  // Delete old messages in rotation-queue channel and print new ones
  const rotation_channel = await client.channels.fetch(config.rotation_channel);
  const messages_to_delete = await rotation_channel.messages.fetch({limit: 100});
  for (const [id, message_to_delete] of messages_to_delete) {
    await message_to_delete.delete();
  }
  await reply(rotation_channel, `This is where you queue for ${args[0]} ladder matches.`);
  await reply(rotation_channel, `The song difficulty setting for the match is determined by the elo of the players. ` +
      `If the two players have different elo, the lower elo player chooses between the two difficulty settings.`);
  await reply(rotation_channel, `> Diamond, Platinum: ${args[2]}`);
  await reply(rotation_channel, `> Gold: ${args[3]}`);
  await reply(rotation_channel, `> Silver: ${args[4]}`);
  await reply(rotation_channel, `> Bronze: ${args[5]}`);
  await reply(rotation_channel, `Once enough people enter the matchmaking queue, or enough time passes, ` +
      `the bot will automatically pair players and announce matches to be played in #matchmaking-results.`);
  await reply(rotation_channel, `React below to enter matchmaking for that queue.`);
  await reply(rotation_channel, `--------------------------------------------------------------`);
  const reaction_message_id = await reply(rotation_channel, `QUEUES`);
  await reply(rotation_channel, `RULES: ${args[6]}`);

  // Create new queue
  dbc.create_queue(args[0], 1, reaction_message_id, args[1],
      config.rotation_realtime_role, config.rotation_custom_role, null)
    .then((queue) => {
      attach_reaction(rotation_channel, reaction_message_id, args[1]);
      if (args.length > 7) dbc.update_special_instructions(queue, args[7]);
    });
}

async function case_setuptournament(message, args, flags, guild, member) {
  // Create tournament
  db.tournaments.create({
    name: args[0]
  }).then(async (row) => {
    if (args.length > 1)
      await row.update({required_role: args[1]});

    console.log(`${args[0]} tournament created`);
    message.channel.send('Tournament created successfully.');
  }).catch((e) => {
    if (e.name === 'SequelizeUniqueConstraintError') {
      if(e.fields.includes('name')) {
        return message.channel.send('This tournament name is already being used.');
      }
    }
    console.log(e.name);
    console.log(e.message);
    return message.channel.send('Error during tournament creation.');
  });
}

async function case_startprintingleaderboards(message, args, flags, guild, member) {
  leaderboards_print_loop(args[0]);
}

async function case_setmatchmakingrequirements(message, args, flags, guild, member) {
  // TODO: Input validation?
  for (let i = 0; i < args.length; i++) {
    config.matchmaking_requirements[i] = parseInt(args[i]);
  }
  fs.writeFileSync(config_file, JSON.stringify(config, null, 2));
  message.channel.send('Matchmaking conditions set.');
  console.log('Matchmaking conditions set');
}

async function case_rawsqlite(message, args, flags, guild, member) {
  db.sequelize.query(args[0]).spread((results, metadata) => {
    const results_string = JSON.stringify(results, null, 2);
    if (results_string === undefined) {
      return message.channel.send('Done.');
    }
    if (results_string.length > 1950) {
      return message.channel.send('Character limit exceeded.');
    }
    message.channel.send('```' + results_string + '```');
  }).catch((e) => {
    console.log(e);
    message.channel.send('Error running sqlite query.');
    message.channel.send('```' + e + '```');
  });
}

async function case_print(message, args, flags, guild, member) {
  for (let i = 0; i < args.length; i++) {
    message.channel.send(args[i].replace(/\\n/g,'\n'));
  }
}

async function case_clearlocks(message, args, flags, guild, member) {
  matchmaker_locks.splice(0, matchmaker_locks.length);
}

async function case_printlastmatchmake(message, args, flags, guild, member) {
  message.channel.send(last_edges.toString());
}

async function try_matchmaking() {
  // Get all active queues
  const queue_rows = await db.queues.findAll({
    where: {expired: 0}
  });

  // Attempt to matchmake in all queues
  for (let i = 0; i < queue_rows.length; i++) {
    await matchmake(queue_rows[i].name);
    await sleep(2000);
  }
}

async function case_trymatchmaking(message, args, flags, guild, member) {
  try_matchmaking();
}

async function case_changelogs(message, args, flags, guild, member) {
  // Get changelog file and split into lines
  const data = fs.readFileSync(config.changelogs_file);
  const lines = data.toString().split(/\r?\n/);

  // Iterate through lines
  let cl_block = -2;
  let cl_lines = [[], [], [], []];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    switch (cl_block) {
      case -2:
        if (line.startsWith(`## [${args[0]}]`)) cl_block++;
        break;

      case -1: case 0: case 1: case 2: case 3:
        if (line.startsWith(`##`)) cl_block++;
        else cl_lines[cl_block].push(line);
        break;

      default:

    }
  }

  // If no matching version found
  if (cl_block === -1) {
    return message.channel.send('Patch notes not found.');
  }

  // Get relevant channels
  const changelog_channel = client.channels.cache.get(config.changelog_channel);
  const admin_channel = client.channels.cache.get(config.admin_channel);

  // Print patch notes
  changelog_channel.send(`**Version ${args[0]} Patch Notes**`);
  while (cl_lines[0].length > 0) {
    const string_builder_segment = cl_lines[0].splice(0, 20);
    string_builder_segment.unshift('```');
    string_builder_segment.unshift('New Features:');
    string_builder_segment.push('```');
    await changelog_channel.send(string_builder_segment.join('\n'));
  }
  while (cl_lines[1].length > 0) {
    const string_builder_segment = cl_lines[1].splice(0, 20);
    string_builder_segment.unshift('```');
    string_builder_segment.unshift('Changes:');
    string_builder_segment.push('```');
    await changelog_channel.send(string_builder_segment.join('\n'));
  }
  while (cl_lines[2].length > 0) {
    const string_builder_segment = cl_lines[2].splice(0, 20);
    string_builder_segment.unshift('```');
    string_builder_segment.unshift('Bugfixes:');
    string_builder_segment.push('```');
    await changelog_channel.send(string_builder_segment.join('\n'));
  }
  admin_channel.send(`**Version ${args[0]} Admin Notes**`);
  while (cl_lines[3].length > 0) {
    const string_builder_segment = cl_lines[3].splice(0, 20);
    string_builder_segment.unshift('```');
    string_builder_segment.push('```');
    await admin_channel.send(string_builder_segment.join('\n'));
  }
}

async function case_help(message, args, flags, guild, member) {
  const channel = client.channels.cache.get(config.help_channel);
  message.channel.send(`Please check the pinned message under ${channel}.`);
}

async function confirm_match_result(channel, match_id, result) {
  // Fetch relevant match
  const match = await db.matches.findOne({
    where: {id: match_id},
    include: [{
      model: db.users,
      as: 'user1',
    }, {
      model: db.users,
      as: 'user2'
    }, {
      model: db.queues
    }]
  });
  if (match === null) {
    console.log('ERROR: Match not found after confirmation step');
    return channel.send(`Match with ID ${match_id} not found.`);
  }

  // Make sure match still hasn't been reported
  if (match.result !== 'PENDING')
    return message.channel.send('This match has already been reported. ' +
        'If there was a mistake, please notify a moderator ASAP.');

  // Fetch players
  // TODO: Wait, there's no way this is necessary
  const user1 = await db.users.findOne({
    where: {id: match.user1.id},
    include: [{
      model: db.queues,
      where: {name: match.queue.name},
    }]
  });
  const user2 = await db.users.findOne({
    where: {id: match.user2.id},
    include: [{
      model: db.queues,
      where: {name: match.queue.name},
    }]
  });

  // Calculate prospective elo changes
  const gain1 = helper.calculate_elo_gains(
      user1.queues[0].user_ratings.rating, user2.queues[0].user_ratings.rating,
      user1.queues[0].user_ratings.wins + user1.queues[0].user_ratings.draws +
      user1.queues[0].user_ratings.losses < config.placement_games ?
      config.placement_k : config.stable_k);
  const gain2 = helper.calculate_elo_gains(
      user2.queues[0].user_ratings.rating, user1.queues[0].user_ratings.rating,
      user2.queues[0].user_ratings.wins + user2.queues[0].user_ratings.draws +
      user2.queues[0].user_ratings.losses < config.placement_games ?
      config.placement_k : config.stable_k);

  const winner = result.toLowerCase();
  // If result is a name
  if (winner === user1.lowercase_name || winner === user2.lowercase_name) {
    const win1 = winner === user1.lowercase_name;
    match.update({
      result: winner,
      rating_change1: gain1[win1 ? 0 : 2],
      rating_change2: gain2[win1 ? 2 : 0]
    });
    user1.queues[0].user_ratings.rating += gain1[win1 ? 0 : 2];
    user1.queues[0].user_ratings.wins += win1 ? 1 : 0;
    user1.queues[0].user_ratings.losses += win1 ? 0 : 1;
    user1.queues[0].user_ratings.peak_rating = Math.max(
        user1.queues[0].user_ratings.peak_rating,
        user1.queues[0].user_ratings.rating);
    user1.queues[0].user_ratings.save();
    user2.queues[0].user_ratings.rating += gain2[win1 ? 2 : 0];
    user2.queues[0].user_ratings.wins += win1 ? 0 : 1;
    user2.queues[0].user_ratings.losses += win1 ? 1 : 0;
    user2.queues[0].user_ratings.peak_rating = Math.max(
        user2.queues[0].user_ratings.peak_rating,
        user2.queues[0].user_ratings.rating);
    user2.queues[0].user_ratings.save();
    channel.send(
      `${client.users.cache.get(user1.discord_id)} ` +
      `${client.users.cache.get(user2.discord_id)} ` +
      `Result for Match ${match_id} (${match.queue.name}) ` +
      `recorded as a win for ${result}. (${gain1[win1 ? 0 : 2]}|${gain2[win1 ? 2 : 0]})`);
  // If result is a draw
  } else if (winner === 'draw' || winner === 'tie' || winner === 'stalemate') {
    match.update({
      result: 'DRAW',
      rating_change1: gain1[1],
      rating_change2: gain2[1]
    });
    user1.queues[0].user_ratings.rating += gain1[1];
    user1.queues[0].user_ratings.draws += 1;
    user1.queues[0].user_ratings.peak_rating = Math.max(
        user1.queues[0].user_ratings.peak_rating,
        user1.queues[0].user_ratings.rating);
    user1.queues[0].user_ratings.save();
    user2.queues[0].user_ratings.rating += gain2[1];
    user2.queues[0].user_ratings.draws += 1;
    user2.queues[0].user_ratings.peak_rating = Math.max(
        user2.queues[0].user_ratings.peak_rating,
        user2.queues[0].user_ratings.rating);
    user2.queues[0].user_ratings.save();
    channel.send(
      `${client.users.cache.get(user1.discord_id)} ` +
      `${client.users.cache.get(user2.discord_id)} ` +
      `Result for Match ${match_id} (${match.queue.name}) ` +
      `recorded as a draw. (${gain1[1]}|${gain2[1]})`);
  // Otherwise, there's a problem
  } else {
    console.log('ERROR: Match result unexpected after confirmation step')
    channel.send('Unexpected match result provided.');
  }

  update_best_player(match.queue.id);
}

async function print_leaderboard(channel, queue_id, persistent) {
  // Fetch all users of queue, sorted by rating
  const rating_rows = await db.users.findAll({
    where: {banned: 0},
    include: [{
      model: db.queues,
      where: {id: queue_id},
      through: {
        attributes: ['rating', 'wins', 'draws', 'losses']
      }
    }],
    order: [
      [db.queues, db.user_ratings, 'rating', 'DESC']
    ]
  });

  // If no one has a user_rating yet
  if (rating_rows.length < 1) {
    return channel.send("This queue has no rated users yet.");
  }

  // Organize information
  const usernames = [], percentiles = [], ranks = [], ratings = [], playcounts = [];
  let grank = 0, brank = 0;
  while (brank < rating_rows.length) {
    if (brank === rating_rows.length-1 ||
        rating_rows[brank].queues[0].user_ratings.rating !==
        rating_rows[brank+1].queues[0].user_ratings.rating) {
      for (let i = grank; i <= brank; i++) {
        usernames[i] = rating_rows[i].amq_name;
        percentiles[i] = (grank+brank)/2.0/(rating_rows.length-1);
        ranks[i] = grank+1;
        ratings[i] = rating_rows[i].queues[0].user_ratings.rating;
        playcounts[i] = rating_rows[i].queues[0].user_ratings.wins + 
            rating_rows[i].queues[0].user_ratings.draws +
            rating_rows[i].queues[0].user_ratings.losses;
      }
      grank = brank + 1;
    }
    brank++;
  }

  // Build string and print
  let ui = 0;
  const string_builder = [];
  if (!persistent) string_builder.push('- ' + rating_rows[0].queues[0].name);
  string_builder.push('Rank|Name                    |Elo |Games')
  string_builder.push('Diamond '.padEnd(40, '-'));
  while (ui < percentiles.length && percentiles[ui] < .1) {
    string_builder.push(ranks[ui].toString().padStart(4) + ' ' +
        usernames[ui].padEnd(25) + ratings[ui].toString().padStart(4) + ' ' +
        playcounts[ui].toString().padStart(5));
    ui++;
  }
  string_builder.push('Platinum '.padEnd(40, '-'));
  while (ui < percentiles.length && percentiles[ui] < .25) {
    string_builder.push(ranks[ui].toString().padStart(4) + ' ' +
        usernames[ui].padEnd(25) + ratings[ui].toString().padStart(4) + ' ' +
        playcounts[ui].toString().padStart(5));
    ui++;
  }
  string_builder.push('Gold '.padEnd(40, '-'));
  while (ui < percentiles.length && percentiles[ui] < .5) {
    string_builder.push(ranks[ui].toString().padStart(4) + ' ' +
        usernames[ui].padEnd(25) + ratings[ui].toString().padStart(4) + ' ' +
        playcounts[ui].toString().padStart(5));
    ui++;
  }
  string_builder.push('Silver '.padEnd(40, '-'));
  while (ui < percentiles.length && percentiles[ui] < .75) {
    string_builder.push(ranks[ui].toString().padStart(4) + ' ' +
        usernames[ui].padEnd(25) + ratings[ui].toString().padStart(4) + ' ' +
        playcounts[ui].toString().padStart(5));
    ui++;
  }
  string_builder.push('Bronze '.padEnd(40, '-'));
  while (ui < percentiles.length) {
    string_builder.push(ranks[ui].toString().padStart(4) + ' ' +
        usernames[ui].padEnd(25) + ratings[ui].toString().padStart(4) + ' ' +
        playcounts[ui].toString().padStart(5));
    ui++;
  }
  while (string_builder.length > 0) {
    const string_builder_segment = string_builder.splice(0, 40);
    string_builder_segment.unshift('```diff');
    string_builder_segment.push('```');
    await channel.send(string_builder_segment.join('\n'));
  }
}

async function leaderboards_print_loop(timer) {
  // Note start time
  const start_time = new Date().getTime();

  // Get channel and clear messages
  const channel = client.channels.cache.get(config.leaderboards_channel);
  channel.messages.fetch().then(async (msgs) => {
    channel.bulkDelete(msgs);

    // Get all active queues
    const queue_rows = await db.queues.findAll({
      where: {expired: 0},
      order: [
        ['id', 'ASC']
      ]
    });

    // Print leaderboards
    for (let i = 0; i < queue_rows.length; i++) {
      channel.send('\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-');
      channel.send(`__**${queue_rows[i].name}**__`);
      await print_leaderboard(channel, queue_rows[i].id, true);
      await sleep(2000);
    }
  });

  // Calculate elapsed time
  const elapsed_time = new Date().getTime() - start_time;

  // Loop on timer
  setTimeout(leaderboards_print_loop, timer - elapsed_time, timer);
}

async function try_matchmaking_loop() {
  try_matchmaking();
  setTimeout(try_matchmaking_loop, config.matchmaking_interval);
}

// Function for determining top of ladder
async function update_best_player(queue_id) {
  // Fetch top player of respective queue, tiebroken by games played
  const guild = await client.guilds.cache.get(config.guild_id);

  // TODO: Figure out how to order by sum of multiple columns in through table
  const top_player_rows = await db.users.findAll({
    include: [{
      model: db.queues,
      where: {id: queue_id},
      through: {
        attributes: ['rating', 'wins', 'draws', 'losses']
      }
    }],
    order: [
      [db.queues, db.user_ratings, 'rating', 'DESC']
    ]
  });

  // Queue should have at least one player at this point
  if (!top_player_rows[0]) {
    console.log("ERROR: Something went wrong, no top player of queue found");
    return;
  }

  // Calculate highest total games played
  let top_player_id = top_player_rows[0].discord_id;
  let top_player_rating = top_player_rows[0].queues[0].user_ratings.rating;
  let top_player_total_games =
      top_player_rows[0].queues[0].user_ratings.wins +
      top_player_rows[0].queues[0].user_ratings.draws +
      top_player_rows[0].queues[0].user_ratings.losses;
  for (let i = 1; i < top_player_rows.length; i++) {
    if (top_player_rows[i].queues[0].user_ratings.rating < top_player_rating) break;
    let new_total_games =
        top_player_rows[i].queues[0].user_ratings.wins +
        top_player_rows[i].queues[0].user_ratings.draws +
        top_player_rows[i].queues[0].user_ratings.losses;
    if (new_total_games > top_player_total_games) {
      top_player_id = top_player_rows[i].discord_id;
      top_player_total_games = new_total_games;
    }
  }

  // TEMP
  console.log(top_player_id);
  console.log(top_player_rating);
  console.log(top_player_total_games);

  // Check current owner of top player role
  const role_members = guild.roles.cache.get(
      top_player_rows[0].queues[0].realtime_reward_role).members;
  // If no one has the role yet
  if (role_members.size === 0) {
    const top_player_member = guild.members.cache.get(top_player_id);
    top_player_member.roles.add(top_player_rows[0].queues[0].realtime_reward_role);
    console.log(`Top player of ${top_player_rows[0].queues[0].name} ` +
          `changed to ${top_player_member.user.username}`);
  // Else
  } else {
    console.log(role_members[0]); // TEMP
    role_members.forEach(async (role_member, id) => {
      const player_row = await db.users.findOne({
        where: {discord_id: id},
        include: [{
          model: db.queues,
          where: {id: queue_id},
          through: {
            attributes: ['rating', 'wins', 'draws', 'losses']
          }
        }]
      });

      // Player should exist
      if (!player_row) {
        console.log("ERROR: No user_rating entry for current player with top role");
        return;
      }

      console.log(player_row.amq_name); // TEMP
      // If not tied with the current top player, replace title
      // Note that there is NOT a redundancy check here since we use OR and strictly LT
      if (player_row.queues[0].user_ratings.rating < top_player_rating ||
          player_row.queues[0].user_ratings.wins + player_row.queues[0].user_ratings.draws +
          player_row.queues[0].user_ratings.losses < top_player_total_games) {
        role_member.roles.remove(top_player_rows[0].queues[0].realtime_reward_role);
        const top_player_member = guild.members.cache.get(top_player_id);
        top_player_member.roles.add(top_player_rows[0].queues[0].realtime_reward_role);
        console.log(`Top player of ${top_player_rows[0].queues[0].name} ` +
            `changed from ${role_member.user.username} to ` +
            `${top_player_member.user.username}`);
      }
    });
  }
  console.log('Finished checking for change in top player');
}

// Handle messages
client.on('message', async (message) => {
  if (message.author.bot) return;

  let truncated_message;
  if (message.content.startsWith(config.prefix)) {
    truncated_message = message.content.slice(config.prefix.length);
  } else if (message.content.startsWith('『')) {
    truncated_message = message.content.slice(1);
  } else return;

  // Splice arguments
  const args = Array.from(truncated_message.matchAll(/([^\s"“”]+)|["“”]([^"]*)["“”]/g));
  let flags_count = 0;
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    args[i] = args[i][1] === undefined ? args[i][2] : args[i][1];
    if (args[i].startsWith('--')) {
      flags[flags_count++] = args.splice(i--, 1)[0].slice(2);
    } else if (args[i].startsWith('—')) {
      flags[flags_count++] = args.splice(i--, 1)[0].slice(1);
    }
  }
  const cmd = args.shift().toLowerCase();

  // Fetch guild and guild member
  const guild = await client.guilds.cache.get(config.guild_id);
  const member = await guild.members.fetch(message.author.id);

  console.log(`Command received from ${message.author.username}: ${cmd} ${args[0]}`);
  switch (cmd) {

    // Used to register for ladder and bind AMQ name
    case 'register':
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_register(message, args, flags, guild, member);
      break;

    // Used to change a Discord ID associated with a user
    case 'changediscord':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 2)
        return message.channel.send(err.number_of_arguments);

      case_changediscord(message, args, flags, guild, member);
      break;

    // Used to request list approval
    case 'registerlist': case 'list':
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_registerlist(message, args, flags, guild, member);
      break;

    // Used to reject list pending approval
    case 'rejectlist': case 'reject': case 'rl':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length < 1 || args.length > 2)
        return message.channel.send(err.number_of_arguments);

      case_rejectlist(message, args, flags, guild, member);
      break;

    // Used to accept list pending approval
    case 'acceptlist': case 'approvelist': case 'accept': case 'approve': case 'al':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length < 1 || args.length > 2)
        return message.channel.send(err.number_of_arguments);

      case_acceptlist(message, args, flags, guild, member);
      break;

    // Used to register for special tournaments
    case 'signup':
      if (args.length < 1 || args.length > 2)
        return message.channel.send(err.number_of_arguments);

      case_signup(message, args, flags, guild, member);
      break;

    // Used to report results of a match
    case 'result': case 'report': case 'r':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (args.length !== 2)
        return message.channel.send(err.number_of_arguments);

      case_result(message, args, flags, guild, member);
      break;

    // Displays leaderboard for specified queue
    case 'leaderboard': case 'leaderboards': case 'lb':
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

     case_leaderboard(message, args, flags, guild, member);
      break;

    // Displays profile for specified user
    case 'profile': case 'prof':
      if (args.length > 1)
        return message.channel.send(err.number_of_arguments);

      case_profile(message, args, flags, guild, member);
      break;

    case 'headtohead': case 'head2head': case 'headtwohead': case 'hth': case 'h2h':
      if (args.length !== 2)
        return message.channel.send(err.number_of_arguments);

      case_headtohead(message, args, flags, guild, member);
      break;

    // Allows users to check their pending queues
    case 'queued': case 'queues': case 'queue': case 'q':
      if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_queued(message, args, flags, guild, member);
      break;

    // Allows users to check their (and others') pending matches
    case 'pending': case 'pendings': case 'pend': case 'p':
      if (args.length > 1)
        return message.channel.send(err.number_of_arguments);

      case_pending(message, args, flags, guild, member);
      break;

    // Views most recent matches
    case 'matchhistory': case 'history': case 'hist': case 'mh':
      if (args.length > 2)
        return message.channel.send(err.number_of_arguments);

      case_matchhistory(message, args, flags, guild, member);
      break;

    // Prints a list of the twenty oldest matches
    case 'oldestmatches': case 'oldest': case 'old':
    if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
    if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_oldestmatches(message, args, flags, guild, member);
      break;

    // Queue into a queue via command
    case 'enqueue': case 'eq':
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_enqueue(message, args, flags, guild, member);
      break;

    // Toggles autoqueue status for a specific queue
    case 'autoqueue': case 'aq':
    if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_autoqueue(message, args, flags, guild, member);
      break;

    // Sets name for personal role
    case 'title': case 't':
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_title(message, args, flags, guild, member);
      break;

    // Used monthly to remove current custom roles and reward new ones
    case 'updaterewards':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_updaterewards(message, args, flags, guild, member);
      break;

    case 'replacerotation':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length < 7 || args.length > 8)
        return message.channel.send(err.number_of_arguments);

      case_replacerotation(message, args, flags, guild, member);
      break;

    // Adds reactions and creates/associates queues
    case 'setupqueue':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length < 5 || (args.length % 4 !== 1 && args.length % 4 !== 2))
        return message.channel.send(err.number_of_arguments);
      
      case_setupqueue(message, args, flags, guild, member);
      break;

    // Used to mark a rotating queue as expired
    case 'retirequeue':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_retirequeue(message, args, flags, guild, member);
      break;

    // Creates tournament entry
    case 'setuptournament':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length < 1 || args.length > 2)
        return message.channel.send(err.number_of_arguments);
      
      case_setuptournament(message, args, flags, guild, member);
      break;

    // Starts timeout for periodic printing of leaderboards
    case 'startprintingleaderboards':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_startprintingleaderboards(message, args, flags, guild, member);
      break;

    // Sets matchmaking conditions
    case 'setmatchmakingrequirements':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length % 2 !== 0)
        return message.channel.send(err.number_of_arguments);

      case_setmatchmakingrequirements(message, args, flags, guild, member);
      break;

    // Run raw SQLite query
    case 'rawsqlite': case 'raw':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_rawsqlite(message, args, flags, guild, member);
      break;

    // Replies back with a new message per argument
    case 'print': case 'parrot':
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      
      case_print(message, args, flags, guild, member);
      break;

    // Used to clear matchmaker locks in emergency
    case 'clearlocks':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_clearlocks(message, args, flags, guild, member);
      break;

    // Prints edge graph of last matchmake run
    case 'printlastmatchmake':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_printlastmatchmake(message, args, flags, guild, member);
      break;

    // Run matchmaker on all queues
    case 'trymatchmaking':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 0)
        return message.channel.send(err.number_of_arguments);

      case_trymatchmaking(message, args, flags, guild, member);
      break;

    case 'changelogs': case 'changelog':
      if (message.guild === undefined)
        return message.channel.send(err.dm_disallowed);
      if (!member.roles.cache.has(config.admin_role))
        return message.channel.send(err.insufficient_privilege);
      if (args.length !== 1)
        return message.channel.send(err.number_of_arguments);

      case_changelogs(message, args, flags, guild, member);
      break;

    // SOS
    case 'help': case 'commands': case '?': case 'sos':
      case_help(message, args, flags, guild, member);
      break;

    // Personality!
    default:
      message.channel.send('Unrecognized command: ' +
          err.default_messages[Math.floor(Math.random() * err.default_messages.length)]);
  }
});

// Match creation function
async function make_match(user1, elo1, user2, elo2) {
  const rank1 = helper.what_elo(elo1);
  const rank2 = helper.what_elo(elo2);

  db.matches.create({
    result: 'PENDING',
    rank1: rank1,
    rank2: rank2,
    timestamp: db.sequelize.literal('CURRENT_TIMESTAMP')
  }).then(async (match) => {
    match.setUser1(user1.user);
    match.setUser2(user2.user);
    match.setQueue(user1.queue);

    // Notify matchmade players
    let extra = '';
    if (user1.queue.special_instructions !== null) {
      switch (user1.queue.special_instructions) {
        case 'roll from tags100 list':
          extra = ' Tag: ';
          extra += lists.tags100[Math.floor(Math.random() * lists.tags100.length)];
          break;

        default:
          console.log('Special Instructions case not found');
      }
    }
    const user1obj = await client.users.fetch(user1.user.discord_id);
    const user2obj = await client.users.fetch(user2.user.discord_id);
    client.channels.cache.get(config.match_channel).send(
        `Match ID# \`${match.id.toString().padStart(6)}\` - ` +
        `Queue \`${user1.queue.name.padEnd(16)}\`: ` +
        `${user1obj} ${user1.user.amq_name} (${rank1}) vs. ` +
        `${user2obj} ${user2.user.amq_name} (${rank2})` + extra);

    // Delete LFM rows for matchmade players
    user1.destroy();
    user2.destroy();
    console.log('Match creation successful');

  }).catch((e) => {
    console.error(e);
    console.log('Error finalizing match creation');
  });
}

// Locks for matchmaker
const matchmaker_locks = [];

// Last edge graph made
let last_edges = [];

// Matchmaker function
async function matchmake(queue_name) {
  // Check and acquire lock
  console.log('Running matchmaker function');
  if (matchmaker_locks[queue_name]) {
    console.log(`Matchmaker currently locked for ${queue_name}`);
    return;
  }
  matchmaker_locks[queue_name] = 1;

  // Check that matchmaking conditions are met
  try {
    const lfm_rows = await db.lfm_users.findAll({
      include: [{
        model: db.users
      }, {
        model: db.queues,
        where: {name: queue_name}
      }],
      order: [
        ['timestamp', 'ASC']
      ]
    });
    if (!lfm_rows || !lfm_rows[0]) {
      console.log('No users found in queue');
      return;
    }
    const time_elapsed = new Date() - new Date(lfm_rows[0].timestamp);
    let matchmakeable = false;
    for (let i = 0; i < config.matchmaking_requirements.length; i+=2) {
      if (lfm_rows.length >= config.matchmaking_requirements[i] &&
          time_elapsed >= config.matchmaking_requirements[i+1]) {
        matchmakeable = true;
        break;
      }
    }
    if (lfm_rows[0].queue.expired) {
      matchmakeable = false;
    }
    if (!matchmakeable) {
      console.log('Matchmaking conditions not met');
      return;
    }

    // If user is new to queue, create user_rating entry
    for (let i = 0; i < lfm_rows.length; i++) {
      if (!(await lfm_rows[i].user.hasQueue(lfm_rows[i].queue))) {
        await lfm_rows[i].user.addQueue(lfm_rows[i].queue);
      }
    }

    // Get all users of queue, ordered by rating
    const rating_rows = await db.users.findAll({
      where: {banned: 0},
      include: [{
        model: db.queues,
        where: {name: queue_name},
        through: {
          attributes: ['rating']
        }
      }],
      order: [
        [db.queues, db.user_ratings, 'rating', 'DESC']
      ]
    });

    // If odd, rollover last person to next queue and reset timer
    const lfm_num = lfm_rows.length % 2 === 0 ? lfm_rows.length : lfm_rows.length-1;
    if (lfm_rows.length % 2 === 1) {
      lfm_rows[lfm_num].update({
        timestamp: db.sequelize.literal('CURRENT_TIMESTAMP')
      });
      client.users.cache.get(lfm_rows[lfm_num].user.discord_id).send(
          'There were an odd number of players in the queue during this round ' +
          'of matchmaking, and we were unable to find you a match. You are still in the ' +
          'queue and will be matched with an opponent soon.')
        .catch((e) => {
          console.log('Failed to send direct message.');
        });;
    }

    // Get percentiles of all users to matchmake
    const percentiles = [];
    let grank = 0, brank = 0;
    while (brank < rating_rows.length) {
      if (brank === rating_rows.length-1 ||
          rating_rows[brank].queues[0].user_ratings.rating !==
          rating_rows[brank+1].queues[0].user_ratings.rating) {
        for (let i = grank; i <= brank; i++) {
          for (let j = 0; j < lfm_num; j++) {
            if (rating_rows[i].id === lfm_rows[j].user.id)
              percentiles[j] = (grank+brank)/2.0/(rating_rows.length-1);
          }
        }
        grank = brank + 1;
      }
      brank++;
    }

    // Fetch each user's most recent five matches and all pending matches
    const recent_matches = [], pending_matches = [];
    for (let i = 0; i < lfm_num; i++) {
      recent_matches[i] = await db.matches.findAll({
        where: {
          [db.Sequelize.Op.or]: [
            {user1_id: lfm_rows[i].user.id},
            {user2_id: lfm_rows[i].user.id}
          ],
          result: {[db.Sequelize.Op.ne]: 'PENDING'}
        },
        include: [{
          model: db.users,
          as: 'user1'
        }, {
          model: db.users,
          as: 'user2'
        }, {
          model: db.queues,
          where: {
            name: queue_name
          }
        }],
        order: [
          ['timestamp', 'DESC']
        ],
        limit: 5
      });
      pending_matches[i] = await db.matches.findAll({
        where: {
          [db.Sequelize.Op.or]: [
            {user1_id: lfm_rows[i].user.id},
            {user2_id: lfm_rows[i].user.id}
          ],
          result: 'PENDING'
        },
        include: [{
          model: db.users,
          as: 'user1'
        }, {
          model: db.users,
          as: 'user2'
        }, {
          model: db.queues,
          where: {
            name: queue_name
          }
        }],
        order: [
          ['created_at', 'ASC']
        ]
      });
    }

    // Build complete graph
    const weights = [];
    for (let i = 0; i < lfm_num; i++) {
      weights[i] = [];
      for (let j = 0; j < lfm_num; j++) {
        if (i === j) continue;
        let weight = 0;
        for (let k = 0; k < pending_matches[i].length; k++) {
          weight *= config.max_matches;
          if (pending_matches[i][k].user1.id === lfm_rows[j].user.id ||
              pending_matches[i][k].user2.id === lfm_rows[j].user.id) weight += 1;
          weight *= config.max_matches;
        }
        for (let k = 0; k < 5-pending_matches[i].length; k++) {
          weight *= config.max_matches;
          if (k < recent_matches[i].length &&
              (recent_matches[i][k].user1.id === lfm_rows[j].user.id ||
              recent_matches[i][k].user2.id === lfm_rows[j].user.id)) weight += 1;
          weight *= config.max_matches;
        }
        const elodiff = Math.abs(percentiles[i] - percentiles[j]);
        if (elodiff >= .5) weight += Math.pow(config.max_matches, 8);
        else if (elodiff >= .4) weight += Math.pow(config.max_matches, 6);
        else if (elodiff >= .3) weight += Math.pow(config.max_matches, 4);
        else if (elodiff >= .2) weight += Math.pow(config.max_matches, 2);
        else if (elodiff >= .1) weight += Math.pow(config.max_matches, 0);
        weights[i][j] = weight;
      }
    }
    const edges = [];
    for (let i = 0; i < lfm_num; i++) {
      for (let j = i+1; j < lfm_num; j++) {
        edges.push([i, j, Math.pow(config.max_matches, 10) -
            Math.max(weights[i][j], weights[j][i])]);
      }
    }
    last_edges = edges;

    // Make matches
    const results = blossom(edges);
    for (let i = 0; i < results.length; i++) {
      if (i < results[i])
        await make_match(lfm_rows[i], percentiles[i],
                        lfm_rows[results[i]], percentiles[results[i]]);
    }

    // Requeue autoqueued users after 30s
    setTimeout(requeue_autoqueue, 30000, queue_name);

  } finally {
    // Release lock
    matchmaker_locks[queue_name] = 0;
  }
};

// Finds all autoqueued users for specified queue, and requeues them
async function requeue_autoqueue(queue_name) {
  // Fetch all autoqueues for specified queue
  db.autoqueues.findAll({
    include: [{
      model: db.users
    }, {
      model: db.queues,
      where: {name: queue_name}
    }]
  }).then(async (rows) => {
    rows.forEach(async (row) => {
      enqueue(null, row.user.id, row.queue.name, 1);
    });

  }).catch((e) => {
    console.log(e.name);
    console.log(e.message);
    console.log('Error requeueing autoqueues')
  });
}

// Possible reaction cases
// Reaction to join a queue
async function handle_queue_reaction(reaction, user) {
  // Get appropriate queue
  const queue = await db.queues.findOne({
    where: {
      message_id: reaction.message.id,
      reaction: reaction.emoji.name
    }
  });
  if (queue === null) return;
  console.log('Queue reaction detected for ' + queue.name);
  reaction.users.remove(user);

  enqueue(user, user.id, queue.name, 0);
}

// Reaction to confirm a match result
async function handle_match_confirmation_reaction(reaction, user) {
  // Get appropriate queue
  const match_confirmation = await db.match_confirmations.findOne({
    where: {
      author_id: user.id,
      message_id: reaction.message.id
    },
    include: [{
      model: db.matches,
      attributes: ['id']
    }]
  });
  if (match_confirmation === null) return;
  console.log('Match confirmation reaction detected');

  // Take action based on Y/N and delete message and confirmation afterwards
  if (reaction.emoji.name === '✅') {
    confirm_match_result(reaction.message.channel,
        match_confirmation.match.id, match_confirmation.result);
    match_confirmation.destroy();
    reaction.message.delete();
  } else if (reaction.emoji.name === '❌') {
    reaction.message.channel.send(`Result report for Match ` +
        `${match_confirmation.match.id} cancelled.`);
    match_confirmation.destroy();
    reaction.message.delete();
  }
}

// Handle reactions
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  // Check if reaction is partial, if so, fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (e) {
      console.log('Error fetching message: ', e);
      return;
    }
  }

  handle_queue_reaction(reaction, user);
  handle_match_confirmation_reaction(reaction, user);
});

// Handle shutdown commands
process
  .on('SIGTERM', shutdown('SIGTERM'))
  .on('SIGINT', shutdown('SIGINT'));

function shutdown(signal) {
  return (err) => {
    console.log(`${signal}...`);
    if (err) console.error(err.stack || err);
    setTimeout(() => {
      console.log('Waited 5s, now exiting');
      process.exit(err ? 1 : 0);
    }, 5000).unref();
  };
}

// Log in
client.login(process.env.BOT_TOKEN);