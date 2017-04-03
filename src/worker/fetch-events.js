#!/usr/bin/env node
import _ from 'lodash';
import google from 'googleapis';
import util from '../util/seeds'
import BPromise  from 'bluebird';
import requireEnvs from '../util/require-envs';
import * as citiesCore from '../core/cities-core';
const {knex} = require('../util/database').connect();
const logger = require('../util/logger')(__filename);
const sheets = google.sheets('v4');

requireEnvs([
  'GSHEETS_EVENTS',
  'GSHEETS_API_KEY',
]);

const eventSheets = JSON.parse(process.env.GSHEETS_EVENTS);
const batchGetAsync = BPromise.promisify(sheets.spreadsheets.values.batchGet);
const cities = {};

_fetchEvents()
.then(() => {
  logger.info("Event data updated");
  process.exit();
})
.catch(err => {
  logger.error("Updating events errored", err);
  process.exit(1);
});

function _fetchEvents() {
  logger.info("Updating events data");
  return citiesCore.getCities({ city: null }).then(rows => {
    rows.forEach(city => {
      cities[city.name] = city.id;
    });
  })
  .then(() => BPromise.map(eventSheets, eventSheet => {
    const request = {
      spreadsheetId: eventSheet.id,
      ranges: ['A:M'],
      valueRenderOption: 'UNFORMATTED_VALUE',
      key: process.env.GSHEETS_API_KEY,
    };

    return batchGetAsync(request).then(response => {
      let payload = _.get(response, 'valueRanges[0].values', null);

      if (!payload || payload.length === 0) {
        BPromise.resolve();
      }

      return _extractAndSaveData(payload, eventSheet);
    });
  }))
}

function _extractAndSaveData(payload, eventSheet) {
  const headers = _getHeaders(_.flatMap(_.pullAt(payload, [0])));
  const events = _getEvents(payload, headers);

  return BPromise.map(events, event => util.insertOrUpdate(knex, 'events', {
    code: `${ eventSheet.city }_${ event[headers["eventId"]] }`,
    city_id: cities[eventSheet.city],
    name: event[headers["name"]],
    location_name: event[headers["locationName"]],
    start_time: event[headers["startTime"]],
    end_time: event[headers["endTime"]],
    description: event[headers["description"]],
    organizer: event[headers["organizer"]],
    contact_details: event[headers["contactDetails"]],
    teemu: event[headers["teemu"]] || false,
    location: event[headers["locationLon"]] + ',' + event[headers["locationLat"]],
    cover_image: event[headers["coverImage"]],
    fb_event_id: event[headers["facebookId"]],
    show: event[headers["show"]],
    radius: event[headers["radius"]] || process.env.DEFAULT_EVENT_RADIUS,
  }, 'code'));
}

function _getHeaders(headers) {
  const indexedHeaders = {};
  _.forEach(headers, (header, index) => indexedHeaders[header] = index);
  return indexedHeaders;
}

function _getEvents(payload, headers) {
  return _getLatest(_groupEventsById(_filterEmpties(payload), headers), headers);
}

function _filterEmpties(events) {
  return _.filter(events, event => !_.isEmpty(event));
}

function _groupEventsById(events, headers) {
  return _.groupBy(events, event => event[headers["eventId"]]);
}

function _getLatest(eventsById, headers) {
  return _.map(eventsById, events => _.maxBy(events, event => event[headers["Aikaleima"]]));
}