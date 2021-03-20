const mongodb = require('mongodb');
const mongo = mongodb.MongoClient;
const config = require('./config');
let db;
let dbo;


module.exports = {
    init: async () => {
        db = await mongo.connect(config.mongodb, { useNewUrlParser: true, useUnifiedTopology: true }).catch(e => {
            throw e;
        });
        dbo = db.db(config.db);
    },
    data: () => {
        return dbo;
    }
}