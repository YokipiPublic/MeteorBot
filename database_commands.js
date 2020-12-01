'use strict';

const db = require('./database.js');
const dbc = {};

// Returns new or updated queue
dbc.create_queue = async function (name, rotation, message_id, emoji, realtime_reward_role, custom_reward_role, required_role) {
  try {
    // Check if queue exists
    let queue = await db.queues.findOne({
      where: {lowercase_name: name.toLowerCase()}
    });

    // If not, create it
    if (queue === null) {
      queue = db.queues.create({
        name: name,
        lowercase_name: name.toLowerCase(),
        expired: 0,
        rotation: rotation,
        message_id: message_id,
        reaction: emoji,
        realtime_reward_role: realtime_reward_role,
        custom_reward_role: custom_reward_role,
        required_role: required_role
      });

    // If found, update it
    } else {
      queue.update({
        message_id: message_id,
        reaction: emoji,
        realtime_reward_role: realtime_reward_role,
        custom_reward_role: custom_reward_role,
        required_role: required_role
      });
    }

    return queue;
  } catch (e) {
    console.log('Error creating or updating queue ' + name);
    console.log(e.name + ': ' + e.message);
  }
}

// Returns retired queue or null
dbc.retire_queue = async function (name) {
  try {
    // Check that queue exists
    const queue = await db.queues.findOne({
      where: {lowercase_name: name.toLowerCase()}
    });
    if (queue === null) return queue;

    // Mark queue as expired
    queue.update({
      expired: 1
    });

    // Delete all LFM entries
    const lfm_rows = await db.lfm_users.findAll({
      include: [{
        model: db.queues,
        where: {id: queue.id}
      }]
    });
    lfm_rows.forEach((row) => {
      row.destroy();
    });

    // Delete all autoqueue entries
    const aq_rows = await db.autoqueues.findAll({
      include: [{
        model: db.queues,
        where: {id: queue.id}
      }]
    });
    aq_rows.forEach((row) => {
      row.destroy();
    });

    return queue;
  } catch (e) {
    console.log('Error retiring queue ' + name);
    console.log(e.name + ': ' + e.message);
  }
}

// Return a rotation queue or null
dbc.find_rotation_queue = async function () {
  try {
    const queue = await db.queues.findOne({
      where: {rotation: 1}
    });

    return queue;
  } catch (e) {
    console.log('Error finding rotation queue');
    console.log(e.name + ': ' + e.message);
  }
}

// Return updated queue
dbc.update_special_instructions = async function(queue, special_instructions) {
  try {
    queue.update({
      special_instructions: special_instructions
    });

    return queue;
  } catch (e) {
    console.log('Error updating special instructions on queue ' + queue.name);
    console.log(e.name + ': ' + e.message);
  }
}

// Return all active queues
dbc.find_all_active_queues = async function() {
  try {
    const queues = await db.queues.findAll({
      where: {expired: 0}
    });

    return queues;
  } catch (e) {
    console.log('Error finding all active queues');
    console.log(e.name + ': ' + e.message);
  }
}

// Return array containing array data of top players in queue
dbc.find_top_in_queue = async function(queue, n) {
  const result_set = [];
  // Fetch user ratings
  try {
    const rating_rows = await db.users.findAll({
      where: {
        banned: 0,
        inactive: 0
      },
      include: [{
        model: db.queues,
        where: {id: queue.id},
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
      return result_set;
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

    // Build result set
    for (let i = 0; i < rating_rows.length; i++) {
      if (ranks[i] > n) break;
      result_set.push([ranks[i], usernames[i], playcounts[i]]);
    }

    return result_set;
  } catch (e) {
    console.log('Error finding top ' + n + ' in queue ' + queue.name);
    console.log(e.name + ': ' + e.message);
  }
}

module.exports = dbc;