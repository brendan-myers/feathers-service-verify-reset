
/* global assert, describe, it */
/* eslint  no-param-reassign: 0, no-shadow: 0, no-unused-vars: 0, no-var: 0, one-var: 0,
one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./../test/helpers/basicSpy');

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
];

// Tests

['paginated', 'non-paginated'].forEach(pagination => {
  const ifNonPaginated = pagination === 'non-paginated';

  describe(`verifyReset::resend email string ${pagination}`, () => {
    var db;
    var app;
    var users;
    var verifyReset;

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      verifyResetService().call(app); // define and attach verifyReset service
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('verifyReset::create exists', () => {
      assert.isFunction(verifyReset.create);
    });

    it('updates unverified user', (done) => {
      const email = 'a';
      verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime());

        done();
      });
    });

    it('error on verified user', (done) => {
      const email = 'b';
      verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
        assert.equal(err.message, 'User is already verified.');

        done();
      });
    });

    it('error on email not found', (done) => {
      const email = 'x';
      verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
        assert.equal(err.message, 'Email or verify token not found.');

        done();
      });
    });
  });

  describe(`verifyReset::resend email object ${pagination}`, () => {
    var db;
    var app;
    var users;
    var verifyReset;

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      verifyResetService().call(app); // define and attach verifyReset service
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('verifyReset::create exists', () => {
      assert.isFunction(verifyReset.create);
    });

    it('updates unverified user', (done) => {
      const email = 'a';
      verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime());

        done();
      });
    });

    it('error on verified user', (done) => {
      const email = 'b';
      verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
        assert.equal(err.message, 'User is already verified.');

        done();
      });
    });

    it('error on email not found', (done) => {
      const email = 'x';
      verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
        assert.equal(err.message, 'Email or verify token not found.');

        done();
      });
    });
  });

  describe(`verifyReset::resend token object ${pagination}`, () => {
    var db;
    var app;
    var users;
    var verifyReset;

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      verifyResetService().call(app); // define and attach verifyReset service
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('verifyReset::create exists', () => {
      assert.isFunction(verifyReset.create);
    });

    it('updates unverified user', (done) => {
      const verifyToken = '000';
      verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime());

        done();
      });
    });

    it('error on verified user', (done) => {
      const verifyToken = null;
      verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
        assert.equal(err.message, 'User is already verified.');
        assert.deepEqual(err.errors, {
          email: 'User is already verified.', token: 'User is already verified.',
        });

        done();
      });
    });

    it('error on token not found', (done) => {
      const verifyToken = 'x';
      verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
        assert.equal(err.message, 'Email or verify token not found.');
        assert.deepEqual(err.errors, { email: 'Not found.', token: 'Not found.' });

        done();
      });
    });
  });

  describe(`verifyReset::resend with email ${pagination}`, () => {
    var db;
    var app;
    var users;
    var spyEmailer;
    var verifyReset;

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      spyEmailer = new SpyOn(emailer);

      verifyResetService({ emailer: spyEmailer.callWithCb }).call(app); // attach verifyReset
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('updates unverified user', (done) => {
      const email = 'a';
      verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime());

        assert.deepEqual(spyEmailer.result(), [
          { args: ['resend', user, {}], result: [null] },
        ]);

        done();
      });
    });
  });
});

// Helpers

function emailer(action, user, params, cb) {
  cb(null);
}

function makeDateTime(options1) {
  options1 = options1 || {};
  return Date.now() + (options1.delay || defaultVerifyDelay);
}

function aboutEqualDateTime(time1, time2, msg, delta) {
  delta = delta || 500;
  const diff = Math.abs(time1 - time2);
  assert.isAtMost(diff, delta, msg || `times differ by ${diff}ms`);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
