// Run `npm start` to start the demo
import path from 'path'
import os from 'os'
import fs from 'fs'
import dedent from 'dedent'
import { SupabaseManagementAPI } from 'supabase-management-js'

import http from 'http'
import { spawn } from 'child_process'
import {
    intro,
    outro,
    confirm,
    password as promptPassword,
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

    // check that docker is installed

    try {
        await shell(`docker --version`)
        console.log('')
    } catch (e) {
        throw new Error('Docker is not installed')
    }

    intro(color.inverse(' Migrate from PlanetScale to Supabase '))

    const _mysqlConnection = await text({
        message: 'What is your PlanetScale connection URI?',
        placeholder: 'mysql://',
    })
    if (isCancel(_mysqlConnection)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }

    let mysqlUrl = new URL(_mysqlConnection)

    // remove all query params
    for (const key of mysqlUrl.searchParams.keys()) {
        mysqlUrl.searchParams.delete(key)
    }

    // add ?useSSL=true to make it work with planetscale
    mysqlUrl.searchParams.set('useSSL', 'true')

    // console.log(mysqlUrl.toString())
    const mysqlDatabase = mysqlUrl.pathname.replace('/', '')

    // const postgresUrl = await text({
    //     message: 'What is your Postgres connection URI?',
    //     placeholder: 'postgres://',
    // })

    // if (isCancel(postgresUrl)) {
    //     cancel('Operation cancelled')
    //     return process.exit(0)
    // }

    const postgresUrl = await text({
        message: 'What is your Supabase connection URI?',
        placeholder: 'postgres://',
    })
    if (isCancel(postgresUrl)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }

    const config = dedent`
    LOAD DATABASE
        FROM      ${mysqlUrl}
        INTO      ${postgresUrl}

    WITH include drop, create tables, create indexes, reset sequences, quote identifiers

    ALTER SCHEMA '${mysqlDatabase}' RENAME TO 'public'
    ;
    `
    const tmp = path.resolve(os.tmpdir(), 'pgloader-temp')
    fs.mkdirSync(tmp, { recursive: true })
    const configPath = path.resolve(tmp, 'pgloader-config.load')

    log.info('Migrating data from PlanetScale to Supabase...')
    console.log()

    fs.writeFileSync(configPath, config, 'utf-8')
    try {
        await shell(
            `docker run --rm --platform=linux/amd64 -v ${tmp}:/tmp/pgloader ghcr.io/dimitri/pgloader:latest pgloader --no-ssl-cert-verification /tmp/pgloader/pgloader-config.load`,
            {},
        )
    } finally {
        fs.unlinkSync(configPath)
    }

    let ref =''
    log.info(`Migration complete! 🎉🎉🎉`)
    outro(
        `Check your new database at https://supabase.com/dashboard/project/${ref}/editor`,
    )

    await sleep(1000)
}

async function getPgUrlWithAuth() {
    const uri = new URL(`/api/supabase/connect`, websiteUrl)
    const port = 3434

    log.info(`Go to ${uri.toString()} to authenticate with Supabase`)
    const s = spinner()
    s.start()

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
                // log.info(`Server running at http://localhost:${port}/`)
            })

            process.on('SIGINT', () => {
                app.close()
            })
            process.on('SIGTERM', () => {
                app.close()
            })
        },
    )
    // console.log({ accessToken })
    s.stop('Authentication complete')
    const client = new SupabaseManagementAPI({
        accessToken: accessToken,
    })

    const projects = await client.getProjects()

    if (!projects?.length) {
        throw new Error('No projects found')
    }
    let ref = ''
    if (projects.length === 1) {
        // ask user if sure, this will copy the data in this database and could cause data loss
        const sure = await confirm({
            message: `Data will be migrated to (${projects[0].name}). Are you sure?`,
        })
        ref = projects[0].id
    } else {
        const chosenRef = await select({
            message:
                'Select a project. Data will be migrated to this database.',
            options: projects.map((p) => {
                return { label: p.name, value: p.id }
            }),
        })
        if (isCancel(chosenRef)) {
            cancel('Operation cancelled')
            return process.exit(0)
        }
        ref = chosenRef as string
    }

    // const res = await client.getPostgRESTConfig(ref)

    const pass = await promptPassword({
        message: `What is your Supabase database password? You can reset it at https://supabase.com/dashboard/project/${ref}/settings/database`,
    })
    if (isCancel(pass)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }

    const project = projects.find((p) => p.id === ref)
    if (!project) {
        throw new Error('No project found')
    }
    // project.database?.host is something like db.ref.supabase.co
    const region = project.region
    // https://supabase.com/docs/guides/platform/oauth-apps/build-a-supabase-integration
    const postgresUrl = `postgres://postgres.${ref}:${pass}@aws-0-${region}.pooler.supabase.com:6543/postgres?sslmode=disable`
    return postgresUrl
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

export function quote(arg: string) {
    if (/^[a-z0-9/_.-]+$/i.test(arg) || arg === '') {
        return arg
    }
    return (
        `$'` +
        arg
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\f/g, '\\f')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\v/g, '\\v')
            .replace(/\0/g, '\\0') +
        `'`
    )
}
