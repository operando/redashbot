"use strict"

const Botkit = require("botkit")
const puppeteer = require("puppeteer")
const tempfile = require("tempfile")
const fs = require("fs")
const request = require('request-promise-native')
const sleep = require('await-sleep')
const Table = require('table-layout')

// This configuration can gets overwritten when process.env.SLACK_MESSAGE_EVENTS is given.
// https://botkit.ai/docs/v0/readme-slack.html#event-list
const DEFAULT_SLACK_MESSAGE_EVENTS = "direct_message,direct_mention,mention"
const REDASH_INVITE_SLACK_MESSAGE_EVENTS = "direct_message,direct_mention,mention"

if (!process.env.SLACK_BOT_TOKEN) {
    console.error("Error: Specify SLACK_BOT_TOKEN in environment values")
    process.exit(1)
}
if (!((process.env.REDASH_HOST && process.env.REDASH_API_KEY) || (process.env.REDASH_HOSTS_AND_API_KEYS))) {
    console.error("Error: Specify REDASH_HOST and REDASH_API_KEY in environment values")
    console.error("Or you can set multiple Re:dash configs by specifying like below")
    console.error("REDASH_HOSTS_AND_API_KEYS=\"http://redash1.example.com;TOKEN1,http://redash2.example.com;TOKEN2\"")
    process.exit(1)
}

const parseApiKeysPerHost = () => {
    if (process.env.REDASH_HOST) {
        if (process.env.REDASH_HOST_ALIAS) {
            return {
                [process.env.REDASH_HOST]: {
                    "alias": process.env.REDASH_HOST_ALIAS,
                    "key": process.env.REDASH_API_KEY
                }
            }
        } else {
            return {[process.env.REDASH_HOST]: {"alias": process.env.REDASH_HOST, "key": process.env.REDASH_API_KEY}}
        }
    } else {
        return process.env.REDASH_HOSTS_AND_API_KEYS.split(",").reduce((m, host_and_key) => {
            var [host, alias, key] = host_and_key.split(";")
            if (!key) {
                key = alias
                alias = host
            }
            m[host] = {"alias": alias, "key": key}
            return m
        }, {})
    }
}

const redashApiKeysPerHost = parseApiKeysPerHost()
const slackBotToken = process.env.SLACK_BOT_TOKEN
const slackMessageEvents = process.env.SLACK_MESSAGE_EVENTS || DEFAULT_SLACK_MESSAGE_EVENTS
const RestrictInvitationsByEmailDomains = process.env.RESTRICT_INVITATIONS_BY_EMAIL_DOMAIN || undefined

const controller = Botkit.slackbot({
    debug: !!process.env.DEBUG
})

controller.spawn({
    token: slackBotToken,
    retry: Infinity
}).startRTM()

const faultTolerantMiddleware = (func) => {
    return async (bot, message) => {
        try {
            await func(bot, message)
            bot.botkit.log("ok")
        } catch (err) {
            const msg = `Something wrong happend : ${err}`
            bot.reply(message, msg)
            bot.botkit.log.error(msg)
        }
    }
}

const takeScreenshot = async (url) => {
    const file = tempfile(".png")
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROMIUM_BROWSER_PATH,
        args: ['--disable-dev-shm-usage', '--no-sandbox']
    })
    const page = await browser.newPage()
    page.setViewport({width: 1024, height: 360})
    await page.goto(url)
    await sleep(2000)
    await page.screenshot({path: file, fullPage: true})
    await browser.close()
    return file
}

const uploadFile = async (channel, filename, file, initialComment) => {
    const options = {
        token: slackBotToken,
        filename: filename,
        file: fs.createReadStream(file),
        channels: channel,
        initial_comment: initialComment
    }
    await request.post({url: "https://api.slack.com/api/files.upload", formData: options, simple: true})
}

Object.keys(redashApiKeysPerHost).forEach((redashHost) => {
    const redashHostAlias = redashApiKeysPerHost[redashHost]["alias"]
    const redashApiKey = redashApiKeysPerHost[redashHost]["key"]

    let domain = redashHost.replace("http://", "").replace("https://", "")

    controller.hears(`https?://${domain}/queries/([0-9]+)[/source]*#([0-9]+)`, slackMessageEvents, faultTolerantMiddleware(async (bot, message) => {
        const [originalUrl, queryId, visualizationId] = message.match

        const body = await request.get({
            uri: `${redashHost}/api/queries/${queryId}`,
            qs: {api_key: redashApiKey},
            simple: true
        })
        const query = JSON.parse(body)
        const visualization = query.visualizations.find(vis => vis.id.toString() === visualizationId)

        const embedUrl = `${redashHostAlias}/embed/query/${queryId}/visualization/${visualizationId}?api_key=${redashApiKey}`
        const filename = `${query.name}-${visualization.name}-query-${queryId}-visualization-${visualizationId}.png`
        const initialComment = `*${query.name}*\nQuery URL : ${originalUrl}`

        reactions(bot, message)

        bot.botkit.log(embedUrl)
        const output = await takeScreenshot(embedUrl)
        uploadFile(message.channel, filename, output, initialComment)
    }))

    controller.hears(`https?://${domain}/dashboard/([^?/|>]+)`, slackMessageEvents, faultTolerantMiddleware(async (bot, message) => {
        const [originalUrl, dashboardId] = message.match

        const body = await request.get({
            uri: `${redashHost}/api/dashboards/${dashboardId}`,
            qs: {api_key: redashApiKey},
            simple: true
        })
        const dashboard = JSON.parse(body)

        const embedUrls = {}
        const fileNames = {}
        const queryUrl = {}

        dashboard.widgets.sort((a, b) => {
            if (a.options.position.row > b.options.position.row) return 1;
            if (a.options.position.row < b.options.position.row) return -1;
            if (a.options.position.col > b.options.position.col) return 1;
            if (a.options.position.col < b.options.position.col) return -1;
            return 0;
        })

        dashboard.widgets
            .filter(w => w.visualization != null)
            .forEach(w => {
                const embedUrl = `${redashHostAlias}/embed/query/${w.visualization.query.id}/visualization/${w.visualization.id}?api_key=${redashApiKey}`
                const filename = `${dashboard.name}-dashboard-${w.visualization.query.name}-${w.visualization.name}-query-${w.visualization.query.id}-visualization-${w.visualization.id}.png`
                embedUrls[embedUrl] = embedUrl
                fileNames[embedUrl] = filename
                queryUrl[embedUrl] = `*${w.visualization.query.name}*\nQuery URL : ${redashHost}/queries/${w.visualization.query.id}/#${w.visualization.id}`
            })

        reactions(bot, message)

        for (const e in embedUrls) {
            const output = await takeScreenshot(embedUrls[e])
            uploadFile(message.channel, fileNames[e], output, queryUrl[e])
        }
    }))

    controller.hears(`https?://${domain}/queries/([0-9]+)[/source]*#table-all?`, slackMessageEvents, faultTolerantMiddleware(async (bot, message) => {
        const [originalUrl, queryId] = message.match
        const body = await request.get({
            uri: `${redashHost}/api/queries/${queryId}`,
            qs: {api_key: redashApiKey},
            simple: true
        })
        const query = JSON.parse(body)

        const result = JSON.parse(await request.get({
            uri: `${redashHost}/api/queries/${queryId}/results.json`,
            qs: {api_key: redashApiKey},
            simple: true
        })).query_result.data

        const rows = result.rows.map(row => {
            const converted = {}
            for (const {friendly_name, name} of result.columns) {
                converted[friendly_name] = row[name]
            }
            return converted
        })

        const cols = {}
        for (const {friendly_name} of result.columns) {
            cols[friendly_name] = friendly_name
        }

        const dashes = {}
        for (const {friendly_name} of result.columns) {
            dashes[friendly_name] = '-'.repeat(friendly_name.length)
        }

        reactions(bot, message)

        let tableMessage = createTableMessage(cols, dashes, rows)
        bot.reply(message, `*${query.name}*\n${tableMessage}`)
    }))

    controller.hears(`https?://${domain}/queries/([0-9]+)[/source]*#table-([0-9]+)?`, slackMessageEvents, faultTolerantMiddleware(async (bot, message) => {
        const [originalUrl, queryId, limit] = message.match
        const body = await request.get({
            uri: `${redashHost}/api/queries/${queryId}`,
            qs: {api_key: redashApiKey},
            simple: true
        })
        const query = JSON.parse(body)

        const result = JSON.parse(await request.get({
            uri: `${redashHost}/api/queries/${queryId}/results.json`,
            qs: {api_key: redashApiKey},
            simple: true
        })).query_result.data

        const rows = result.rows.slice(0, limit).map(row => {
            const converted = {}
            for (const {friendly_name, name} of result.columns) {
                converted[friendly_name] = row[name]
            }
            return converted
        })

        const cols = {}
        for (const {friendly_name} of result.columns) {
            cols[friendly_name] = friendly_name
        }

        const dashes = {}
        for (const {friendly_name} of result.columns) {
            dashes[friendly_name] = '-'.repeat(friendly_name.length)
        }

        reactions(bot, message)

        let tableMessage = createTableMessage(cols, dashes, rows)
        bot.reply(message, `*${query.name}*\n${tableMessage}`)
    }))

    controller.hears(`https?://${domain}/queries/([0-9]+)[/source]*(?:#table)?`, slackMessageEvents, faultTolerantMiddleware(async (bot, message) => {
        const [originalUrl, queryId] = message.match
        const body = await request.get({
            uri: `${redashHost}/api/queries/${queryId}`,
            qs: {api_key: redashApiKey},
            simple: true
        })
        const query = JSON.parse(body)

        const result = JSON.parse(await request.get({
            uri: `${redashHost}/api/queries/${queryId}/results.json`,
            qs: {api_key: redashApiKey},
            simple: true
        })).query_result.data

        const rows = result.rows.slice(0, 10).map(row => {
            const converted = {}
            for (const {friendly_name, name} of result.columns) {
                converted[friendly_name] = row[name]
            }
            return converted
        })

        const cols = {}
        for (const {friendly_name} of result.columns) {
            cols[friendly_name] = friendly_name
        }

        const dashes = {}
        for (const {friendly_name} of result.columns) {
            dashes[friendly_name] = '-'.repeat(friendly_name.length)
        }

        reactions(bot, message)

        let tableMessage = createTableMessage(cols, dashes, rows)
        bot.reply(message, `*${query.name}*\n${tableMessage}`)
    }))

    controller.hears(`invite (\\S+@\\S+\\.\\S+)`, REDASH_INVITE_SLACK_MESSAGE_EVENTS, faultTolerantMiddleware(async (bot, message) => {
        const [text, address] = message.match
        let mail;
        if (address.indexOf("mailto:") !== -1) {
            const matches = address.match(/\|.*>/)
            console.log("address : " + address)
            console.log("Matches : " + matches)

            if (!matches) {
                bot.reply(message, "invalid format email.")
                return
            }
            mail = matches[0].substring(1, matches[0].length - 1)
        } else {
            mail = address;
        }

        console.log("Mail : " + mail)

        const splitEmail = mail.split("@")
        const name = splitEmail[0]
        const domain = splitEmail[1]
        console.log("name : " + name)
        console.log("domain : " + domain)

        if (RestrictInvitationsByEmailDomains !== undefined) {
            const emailDomains = RestrictInvitationsByEmailDomains.split(",").map(value => value.replace("@", "").trim())
            if (!emailDomains.some(value => value === domain)) {
                bot.reply(message, `The domain this email address is not allowed to invite.\n${mail}`)
                return
            }
        }

        try {
            const res = await request.post({
                uri: `${redashHost}/api/users`,
                headers: {
                    'Authorization': 'Key ' + redashApiKey,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                json: {
                    "name": name,
                    "email": mail
                }
            })
            console.log(res)

            if (res.invite_link === undefined) {
                bot.reply(message, `Sent redash invite to ${mail}.`)
            } else {
                bot.reply(reply, `Sent redash invite to ${mail}.\nPlease send this URL to the person you invited.\n${invite_link}`)
            }
        } catch (e) {
            console.log(e)
            bot.reply(message, `Error ${e.message}`)
        }
    }))
})

function reactions(bot, message) {
    bot.api.reactions.add({
        name: 'ok_hand',
        channel: message.channel,
        timestamp: message.ts
    })
}

function createTableMessage(cols, dashes, rows) {
    const table = new Table([cols, dashes].concat(rows), {maxWidth: 2000})
    let tableMessage = '```' + table.toString() + '```'
    return tableMessage.split('\n').map(line => line.trimRight()).join('\n')
}
