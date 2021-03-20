const jwt = require('jsonwebtoken');
const config = require('./config');
module.exports = {
    isAuth: (req, res, next) => {
        var token = req.body.token || req.query.token || req.headers['x-access-token'];
        if (token) {
            jwt.verify(token, config.secret, (err, decoded) => {
                if (err) {
                    return res.send({
                        status: "failed",
                        message: 'Failed authentiaction.'
                    }, 401);
                } else {
                    req.decoded = decoded;
                    next();
                }
            });
        } else {
            return res.send({
                status: "failed",
                message: 'No auth token provided.'
            }, 401);
        }
    }
}