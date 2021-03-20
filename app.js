const config = require('./config');
const {ObjectId} = require('mongodb');
const db = require('./db');
const restana = require('restana');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const queryParser = require('connect-query');
const crypto = require('crypto');
const rs = require('crypto-random-string');
const moment = require('moment');
const path = require('path');
const files = require('serve-static');
const mainsms = require('mainsmsru')(config.smsAPI);
const middleware = require('./middleware');
const log = require('./log');

const app = restana();

const serve = files(path.join(__dirname, 'public'));
const cache = require('http-cache-middleware');
const policy = require('./policy');

app.use(cache());
app.use(serve);

app.use(bodyParser.json({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(queryParser());

app.get('*', async (req, res) => {
    send(req, path.join(__dirname, 'public', 'index.html')).pipe(res);
});

app.post('/reg', async (req, res) => {
    let data = req.body;

    let hash = crypto.createHash('sha1');
    hash.update(data.password);
    let password = hash.digest('hex');

    let result = await db.data().collection('$_users').updateOne({
        login: data.login
    }, {
        $setOnInsert: {
            password: password,
            stamp: rs({ length: 32 }),
            active: false,
            confirm: code,
            created: new Date(),
            updated: new Date()
        }
    }, {
        upsert: true
    });

    if (result.upsertedId) {
        let code = rs({ length: 5 });
        mainsms.message.send({
            test: 0,
            project: 'CRM_project',
            recipients: data.login,
            message: 'Ваш проверочный код: ' + code
        }, async (err, result) => {
            if (err) {
                console.log(err);
                res.send({ code: 'SERVICE_ERROR', err }, 500);
            } else {
                await db.data().collection('$_users').updateOne({
                    login: data.login
                }, {
                    $set: {
                        confirm: code
                    }
                })
            }
        });
        res.send({ result: true });
    } else {
        res.send({ result: false });
    }
});

app.post('/restore', async (req, res) => {
    let data = req.body;
    let code = rs({ length: 5 });
    mainsms.message.send({
        test: 0,
        project: 'CRM_project',
        recipients: data.login,
        message: 'Ваш проверочный код: ' + code
    }, async (err, result) => {
        if (err) {
            console.log(err);
            res.send({ code: 'SERVICE_ERROR', err }, 500);
        } else {
            await db.data().collection('$_users').updateOne({
                login: data.login
            }, {
                $set: {
                    restore_code: code,
                    restore_exp: moment().add(5, 'minutes').unix()
                }
            })
            res.send({ result: true, login: data.login });
        }
    });
});

app.post('/confirm', async (req,res) => {
    let data = req.body;
    let user = await db.data().collection('$_users').findOne({
        login: data.login
    });
    if (!user) {
        res.send({ result: false }, 401);
    }
    if (user.active === false, user.confirm && user.confirm === data.code) {
        await db.data().collection('$_users').updateOne({
            login: data.login
        }, {
            $set: {
                confirm: null,
                active: true
            }
        });
        res.send({
            result: true
        })
    } else {
        res.send({
            result: false
        })
    }
})

app.post('/code', async (req, res) => {
    let data = req.body;
    let user = await db.data().collection('$_users').findOne({
        login: data.login
    });
    if (!user) {
        res.send({ result: false }, 500);
    }
    if (user.restore_code && moment(user.restore_exp).isAfter(moment())) {
        if (user.restore_code === data.code) {
            let token = rs({ length: 32 });
            await db.data().collection('$_users').updateOne({
                login: data.login
            }, {
                $set: {
                    restore_code: null,
                    restore_exp: null,
                    token: token
                }
            })
            res.send({
                result: true,
                token: token
            });
        } else {
            res.send({
                result: false
            });
        }
    } else {
        await db.data().collection('$_users').updateOne({
            login: data.login
        }, {
            $set: {
                restore_code: null,
                restore_exp: null
            }
        })
        res.send({
            expired: true
        });
    }
});

app.post('/update', async (req, res) => {
    let data = req.body;
    let user = await db.data().collection('$_users').findOne({
        login: data.login
    });
    if (!user) {
        res.send({ result: false }, 500);
    }
    if (user.token && data.token === user.token) {
        let hash = crypto.createHash('sha1');
        hash.update(data.password);
        let hashed = hash.digest('hex');
        await db.data().collection('$_users').updateOne({
            login: data.login
        }, {
            $set: {
                token: null,
                password: hashed,
                stamp: rs({ length: 64 })
            }
        });
        res.send({
            result: true
        })
    } else {
        res.send({
            result: false
        })
    }
});

app.post('/auth', log.write, async (req, res) => {
    let data = req.body;
    let user = await db.data().collection('$_users').findOne({
        login: data.login
    });
    if (!user) {
        res.send({ result: false, msg: 'Authentication failed' }, 401);
        return;
    }

    let hash = crypto.createHash('sha1');
    hash.update(data.password);
    let hashed = hash.digest('hex');

    if (user.active && user.password === hashed) {
        let paylod = { stamp: user.stamp };
        let role = await db.data().collection('$_roles').findOne({
            login: data.login
        });
        if (role) {
            paylod['role'] = role.value;
        }
        const token = jwt.sign(paylod, config.secret, {
            expiresIn: '365d'
        });
        res.send({
            result: true,
            token: token
        });
    } else {
        res.send({
            result: false,
            msg: 'Authentication failed'
        }, 401);
    }
});

app.post('/objects.get', middleware.isAuth, policy.isRoles, log.write, async(req,res ) => {
    let active = req.body.active || true;
    res.send(await db.data().collection('$_objects').find({ active: active }).toArray());
});

app.post('/objects.update', middleware.isAuth, policy.isRoles, log.write, async(req,res) => {
    for(let obj in req.body.objects) {
        await db.data().collection('$_objects').replaceOne({
            _id: new ObjectId(obj._id)
        }, obj);
    }
    res.send({ result: true });
});

app.post('/objects.add', middleware.isAuth, policy.isRoles, log.write, async(req,res) => {
    let object = req.body.object;
    await db.data().collection('$_objects').insertOne(object);
    res.send({ result: true });
});

app.post('/store.:name.:op', middleware.isAuth, policy.isRoles, log.write , async(req,res) => {
    let data = req.body.data;

    let op = req.params.op;
    let name = req.params.name;
    if (name.indexOf('$_') !== -1) {
        res.send({ result: false });
        return;
    }
    let filter = data.filter || {};
    let object = data.object || {};
    let update = data.update || {};
    let options = data.options || {};

    switch (op) {
        case 'get':
            res.send({result: true, data: await db.data().collection(name).find(filter)});
            break;
        case 'add':
            await db.data().collection(name).insertOne(object);
            res.send({ result: true });
            break;
        case 'update':
            await db.data().collection(name).updateMany(filter, update ,options);
            res.send({ result: true });
            break;
        case 'delete':
            await db.data().collection(name).deleteMany(filter);
            res.send({ result: true });
            break;
    }
});

app.start(config.port).then((server) => {
    db.init().then(function () {
        console.log('Started CRM');
    });
});