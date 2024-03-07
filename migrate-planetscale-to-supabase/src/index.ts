// Run `npm start` to start the demo
import http from 'http'
import {
    intro,
    outro,
    confirm,
    select,
    spinner,
    isCancel,
    cancel,
    log,
    text,
} from '@clack/prompts'
import { setTimeout as sleep } from 'node:timers/promises'
import color from 'picocolors'

const websiteUrl =
    process.env.NEXT_PUBLIC_URL || 'https://supamigrate.vercel.app'

async function main() {
    console.log()
    intro(color.inverse(' create-my-app '))

    const mysqlConnection = await text({
        message: 'What is your PlanetScale connection URI?',
        placeholder: 'mysql://',
    })

    if (isCancel(mysqlConnection)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }

    const uri = new URL(`/api/supabase/connect`, websiteUrl)
    const port = 3434
    // uri.searchParams.set('redirectUrl', `http://localhost:${port}`)

    log.info(`Go to ${uri.toString()} to authenticate with Supabase`)

    const s = spinner()
    // s.start('Authenticating with Supabase...')

    const { accessToken, refreshToken } = await new Promise<any>(
        (resolve, reject) => {
            const server = http.createServer((req, res) => {
                const u = new URL(req.url!, websiteUrl)
                const accessToken = u.searchParams.get('access_token')
                const refreshToken = u.searchParams.get('refresh_token')
                if (!accessToken) {
                    // console.log('No access token found in request')
                    return res.end()
                }
                // show an html page saying "You're all set! You can close this window now."

                res.writeHead(200, { 'Content-Type': 'text/html' })

                res.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>You're all set!</title>
                <style>
                    body {
                        font-family: sans-serif;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <h1>You're all set!</h1>
                <p>Go back to the terminal to complete the migration.</p>
            </body>
            </html>
            `)
                res.end()

                app.close()
                resolve({ accessToken, refreshToken })
            })

            const app = server.listen(port, () => {
                log.info(`Server running at http://localhost:${port}/`)
            })

            process.on('SIGINT', () => {
                app.close()
            })
            process.on('SIGTERM', () => {
                app.close()
            })
        },
    )
    console.log({ accessToken })
    s.stop('Authentication complete')

    outro("You're all set!")

    await sleep(1000)
}

main().catch(console.error)
