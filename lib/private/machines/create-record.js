module.exports = {
  friendlyName: "Create (record)",

  description: "Create a new physical record in the database.",

  inputs: {
    query: require("../constants/query.input"),
    connection: require("../constants/connection.input"),
    dryOrm: require("../constants/dry-orm.input"),
  },

  exits: {
    success: {
      outputFriendlyName: "Record (maybe)",
      outputDescription:
        "Either `null` or (if `fetch:true`) a dictionary representing the new record that was created.",
      outputExample: "===",
    },

    notUnique: require("../constants/not-unique.exit"),
  },

  fn: function (inputs, exits) {
    // Dependencies
    var util = require("util");
    var _ = require("@sailshq/lodash");
    var processNativeRecord = require("./private/process-native-record");
    var processNativeError = require("./private/process-native-error");
    var reifyValuesToSet = require("./private/reify-values-to-set");

    // Local var for the stage 3 query, for easier access.
    var s3q = inputs.query;
    if (s3q.meta && s3q.meta.logMongoS3Qs) {
      console.log("* * * * * *\nADAPTER (CREATE RECORD):", require("util").inspect(s3q, { depth: 5 }), "\n");
    }

    // Local var for the `tableName`, for clarity.
    var tableName = s3q.using;

    // Grab the model definition
    var WLModel = _.find(inputs.dryOrm.models, { tableName: tableName });
    if (!WLModel) {
      return exits.error(
        new Error(
          "No model with that tableName (`" +
            tableName +
            "`) has been registered with this adapter.  Were any unexpected modifications made to the stage 3 query?  Could the adapter's internal state have been corrupted?  (This error is usually due to a bug in this adapter's implementation.)",
        ),
      );
    } //-•

    //  ╦═╗╔═╗╦╔═╗╦ ╦  ┬  ┬┌─┐┬  ┬ ┬┌─┐┌─┐  ┌┬┐┌─┐  ┌─┐┌─┐┌┬┐
    //  ╠╦╝║╣ ║╠╣ ╚╦╝  └┐┌┘├─┤│  │ │├┤ └─┐   │ │ │  └─┐├┤  │
    //  ╩╚═╚═╝╩╚   ╩    └┘ ┴ ┴┴─┘└─┘└─┘└─┘   ┴ └─┘  └─┘└─┘ ┴
    try {
      reifyValuesToSet(s3q.newRecord, WLModel, s3q.meta);
    } catch (e) {
      return exits.error(e);
    }

    //  ╔╦╗╔═╗╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗  ┬ ┬┬ ┬┌─┐┌┬┐┬ ┬┌─┐┬─┐  ┌┬┐┌─┐  ╔═╗╔═╗╔╦╗╔═╗╦ ╦  ┌─┐┬─┐  ┌┐┌┌─┐┌┬┐
    //   ║║║╣  ║ ║╣ ╠╦╝║║║║║║║║╣   │││├─┤├┤  │ ├─┤├┤ ├┬┘   │ │ │  ╠╣ ║╣  ║ ║  ╠═╣  │ │├┬┘  ││││ │ │
    //  ═╩╝╚═╝ ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╚═╝  └┴┘┴ ┴└─┘ ┴ ┴ ┴└─┘┴└─   ┴ └─┘  ╚  ╚═╝ ╩ ╚═╝╩ ╩  └─┘┴└─  ┘└┘└─┘ ┴
    var isFetchEnabled;
    if (s3q.meta && s3q.meta.fetch) {
      isFetchEnabled = true;
    } else {
      isFetchEnabled = false;
    }

    //  ╦╔╗╔╔═╗╔═╗╦═╗╔╦╗  ┬─┐┌─┐┌─┐┌─┐┬─┐┌┬┐
    //  ║║║║╚═╗║╣ ╠╦╝ ║   ├┬┘├┤ │  │ │├┬┘ ││
    //  ╩╝╚╝╚═╝╚═╝╩╚═ ╩   ┴└─└─┘└─┘└─┘┴└──┴┘
    // Create this new record in the database by inserting a document in the appropriate Mongo collection.
    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    // FUTURE: Carry through the `fetch: false` optimization all the way to Mongo here,
    // if possible (e.g. using Mongo's projections API)
    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    var db = inputs.connection;
    var mongoCollection = db.collection(tableName);
    mongoCollection
      .insertOne(s3q.newRecord)
      .then((nativeResult) => {
        // If `fetch` is NOT enabled, we're done.
        if (!isFetchEnabled) {
          // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
          // FUTURE: Provide access to `insertId` somehow, even if `fetch` is not enabled:
          // ```
          // var insertId = nativeResult.insertedId;
          // ```
          // (Changes would need to happen in driver spec first---see:
          //   https://github.com/node-machine/driver-interface)
          // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
          return exits.success();
        } //-•

        //  ╔═╗╦═╗╔═╗╔═╗╔═╗╔═╗╔═╗  ┌┐┌┌─┐┌┬┐┬┬  ┬┌─┐  ┬─┐┌─┐┌─┐┌─┐┬─┐┌┬┐
        //  ╠═╝╠╦╝║ ║║  ║╣ ╚═╗╚═╗  │││├─┤ │ │└┐┌┘├┤   ├┬┘├┤ │  │ │├┬┘ ││
        //  ╩  ╩╚═╚═╝╚═╝╚═╝╚═╝╚═╝  ┘└┘┴ ┴ ┴ ┴ └┘ └─┘  ┴└─└─┘└─┘└─┘┴└──┴┘
        // Process record (mutate in-place) to wash away adapter-specific eccentricities.
        return mongoCollection.findOne({ _id: nativeResult.insertedId }).then((phRecord) => {
          try {
            processNativeRecord(phRecord, WLModel, s3q.meta);
          } catch (e) {
            return exits.error(e);
          }

          // Then send it back.
          return exits.success(phRecord);
        });
      })
      .catch((err) => {
        err = processNativeError(err);
        if (err.footprint && err.footprint.identity === "notUnique") {
          return exits.notUnique(err);
        }
        return exits.error(err);
      }); // </ mongoCollection.insertOne() >
  },
};
