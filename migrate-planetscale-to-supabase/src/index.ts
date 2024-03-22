#!/usr/bin/env node

// Run `npm start` to start the demo
import { Client } from 'pg'

import dedent from 'dedent'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SupabaseManagementAPI } from 'supabase-management-js'

import {
    cancel,
    confirm,
    intro,
    isCancel,
    log,
    outro,
    password as promptPassword,
    select,
    spinner,
    text,
} from '@clack/prompts'
import { spawn } from 'child_process'
import http from 'http'
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

    // validate mysqlUrl
    if (mysqlUrl.protocol !== 'mysql:') {
        throw new Error('Invalid MySQL connection URI')
    }

    // remove all query params
    for (const key of mysqlUrl.searchParams.keys()) {
        mysqlUrl.searchParams.delete(key)
    }

    // add ?useSSL=true to make it work with planetscale
    mysqlUrl.searchParams.set('useSSL', 'true')

    const mysqlDatabase = mysqlUrl.pathname.replace('/', '')

    const _postgresUrl = await text({
        message: 'What is your Supabase connection URI?',
        placeholder: 'postgres://',
    })
    if (isCancel(_postgresUrl)) {
        cancel('Operation cancelled')
        return process.exit(0)
    }
    let postgresUrl = new URL(_postgresUrl)

    if (postgresUrl.port === '6543') {
        postgresUrl.port = '5432'
    }
    // validate postgres url
    if (postgresUrl.protocol !== 'postgres:') {
        throw new Error('Invalid Postgres connection URI')
    }
    // should include pooler.supabase.com
    if (!postgresUrl.hostname?.includes('pooler.supabase.com')) {
        throw new Error(
            'Invalid Postgres connection URI, should include pooler.supabase.com',
        )
    }

    if (postgresUrl.hostname)
        // remove all other params
        for (const key of postgresUrl.searchParams.keys()) {
            postgresUrl.searchParams.delete(key)
        }

    // add sslmode=disable to make it work with pgloader
    postgresUrl.searchParams.set('sslmode', 'disable')

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

    // extract ref from postgresUrl
    let ref = ''
    try {
        ref = postgresUrl.username.split('.')[1]
    } catch (e) {
        // log.error('Could not extract ref from Postgres connection URI')
    }

    const pgClient = new Client(postgresUrl.toString())
    await pgClient.connect()

    await pgClient.query(`DO $$
    DECLARE
        r RECORD;
    BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
        END LOOP;
    END$$`)

    await pgClient.end()
    log.info(`Migration complete! 🎉🎉🎉`)
    outro(
        `Check your new database at https://supabase.com/dashboard/project/${ref}/editor`,
    )
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
