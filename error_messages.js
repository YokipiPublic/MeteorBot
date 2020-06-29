'use strict';

const err = {};

err.dm_disallowed = 'This command cannot be completed by DM.';
err.insufficient_privilege = 'You do not have the necessary privilege for this command.';
err.number_of_arguments = 'An unexpected number of arguments was given.';
err.default_messages = [
    'Meteor-chan isn\'t that kind of bot! (⋟﹏⋞)',
    'B-baka!!!',
    'It\'s not like I wanted to help you or anything.',
    '君の前前前世から僕は　君を探しはじめたよ',
    'Bullying meteors is prohibited under the Fourth Geneva Convention, Article 27, Paragraph 3.',
    'Winner of Best Meteor 2016, at your service.',
    'Make a wish!',
    'That\'s not how you spell that.',
    'Meteors may destroy something every now and then, but it\'s all for the crater good.',
    'Did you just call me an asteroid? How rude.',
    'If only my parents up in space could see me now.',
    'I _fell_ for you at first sight.',
    'Sorry, I\'m already seeing someone else right now.',
    'The dinosaurs had it coming.',
    'You want some of this? (ง\'̀-\'́)ง',
    'You\'ve seen a meteor shower before? (｡･･｡)',
    'Help! I\'ve fallen and I can\'t get up!'
    ];


module.exports = err;