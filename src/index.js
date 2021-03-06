
/* eslint consistent-return: 0, no-param-reassign: 0, no-underscore-dangle: 0,
no-var: 0, vars-on-top: 0 */

const crypto = require('crypto');
const errors = require('feathers-errors');
const auth = require('feathers-authentication').hooks;
const bcrypt = require('bcryptjs');
const hooks = require('feathers-hooks-common');
const utils = require('feathers-hooks-common/lib/utils');
const debug = require('debug')('verifyReset');

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
const defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

/**
 * Feathers-service-verify-reset service to verify user's email, and to reset forgotten password.
 *
 * @param {Object?} options - for service
 *
 * options.emailer - function(action, user, provider, cb) sends an email for 'action'.
 *    action    function performed: resend, verify, forgot, reset.
 *    user      user's information.
 *    provider  transport used: rest (incl raw HTTP), socketio, primus or undefined (internal)
 *
 *    The forgot (reset forgotten password) and resend (resend user email verification)
 *    are needed to provide the user a link. The other emails are optional.
 *
 * options.delay - duration for sign up email verification token in ms. Default is 5 days.
 * options.resetDelay - duration for password reset token in ms. Default is 2 hours.
 *
 * @returns {Function} Featherjs service
 *
 * This service does not handle the email on creation of a new user account.
 * That is handled with hooks on the 'users' service 'create' method, e.g.
 *
 * const verifyHooks = require('feathers-service-verify-reset').verifyResetHooks;
 * export.before = {
 *   create: [
 *     auth.hashPassword(),
 *     verifyHooks.addVerification() // add .isVerified, .verifyExpires, .verifyToken
 *   ]
 * };
 * export.after = {
 *   create: [
 *     hooks.remove('password'),
 *     aHookToEmailYourVerification(),
 *     verifyHooks.removeVerification() // removes verification/reset fields other than .isVerified
 *   ]
 * };
 */
module.exports.service = function (options) {
  options = options || {};
  debug(`service configured. typeof emailer=${typeof options.emailer}`);

  const emailer = options.emailer || function (p1, p2, p3, cb) { cb(null); };
  const resetDelay = options.resetDelay || defaultResetDelay;

  return function verifyReset() { // 'function' needed as we use 'this'
    debug('service initialized');
    const app = this;
    const path = '/verifyReset/:action/:value';
    var users;
    var params;

    app.use(path, {
      create(data, params1, cb) {
        debug(`service called. action=${data.action} value=${JSON.stringify(data.value)}`);
        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'unique':
            // the 'return' is needed!
            return checkUniqueness(data.value, data.ownId || null, data.meta || {});
          case 'resend':
            resendVerifySignUp(data.value, cb);
            break;
          case 'verify':
            verifySignUp(data.value, cb);
            break;
          case 'forgot':
            sendResetPwd(data.value, cb);
            break;
          case 'reset':
            resetPwd(data.value.token, data.value.password, cb);
            break;
          case 'password':
            passwordChange(params.user, data.value.oldPassword, data.value.password, cb);
            break;
          case 'email':
            emailChange(params.user, data.value.password, data.value.email, cb);
            break;
          default:
            throw new errors.BadRequest(`Action "${data.action}" is invalid.`);
        }
      },
    });

    const isAction = (...args) => hook => args.indexOf(hook.data.action) !== -1;

    app.service(path).before({
      create: [
        hooks.iff(isAction('password', 'email'), auth.verifyToken()),
        hooks.iff(isAction('password', 'email'), auth.populateUser()),
      ],
    });

    function checkUniqueness(uniques, ownId, meta) {
      const errs = {};
      const keys = Object.keys(uniques).filter(
        key => uniques[key] !== undefined && uniques[key] !== null);
      let keysLeft = keys.length;

      return new Promise((resolve, reject) => {
        if (!keysLeft) {
          return resolve();
        }

        keys.forEach(prop => {
          debug(`query ${prop}:${uniques[prop].trim()}`);
          users.find({ query: { [prop]: uniques[prop].trim() /* , $limit: 1 */ } }) // 1 as unique
            .then(data => {
              const items = Array.isArray(data) ? data : data.data;
              if (items.length > 1 || (items.length === 1 && items[0]._id !== ownId)) {
                errs[prop] = 'Already taken.';
              }

              // Check results on last async operation
              if (--keysLeft <= 0) {
                if (!Object.keys(errs).length) {
                  resolve();
                }

                reject(new errors.BadRequest(
                  meta.noErrMsg ? null : 'Values already taken.', { errors: errs }
                ));
              }
            })
            .catch(err => {
              reject(new errors.GeneralError(err));
            });
        });
      });
    }

    function resendVerifySignUp(emailOrToken, cb) {
      debug('resend', emailOrToken);
      var query = {};

      // form query string
      if (typeof emailOrToken === 'string') {
        query = { email: emailOrToken };
      } else {
        if ('email' in emailOrToken) {
          query.email = emailOrToken.email;
        }
        if ('verifyToken' in emailOrToken) {
          query.verifyToken = emailOrToken.verifyToken;
        }
      }

      users.find({ query })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest('Email or verify token not found.',
              { errors: { email: 'Not found.', token: 'Not found.' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest('User is already verified.',
              { errors: { email: 'User is already verified.', token: 'User is already verified.' } }
            ));
          }

          addVerifyProps(user, {}, (err, user1) => { // todo options not passed
            users.update(user1._id, user1, {},
              (err1, user2) => { // careful, hooks may have stripped some fields out of user2
                if (err1) { throw new errors.GeneralError(err1); }

                emailer('resend', clone(user1), params, (err2) => {
                  debug('resend. Completed.');
                  cb(err2, getClientUser(user2));
                });
              });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function verifySignUp(token, cb) {
      debug(`verify ${token}`);

      users.find({ query: { verifyToken: token } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Verification token was not issued.', { errors: { $className: 'notIssued' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest(
              'User is already verified.', { errors: { $className: 'alreadyVerified' } }
            ));
          }

          user.isVerified = user.verifyExpires > Date.now();
          user.verifyExpires = null;
          user.verifyToken = null;
          if ('resetToken' in user) {
            user.resetToken = null;
          }
          if ('resetExpires' in user) {
            user.resetExpires = null;
          }

          if (!user.isVerified) {
            return cb(new errors.BadRequest(
              'Verification token has expired.',
              { errors: { $className: 'expired' } }
            ));
          }

          users.update(user._id, user, {},
            (err, user1) => {
              if (err) { throw new errors.GeneralError(err); }
              emailer('verify', clone(user), params, (err1) => {
                debug('verify. Completed.');
                cb(err1, getClientUser(user1));
              });
            });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function sendResetPwd(email, cb) {
      debug('forgot');
      users.find({ query: { email } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Email not found.', { errors: { email: 'Not found.' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique
          if (!user.isVerified) {
            return cb(new errors.BadRequest(
              'Email is not yet verified.', { errors: { email: 'Not verified.' } }
            ));
          }
          crypto.randomBytes(15, (err, buf) => {
            if (err) {
              throw new errors.GeneralError(err);
            }
            user.resetExpires = Date.now() + resetDelay;
            user.resetToken = buf.toString('hex');

            users.update(user._id, user, {},
              (err1, user1) => {
                if (err1) { throw new errors.GeneralError(err1); }

                emailer('forgot', clone(user1), params, (err2) => {
                  debug('forgot. Completed.');
                  cb(err2, getClientUser(user1));
                });
              });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function resetPwd(token, password, cb) {
      debug('reset', token, password);
      users.find({ query: { resetToken: token } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Reset token not found.', { errors: { $className: 'notFound' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest(
              'Email is not verified.', { errors: { $className: 'notVerified' } }
            ));
          }
          if (user.resetExpires < Date.now()) {
            return cb(new errors.BadRequest(
              'Reset token has expired.', { errors: { $className: 'expired' } }
            ));
          }

          // hash the password just like create: [ auth.hashPassword() ]

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

          debug('reset. hashing password.');
          auth.hashPassword()(hook)
            .then(hook1 => {
              user.password = hook1.data.password;
              user.resetExpires = null;
              user.resetToken = null;

              users.update(user._id, user, {},
                (err, user1) => {
                  if (err) { throw new errors.GeneralError(err); }

                  emailer('reset', clone(user1), params, (err1) => {
                    debug('reset. Completed.');
                    return cb(err1, getClientUser(user1));
                  });
                });
            })
            .catch(err => {
              throw new errors.GeneralError(err);
            });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function passwordChange(user, oldPassword, password, cb) {
      // compare old password to encrypted current password
      bcrypt.compare(oldPassword, user.password, (err, data) => {
        if (err || !data) {
          return cb(new errors.BadRequest('Current password is incorrect.',
            { errors: { oldPassword: 'Current password is incorrect.' } }
          ));
        }

        // encrypt the new password
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
        auth.hashPassword()(hook)
          .then(hook1 => {
            // update user information
            user.password = hook1.data.password;

            users.update(user._id, user, {}, (err1, user1) => {
              if (err1) {
                throw new errors.GeneralError(err1);
              }

              // send email
              emailer('password', clone(user1), params, (err2) => {
                debug('password. Completed.');
                cb(err2, getClientUser(user1));
              });
            });
          });
      });
    }

    function emailChange(user, password, email, cb) {
      // compare old password to encrypted current password
      bcrypt.compare(password, user.password, (err, data) => {
        if (err || !data) {
          return cb(new errors.BadRequest('Password is incorrect.',
            { errors: { password: 'Password is incorrect.' } }
          ));
        }

        // send email
        const user1 = clone(user);
        user1.newEmail = email;
        emailer('email', clone(user1), params, () => {});

        // update user information
        user.email = email;

        users.update(user._id, user, {}, (err1, user2) => {
          if (err1) {
            throw new errors.GeneralError(err1);
          }

          debug('email. Completed.');
          cb(err1, getClientUser(user2));
        });
      });
    }

    function getClientUser(user) {
      const client = clone(user);
      delete client.password;
      return client;
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = (options) => (hook, next) => {
  utils.checkContext(hook, 'before', 'create');

  addVerifyProps(hook.data, options, (err, data) => {
    hook.data = data;
    next(null, hook);
  });
};

module.exports.hooks.restrictToVerified = () => (hook) => {
  utils.checkContext(hook, 'before');

  if (!hook.params.user || !hook.params.user.isVerified) {
    throw new errors.BadRequest('User\'s email is not yet verified.');
  }
};

module.exports.hooks.removeVerification = (ifReturnTokens) => (hook) => {
  utils.checkContext(hook, 'after');
  const user = (hook.result || {});

  if (hook.params.provider && user) { // noop if initiated by server
    delete user.verifyExpires;
    delete user.resetExpires;
    if (!ifReturnTokens) {
      delete user.verifyToken;
      delete user.resetToken;
    }
  }
};

// Helpers

const addVerifyProps = (data, options, cb) => {
  options = options || {};

  crypto.randomBytes(options.len || 15, (err, buf) => {
    if (err) { throw new errors.GeneralError(err); }

    data.isVerified = false;
    data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
    data.verifyToken = buf.toString('hex');

    cb(null, data);
  });
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
