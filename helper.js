'use strict';

const helper = {};

helper.what_elo = function (percentage) {
  if (percentage < .1) return 'Diamond';
  else if (percentage < .25) return 'Platinum';
  else if (percentage < .5) return 'Gold';
  else if (percentage < .75) return 'Silver';
  else return 'Bronze';
}

helper.calculate_elo_gains = function (elo1, elo2, k) {
  const per = 1/(1+Math.pow(10, (elo2-elo1)/400.0));
  const gains = [];
  gains[0] = Math.round(k*(1-per));
  gains[1] = Math.round(k*(.5-per));
  gains[2] = Math.round(k*(-per));
  return gains;
}

module.exports = helper;