// Run `npm start` to start the demo
import { SupabaseManagementAPI } from 'supabase-management-js'

import http from 'http'
import { spawn } from 'child_process'
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
                        margin-top: 100px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                
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
    const client = new SupabaseManagementAPI({
        accessToken: accessToken,
    })

    const ref = ''
    const res = await client.getPostgRESTConfig(ref)
    
    const pgsqlConnection = ``
    await shell(
        `docker run --rm -it --platform=linux/amd64 ghcr.io/dimitri/pgloader:latest pgloader ${mysqlConnection} ${pgsqlConnection}`,
    )

    outro("You're all set!")

    await sleep(1000)
}

main().catch(console.error)

export function shell(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string> },
) {
    let stdout = '',
        stderr = '',
        combined = ''
    let onStdout = (data: any) => {
        process.stdout.write(data)
        stdout += data
        combined += data
    }
    let onStderr = (data: any) => {
        process.stderr.write(data)
        stderr += data
        combined += data
    }

    const child = spawn(cmd, {
        ...opts,
        env: { ...process.env, ...opts?.env },
        stdio: 'pipe',
        shell: 'bash',
    })
    child.stderr.on('data', onStderr)
    child.stdout.on('data', onStdout)
    let killed = false
    function signalHandler() {
        killed = true
        child.kill()
    }
    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)
    process.on('SIGQUIT', signalHandler)
    process.on('exit', signalHandler)
    process.on('uncaughtExceptionMonitor', (e) => {
        signalHandler()
    })

    const start = Date.now()
    return new Promise<void>((resolve, reject) => {
        // p.on('error', () => reject)
        child.on('close', (code) => {
            const end = Date.now()
            const mins = (end - start) / (1000 * 60)

            if (code === 0) {
                resolve()
            } else {
                if (killed) {
                    return
                }
                const e = new Error(
                    `Could not run '${cmd.split(' ')[0]}': code ${code}`,
                )
                reject(e)
            }
        })
    })
}
