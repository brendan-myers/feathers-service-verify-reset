
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0,
no-param-reassign: 0, no-unused-vars: 0  */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const VerifyReset = require('../lib/client');

// user DB

const usersDb = [
  { _id: 'a', email: 'bad', password: 'aa', isVerified: false },
  { _id: 'b', email: 'ok', password: 'bb', isVerified: true },
];

// Fake for verifyResetService service

var spyData = null;
var spyParams = null;
var spyAuthenticateEmail;
var spyAuthenticatePassword;

const verifyResetServiceFake = function () {
  return function verifyReset() { // 'function' needed as we use 'this'
    const app = this;
    const path = '/verifyReset/:action/:value';

    app.use(path, {
      create(data, params1, cb) {
        spyData = data;
        spyParams = params1;

        return data.action === 'unique' ? new Promise(resolve => resolve()) : cb();
      },
    });

    app.authenticate = (email, password) => {
      spyAuthenticateEmail = email;
      spyAuthenticatePassword = password;

      const index = usersDb[0].email === email ? 0 : 1;

      return new Promise((resolve) => resolve({ data: usersDb[index] }));
    };

    app.log = () => {};
  };
};

// Tests

describe('wrapper - instantiate', () => {
  it('exists', () => {
    assert.isFunction(VerifyReset);
  });

  it('has expected methods', () => {
    const app = feathersStubs.app();
    verifyResetService().call(app);
    const verifyReset = new VerifyReset(app);

    ['unique', 'resendVerify', 'verifySignUp', 'sendResetPassword', 'saveResetPassword',
      'changePassword', 'changeEmail',
    ].forEach(method => {
      assert.isFunction(verifyReset[method]);
    });
  });
});

describe('wrapper - methods', () => {
  var app;
  var verifyReset;

  beforeEach(() => {
    app = feathersStubs.app();
    verifyResetServiceFake().call(app);
    verifyReset = new VerifyReset(app);
  });

  it('unique', () => {
    verifyReset.unique({ username: 'john a' }, null, true, () => {
      assert.deepEqual(spyParams, {});
      assert.deepEqual(spyData, {
        action: 'unique', value: { username: 'john a' }, ownId: null, meta: { noErrMsg: true },
      });
    });
  });

  it('resendVerify', () => {
    verifyReset.resendVerify('a@a.com', () => {
      assert.deepEqual(spyParams, {});
      assert.deepEqual(spyData, { action: 'resend', value: 'a@a.com' });
    });
  });

  it('verifySignUp', () => {
    verifyReset.verifySignUp('000', () => {
      assert.deepEqual(spyParams, {});
      assert.deepEqual(spyData, { action: 'verify', value: '000' });
    });
  });

  it('sendResetPassword', () => {
    verifyReset.sendResetPassword('a@a.com', () => {
      assert.deepEqual(spyParams, {});
      assert.deepEqual(spyData, { action: 'forgot', value: 'a@a.com' });
    });
  });

  it('saveResetPassword', () => {
    verifyReset.saveResetPassword('000', '12345678', () => {
      assert.deepEqual(spyParams, {});
      assert.deepEqual(spyData, { action: 'reset', value: { token: '000', password: '12345678' } });
    });
  });

  it('changePassword', () => {
    const user = { _id: 'a', email: 'a', password: 'ahjhjhjkhj', isVerified: false };

    verifyReset.changePassword('12345678', 'password', user, () => {
      assert.deepEqual(spyParams, { user });
      assert.deepEqual(spyData, {
        action: 'password', value: { oldPassword: '12345678', password: 'password' },
      });
    });
  });

  it('changeEmail', () => {
    const user = { _id: 'a', email: 'a', password: 'ahjhjhjkhj', isVerified: false };

    verifyReset.changeEmail('12345678', 'b@b.com', user, () => {
      assert.deepEqual(spyParams, { user });
      assert.deepEqual(spyData, {
        action: 'email', value: { password: '12345678', email: 'b@b.com' },
      });
    });
  });

  it('authenticate is verified', () => {
    verifyReset.authenticate('ok', '12345678', (err, user) => {
      assert.equal(spyAuthenticateEmail, 'ok');
      assert.equal(spyAuthenticatePassword, '12345678');

      assert.equal(err, null);
      assert.deepEqual(user, usersDb[1]);
    });
  });

  it('authenticate is not verified', () => {
    verifyReset.authenticate('bad', '12345678', (err, user) => {
      assert.equal(spyAuthenticateEmail, 'bad');
      assert.equal(spyAuthenticatePassword, '12345678');

      assert.notEqual(err, null);
    });
  });
});
