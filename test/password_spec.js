
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0,
no-param-reassign: 0, no-unused-vars: 0  */

const assert = require('chai').assert;
const bcrypt = require('bcryptjs');
const auth = require('feathers-authentication').hooks;

const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./../test/helpers/basicSpy');

// user DB

const usersDb = [
  { _id: 'a', email: 'a', plainPassword: 'aa', plainNewPassword: 'xx', isVerified: false },
  { _id: 'b', email: 'b', plainPassword: 'bb', plainNewPassword: 'yy', isVerified: true },
];

describe('verifyReset::password - setup', () => {
  it('encode passwords', function (done) {
    this.timeout(9000);

    Promise.all([
      encrypt(feathersStubs.app(), usersDb[0].plainPassword)
        .then(password => {
          usersDb[0].password = password;
        }),
      encrypt(feathersStubs.app(), usersDb[1].plainPassword)
        .then(password => {
          usersDb[1].password = password;
        }),
      encrypt(feathersStubs.app(), usersDb[0].plainNewPassword)
        .then(password => {
          usersDb[0].newPassword = password;
        }),
      encrypt(feathersStubs.app(), usersDb[1].plainNewPassword)
        .then(password => {
          usersDb[1].newPassword = password;
        }),
    ])
      .then(() => {
        done();
      })
      .catch(err => console.log('encode', err)); // eslint-disable-line no-console
  });

  it('compare plain passwords to encrypted ones', function () {
    this.timeout(9000);

    assert.isOk(bcrypt.compareSync(usersDb[0].plainPassword, usersDb[0].password), '[0]');
    assert.isOk(bcrypt.compareSync(usersDb[1].plainPassword, usersDb[1].password), '[1]');

    assert.isOk(bcrypt.compareSync(usersDb[0].plainNewPassword, usersDb[0].newPassword), 'new [0]');
    assert.isOk(bcrypt.compareSync(usersDb[1].plainNewPassword, usersDb[1].newPassword), 'new [1]');
  });
});

// Tests

['paginated', 'non-paginated'].forEach(pagination => {
  const ifNonPaginated = pagination === 'non-paginated';

  describe(`verifyReset::password ${pagination}`, () => {
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

    it('updates verified user', function (done) {
      this.timeout(9000);
      const i = 1;
      const user = clone(db[i]);

      verifyReset.create({
        action: 'password',
        value: { oldPassword: user.plainPassword, password: user.plainNewPassword },
      }, { user }, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, true, 'isVerified not true');
        assert.isOk(bcrypt.compareSync(db[i].plainNewPassword, db[i].password), `[${i}]`);

        done();
      });
    });

    it('updates unverified user', function (done) {
      this.timeout(9000);
      const i = 0;
      const user = clone(db[i]);

      verifyReset.create({
        action: 'password',
        value: { oldPassword: user.plainPassword, password: user.plainNewPassword },
      }, { user }, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isOk(bcrypt.compareSync(db[i].plainNewPassword, db[i].password), `[${i}]`);

        done();
      });
    });

    it('error on wrong password', function (done) {
      this.timeout(9000);
      const i = 0;
      const user = clone(db[i]);

      verifyReset.create({
        action: 'password', value: { oldPassword: 'fdfgfghghghj', password: user.plainNewPassword },
      }, { user }, (err, user) => {
        assert.equal(err.message, 'Current password is incorrect.');
        assert.deepEqual(err.errors, { oldPassword: 'Current password is incorrect.' });

        done();
      });
    });
  });

  describe(`verifyReset::password with email ${pagination}`, () => {
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

    it('updates verified user', function (done) {
      this.timeout(9000);
      const i = 1;
      const user = clone(db[i]);

      verifyReset.create({
        action: 'password',
        value: { oldPassword: user.plainPassword, password: user.plainNewPassword },
      }, { user }, (err, user) => {
        assert.strictEqual(err, null, 'err code set');
        assert.strictEqual(user.isVerified, true, 'isVerified not true');
        assert.isOk(bcrypt.compareSync(db[i].plainNewPassword, db[i].password), `[${i}]`);

        assert.deepEqual(spyEmailer.result(), [
          { args: ['password', db[i], { user: db[i] }], result: [null] },
        ]);

        done();
      });
    });
  });
});

// Helpers

function encrypt(app, password) {
  const hook = {
    type: 'before',
    data: { password },
    params: { provider: null },
    app: {
      get(str) {
        return app.get(str);
      },
    },
  };
  return auth.hashPassword()(hook)
    .then(hook1 => hook1.data.password)
    .catch(err => console.log('encrypt', err)); // eslint-disable-line no-console
}

function emailer(action, user, params, cb) {
  cb(null);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
