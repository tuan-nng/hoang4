'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const syncRequest = require('sync-request');
const fetch = require('node-fetch');
const app = express();

var Wit = null;
var log = null;
try {
    // if running from repo
    Wit = require('../').Wit;
    log = require('../').log;
} catch (e) {
    Wit = require('node-wit').Wit;
    log = require('node-wit').log;
}

function sleep (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

const firstEntityValue = (entities, entity) => {
    const val = entities && entities[entity] &&
            Array.isArray(entities[entity]) &&
            entities[entity].length > 0 &&
            entities[entity][0].value
        ;
    if (!val) {
        return null;
    }
    return typeof val === 'object' ? val.value : val;
};

const fbMessage = (id, text) => {
    const body = JSON.stringify({
        recipient: { id:id },
        message: { text:text },
    });
    const qs = 'access_token=' + encodeURIComponent(process.env.FB_PAGE_ACCESS_TOKEN);
    return fetch('https://graph.facebook.com/me/messages?' + qs, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
    })
        .then(rsp => rsp.json())
        .then(json => {
            if (json.error && json.error.message) {
                throw new Error(json.error.message);
            }
            return json;
        });
};

const sessions = {};

const findOrCreateSession = (fbid) => {
    let sessionId;
    // Let's see if we already have a session for the user fbid
    Object.keys(sessions).forEach(k => {
        if (sessions[k].fbid === fbid) {
            // Yep, got it!
            sessionId = k;
        }
    });
    if (!sessionId) {
        // No session found for user fbid, let's create a new one
        sessionId = new Date().toISOString();
        sessions[sessionId] = {fbid: fbid, context: {}};
    }
    return sessionId;
};

// Our bot actions
const actions = {
    send({sessionId}, {text}) {
        // Our bot has something to say!
        // Let's retrieve the Facebook user whose session belongs to
        const recipientId = sessions[sessionId].fbid;
        if (recipientId) {
            // Yay, we found our recipient!
            // Let's forward our bot response to her.
            // We return a promise to let our bot know when we're done sending
            return fbMessage(recipientId, text)
                .then(() => null)
                .catch((err) => {
                    console.log("Error message: " + text);
                    console.error(
                        'Oops! An error occurred while forwarding the response to',
                        recipientId,
                        ':',
                        err.stack || err
                    );
                });
        } else {
            console.error('Oops! Couldn\'t find user for session:', sessionId);
            // Giving the wheel back to our bot
            return Promise.resolve()
        }
    },
    detectIntent({context, entities}) {
        return new Promise(function (resolve, reject) {
            console.log("Dectec intent ++++");
            var intent = firstEntityValue(entities, 'intent');
            if (intent) {
                if (intent === 'cancel_order') {
                    console.log("cancel-------");
                    context.cancelOrder = true;
                    delete context.trackOrder;
                    delete context.noIntent;
                } else if (intent === 'track_order') {
                    console.log("Track=========");
                    context.trackOrder = true;
                    delete context.cancelOrder;
                    delete context.noIntent;
                } else {
                    console.log("no itent-------");
                    context.noIntent = true;
                    delete context.cancelOrder;
                    delete context.trackOrder;
                }
            } else {
                console.log("no intent-------");
                context.noIntent = true;
                delete context.cancelOrder;
                delete context.trackOrder;
            }
            return resolve(context);
        })
    },
    cancelOrder({sessionId, context, text, entities}) {
        return new Promise(function (resolve, reject) {
            var yesNo = firstEntityValue(entities, 'yes_no');
            if (yesNo) {
                if (yesNo === 'yes') {
                    let messageData = {text: "We've recorded your cancellation. Please check your email for more detail."};
                    sendGenericMessage(sessions[sessionId].fbid, messageData);
                } else {
                    let messageData = {text: "You canceled the request."};
                    sendGenericMessage(sessions[sessionId].fbid, messageData);
                }
            } else {
                let messageData = {text: "You canceled the request."};
                sendGenericMessage(sessions[sessionId].fbid, messageData);
            }
            return resolve(context);
        })
    },
    getOrderNumber({context, entities}) {
        return new Promise(function (resolve, reject) {
            var orderNumber = firstEntityValue(entities, 'orderNumber');
            if (orderNumber) {
                context.getOrderNumber = 'success';
                delete context.missingOrderNumber;
            } else {
                context.missingOrderNumber = true;
                delete context.getOrderNumber;
            }
            delete context.cancelOrder;
            delete context.trackOrder;
            delete context.noIntent;
            return resolve(context);
        })
    },
    sendOrderInfo({sessionId, context, text, entities}) {
        return new Promise(function(resolve, reject) {
            let messageData = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "receipt",
                        "recipient_name": "Stephane Crozatier",
                        "order_number": "12345678902",
                        "currency": "SGD",
                        "payment_method": "Visa 2345",
                        "order_url": "http://petersapparel.parseapp.com/order?order_id=123456",
                        "timestamp": "1428444852",
                        "elements": [
                            {
                                "title": "Floral Crochet Bodycon Dress",
                                "subtitle": "Verification pending",
                                "quantity": 2,
                                "price": 179.80,
                                "currency": "SGD",
                                "image_url": "http://static-sg.zacdn.com/p/topshop-0274-965084-1.jpg"
                            },
                            {
                                "title": "Tie Collar Polka Dot Sleeveless Dress",
                                "subtitle": "Verification pending",
                                "quantity": 1,
                                "price": 39.90,
                                "currency": "SGD",
                                "image_url": "http://static-sg.zacdn.com/p/mayuki-9107-254854-1.jpg"
                            }
                        ],
                        "address": {
                            "street_1": "1 Hacker Way",
                            "street_2": "",
                            "city": "Menlo Park",
                            "postal_code": "94025",
                            "state": "CA",
                            "country": "US"
                        },
                        "summary": {
                            "subtotal": 129.80,
                            "shipping_cost": 4.95,
                            "total_tax": 6.19,
                            "total_cost": 200.84
                        },
                        "adjustments": [
                            {
                                "name": "New Customer Discount",
                                "amount": 20
                            },
                            {
                                "name": "$10 Off Coupon",
                                "amount": 10
                            }
                        ]
                    }
                }
            };
            sendGenericMessage(sessions[sessionId].fbid, messageData);
            delete context.cancelOrder;
            delete context.trackOrder;
            delete context.noIntent;
            return resolve();
        });
    },
    chatForFun({sessionId, context, text, entities}) {
        return new Promise(function (resolve, reject) {
            var req = syncRequest('GET', 'http://104.199.133.173:8080/say?q=' + text);
            sendGenericMessage(sessions[sessionId].fbid, {text: JSON.stringify(JSON.parse(req.getBody()).res)});
            delete context.cancelOrder;
            delete context.trackOrder;
            delete context.noIntent;
            context.done = true;
            return resolve();
        })
    },
    getEmail({context, entities}) {
        return new Promise(function (resolve, reject) {
            var email = firstEntityValue(entities, 'email');
            if (email) {
                context.getEmail = 'success';
                delete context.missingEmail;
            } else {
                context.missingEmail = true;
                delete context.getEmail;
            }
            return resolve(context);
        })
    },
    // You should implement your custom actions here
    // See https://wit.ai/docs/quickstart
};

// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_TOKEN;

// Setting up our bot
const wit = new Wit({
    accessToken: WIT_TOKEN,
    actions,
    logger: new log.Logger(log.INFO)
});

app.set('port', (process.env.PORT || 5000));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));

// Process application/json
app.use(bodyParser.json());

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
});

// for Facebook verification
app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] === 'my_voice_is_my_password_verify_me') {
        res.send(req.query['hub.challenge'])
    }
    res.send('Error, wrong token')
});

app.post('/webhook/', function (req, res) {

    const data = req.body;
    console.log(JSON.stringify(data)+'___________');

    if (data.object === 'page') {
        data.entry.forEach(entry => {
            entry.messaging.forEach(event => {
                if (event.message && !event.message.app_id) {
                    // Yay! We got a new message!
                    // We retrieve the Facebook user ID of the sender
                    const sender = event.sender.id;

                    // We retrieve the user's current session, or create one if it doesn't exist
                    // This is needed for our bot to figure out the conversation history
                    const sessionId = findOrCreateSession(sender);

                    // We retrieve the message content
                    const text = event.message.text;
                    const attachments = event.message.attachments;
                    console.log("RECEIVE " + text + " FROM " + sender);
                    if (attachments) {
                        // We received an attachment
                        // Let's reply with an automatic message
                        fbMessage(sender, 'Sorry I can only process text messages for now.')
                            .catch(console.error);
                    } else if (text) {
                        // We received a text message

                        // Let's forward the message to the Wit.ai Bot Engine
                        // This will run all actions until our bot has nothing left to do
                        wit.runActions(
                            sessionId, // the user's current session
                            text, // the user's message
                            sessions[sessionId].context // the user's current session state
                        ).then((context) => {
                            // Our bot did everything it has to do.
                            // Now it's waiting for further messages to proceed.
                            console.log('Waiting for next user messages');

                            // Based on the session state, you might want to reset the session.
                            // This depends heavily on the business logic of your bot.
                            // Example:
                            // if (context['done']) {
                            //   delete sessions[sessionId];
                            // }

                            // Updating the user's current session state
                            sessions[sessionId].context = context;
                        })
                            .catch((err) => {
                                console.error('Oops! Got an error from Wit: ', err.stack || err);
                            })
                    }
                } else {
                    console.log('received event', JSON.stringify(event));
                }
            });
        });
    }
    res.sendStatus(200);
});

function sendGenericMessage(sender, messageData) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token:encodeURIComponent(process.env.FB_PAGE_ACCESS_TOKEN)},
        method: 'POST',
        json: {
            recipient: {id:sender},
            message: messageData,
        }
    }, function(error, response, body) {
        if (error) {
            console.log('Error sending messages: ', error)
        } else if (response.body.error) {
            console.log('Error: ', response.body.error)
        }
    })
}

 // Spin up the server
app.listen(app.get('port'), function() {
    console.log('running on port', app.get('port'))
});