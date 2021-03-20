const config = require('./config');
const db = require('./db');
const moment = require('moment');

module.exports = {
    write: (req, res, next) => {
        db.data().collections('$_log').insertOne({
            headers: req.headers,
            connection: req.connection,
            user: req.decoded,
            url: req.originalUrl,
            data: req.body,
            created: moment().unix()
        })
        next();
    }
 }