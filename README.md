# Slack Bot for Redash

This is slack bot for [Redash](https://redash.io).

## Features

### Take a screen capture of visualization

- Bot can handle message format like `@botname <visualization URL>`
  - example: `@redashbot https://your-redash-server.example.com/queries/1#2`

![screenshot.png](./images/screenshot.png)


### Invite to Redash

- Bot can handle message format like `@botname invite <email>`
  - example: `@redashbot invite test@test.com`

### Show active job list

- Bot can handle message format like `@botname job`
  - example: `@redashbot job`

### Cancel job

- Bot can handle message format like `@botname job_cancel <job_id>`
  - example: `@redashbot job_cancel 5130ebd3-a9ev-41a4-924d-d39fde2d4b01`

## How to develop

Clone this repository, then

```bash
$ yarn install
$ export REDASH_HOST=https://your-redash-server.example.com
$ export REDASH_API_KEY=your-redash-api-key
$ export SLACK_BOT_TOKEN=your-slack-bot-token
$ node index.js
```

## How to deploy to Heroku

You can easy to deploy redashbot to Heroku, just click following button.

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

## Environment variables

### SLACK_BOT_TOKEN (required)

Slack's Bot User Token

### REDASH_HOST and REDASH_API_KEY (optional)

Re:dash's URL and its API Key.

If you want to use Redash invitation function, set Redash admin API Key.

## REDASH_HOST_ALIAS (optional)
Re:dash' URL accessible from the bot.

### REDASH_HOSTS_AND_API_KEYS (optional)

If you want to use multiple Re:dash at once, specify this variable like below

```
REDASH_HOSTS_AND_API_KEYS="http://redash1.example.com;TOKEN1,http://redash2.example.com;TOKEN2"
```

or if you need to specify REDASH_HOST_ALIAS for each Re:dash, like below

```
REDASH_HOSTS_AND_API_KEYS="http://redash1.example.com;http://redash1-alias.example.com;TOKEN1,http://redash2.example.com;TOKEN2"
```

### SLACK_MESSAGE_EVENTS (optional)

Message events this bot reacts.
Available values are listd in https://github.com/howdyai/botkit/blob/master/readme-slack.md#message-received-events
Its default is *direct_message,direct_mention,mention*


### RESTRICT_INVITATIONS_BY_EMAIL_DOMAIN (optional)

Restrict the domains of email addresses that can be invited to redash.

specify this variable like below

```
RESTRICT_INVITATIONS_BY_EMAIL_DOMAIN=@test.com
```

Separate letters with a comma(`,`), If you want to use multiple email domains.

```
RESTRICT_INVITATIONS_BY_EMAIL_DOMAIN=@test.com,@example.com
```