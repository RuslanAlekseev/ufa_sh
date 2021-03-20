const config = require('./config');
const db = require('./db');

module.exports = {
    isRoles: async (req, res, next) => {
        let role = req.decoded.role;
        if (!role) {
            role = "NO_ROLE"
        }
        let $_perms = await db.data().collection('$_perms').findOne({
            name: role
        });
        for (let perm of $_perms.perms.filter(value => {
            return value.type === 'denied'
        })) {
            if (perm['url'] === req.req.originalUrl) {
                res.send({
                    access: 'denied'
                }, 403);
            }
        }
        next();
    }
}
