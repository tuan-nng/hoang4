'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
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
        recipient: { id },
        message: { text },
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
    trackOrder({context, entities}) {
        return new Promise(function (resolve, reject) {
            var orderNumber = firstEntityValue(entities, 'orderNumber');
            if (orderNumber) {
                context.orderStatus = 'success';
                delete context.missingOrderNumber;
            } else {
                context.missingOrderNumber = true;
                delete context.orderStatus;
            }
            return resolve(context);
        })
    },
    sendOrderInfo({sessionId, context, text, entities}) {
        return new Promise(function(resolve, reject) {
            let messageData = {
                "attachment": {
                    "type": "template",
                    "payload": {
                        "template_type": "generic",
                        "elements": [{
                            "title": "First card",
                            "subtitle": "Element #1 of an hscroll",
                            "image_url": "http://messengerdemo.parseapp.com/img/rift.png",
                            "buttons": [{
                                "type": "web_url",
                                "url": "https://www.messenger.com",
                                "title": "web url"
                            }, {
                                "type": "postback",
                                "title": "Postback",
                                "payload": "Payload for first element in a generic bubble",
                            }],
                        }, {
                            "title": "Second card",
                            "subtitle": "Element #2 of an hscroll",
                            "image_url": "http://messengerdemo.parseapp.com/img/gearvr.png",
                            "buttons": [{
                                "type": "postback",
                                "title": "Postback",
                                "payload": "Payload for second element in a generic bubble",
                            }],
                        }]
                    }
                }
            };
            sendGenericMessage(sessions[sessionId].fbid, messageData);
            return resolve();
        });
    },
    chatForFun({sessionId, context, text, entities}) {
        return new Promise(function (resolve, reject) {
            request('http://104.199.133.173:8080/say?q=' + text, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    var obj = JSON.parse(body);
                    console.log("Chat for fun");
                    console.log(JSON.stringify(obj.res));
                    sendGenericMessage(sessions[sessionId].fbid, obj.res);
                }
            });
            return resolve();
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

    if (data.object === 'page') {
        data.entry.forEach(entry => {
            entry.messaging.forEach(event => {
                if (event.message) {
                    // Yay! We got a new message!
                    // We retrieve the Facebook user ID of the sender
                    const sender = event.sender.id;

                    // We retrieve the user's current session, or create one if it doesn't exist
                    // This is needed for our bot to figure out the conversation history
                    const sessionId = findOrCreateSession(sender);

                    // We retrieve the message content
                    const text = event.message.text;
                    const attachments = event.message.attachments;

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